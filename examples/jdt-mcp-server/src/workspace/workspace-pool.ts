// workspace-pool — one JDT LS process per workspace identity (harness/docs/design/runtime-model.md).
//
// Invariants owned here:
//   INV-POOL-1  every live workspace has its own absolute -data directory; no two ever share one.
//   INV-POOL-2  live process count never exceeds the cap; an idle workspace is evicted first.
//   INV-POOL-4  eviction kills the process but never deletes the -data directory (warm restart).
//   INV-POOL-5  a workspace is spawned at most once per identity, even under concurrent first calls.
//
// Identity is X-005: the sha256 of the realpath'd project root — the same scheme project-router
// uses — so two paths to one project (including through a symlink) are one workspace, not two.
// The pool does not route: callers resolve the reactor root with project-router first
// (INV-ROUTE-1) and hand the resulting root to acquire().

import { createHash } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, realpathSync } from "node:fs";
import path from "node:path";

import { LspClient, type LspProcess } from "../lsp/lsp-client.ts";
import { resolveInstall } from "../provision/jdtls-provisioner.ts";

/** A-001 (human-confirmed): three concurrent instances is the developer-laptop memory posture. */
export const DEFAULT_MAX_WORKSPACES = 3;
/** How long a workspace gets to exit on SIGTERM before it is killed outright. */
export const STOP_GRACE_MS = 5_000;

export type WorkspaceState = "starting" | "idle" | "busy" | "stopping";

export interface SpawnWorkspaceArgs {
  /** The root exactly as the caller asked for it. */
  projectRoot: string;
  /** The realpath'd root; workspace identity is derived from this, never from the alias. */
  canonicalRoot: string;
  /** Absolute -data directory, unique to this workspace identity (INV-POOL-1). */
  dataDir: string;
  workspaceId: string;
}

export interface SpawnedWorkspace {
  pid: number;
  /** Present for real spawns; the pool itself never speaks LSP, it only owns the lifecycle. */
  client?: LspClient;
  stop(): Promise<void>;
}

export interface WorkspaceStatus {
  workspaceId: string;
  projectRoot: string;
  dataDir: string;
  state: WorkspaceState;
}

export interface WorkspaceLease {
  workspaceId: string;
  projectRoot: string;
  dataDir: string;
  pid: number;
  client?: LspClient;
  release(): Promise<void>;
}

export interface WorkspacePoolOptions {
  cacheRoot: string;
  maxWorkspaces?: number;
  /** The process system boundary, injectable so lifecycle can be proven without starting a JVM. */
  spawnWorkspace?: (args: SpawnWorkspaceArgs) => Promise<SpawnedWorkspace>;
}

export interface WorkspacePool {
  acquire(projectRoot: string): Promise<WorkspaceLease>;
  status(): { workspaces: WorkspaceStatus[] };
  close(): Promise<void>;
}

interface PoolEntry {
  workspaceId: string;
  projectRoot: string;
  canonicalRoot: string;
  dataDir: string;
  leases: number;
  state: WorkspaceState;
  lastUsedTick: number;
  started: Promise<SpawnedWorkspace>;
}

class JdtWorkspacePool implements WorkspacePool {
  readonly #cacheRoot: string;
  readonly #maxWorkspaces: number;
  readonly #spawnWorkspace: (args: SpawnWorkspaceArgs) => Promise<SpawnedWorkspace>;
  readonly #entries = new Map<string, PoolEntry>();
  #tick = 0;
  #closed = false;

  public constructor(options: WorkspacePoolOptions) {
    this.#cacheRoot = path.resolve(options.cacheRoot);
    this.#maxWorkspaces = options.maxWorkspaces ?? DEFAULT_MAX_WORKSPACES;
    if (!Number.isInteger(this.#maxWorkspaces) || this.#maxWorkspaces < 1) {
      throw new Error(`--max-workspaces must be a positive integer, got ${String(options.maxWorkspaces)}`);
    }
    this.#spawnWorkspace = options.spawnWorkspace ?? createJdtlsSpawner(this.#cacheRoot);
  }

  public async acquire(projectRoot: string): Promise<WorkspaceLease> {
    if (this.#closed) throw new Error("workspace pool is closed; no further workspaces can be acquired");
    const identity = this.#identify(projectRoot);

    let entry = this.#entries.get(identity.workspaceId);
    if (entry === undefined) {
      entry = {
        workspaceId: identity.workspaceId,
        projectRoot,
        canonicalRoot: identity.canonicalRoot,
        dataDir: identity.dataDir,
        leases: 0,
        state: "starting",
        lastUsedTick: ++this.#tick,
        started: undefined as unknown as Promise<SpawnedWorkspace>,
      };
      // INV-POOL-5 turns on this ordering: the entry is published to the map *synchronously*,
      // before the first await, so a concurrent duplicate first call finds it and joins the same
      // in-flight start instead of racing into a second spawn.
      this.#entries.set(identity.workspaceId, entry);
      entry.started = this.#startWorkspace(entry);
    }

    // Reserve the lease before awaiting, so a start still in flight can never be chosen as an
    // eviction victim by a concurrent acquire for some other project.
    entry.leases += 1;

    let spawned: SpawnedWorkspace;
    try {
      spawned = await entry.started;
    } catch (error) {
      entry.leases -= 1;
      // A failed start is never cached: the next call retries rather than inheriting a dead entry.
      if (entry.leases <= 0 && this.#entries.get(entry.workspaceId) === entry) {
        this.#entries.delete(entry.workspaceId);
      }
      throw error;
    }

    entry.state = "busy";
    entry.lastUsedTick = ++this.#tick;
    return this.#lease(entry, spawned);
  }

  public status(): { workspaces: WorkspaceStatus[] } {
    return {
      workspaces: [...this.#entries.values()].map((entry) => ({
        workspaceId: entry.workspaceId,
        projectRoot: entry.projectRoot,
        dataDir: entry.dataDir,
        state: entry.state,
      })),
    };
  }

  public async close(): Promise<void> {
    this.#closed = true;
    for (const entry of [...this.#entries.values()]) await this.#evict(entry);
  }

  #identify(projectRoot: string): { workspaceId: string; canonicalRoot: string; dataDir: string } {
    const absolute = path.resolve(projectRoot);
    let canonicalRoot: string;
    try {
      canonicalRoot = realpathSync(absolute);
    } catch {
      throw new Error(`Cannot open a JDT LS workspace for a path that does not exist: ${absolute}`);
    }
    const workspaceId = createHash("sha256").update(canonicalRoot).digest("hex");
    return {
      workspaceId,
      canonicalRoot,
      // Absolute, and a pure function of identity: two live workspaces cannot collide here
      // unless they are the same workspace (INV-POOL-1).
      dataDir: path.join(this.#cacheRoot, "workspaces", workspaceId),
    };
  }

  async #startWorkspace(entry: PoolEntry): Promise<SpawnedWorkspace> {
    await this.#ensureCapacityFor(entry);
    mkdirSync(entry.dataDir, { recursive: true });
    return this.#spawnWorkspace({
      projectRoot: entry.projectRoot,
      canonicalRoot: entry.canonicalRoot,
      dataDir: entry.dataDir,
      workspaceId: entry.workspaceId,
    });
  }

  async #ensureCapacityFor(entry: PoolEntry): Promise<void> {
    while (this.#entries.size > this.#maxWorkspaces) {
      const victim = [...this.#entries.values()]
        .filter((candidate) => candidate !== entry && candidate.leases === 0 && candidate.state === "idle")
        .sort((a, b) => a.lastUsedTick - b.lastUsedTick)[0];
      if (victim === undefined) {
        // X-003's `cap-exceeded`: every live workspace is in use, so honouring the cap means
        // failing this call explicitly rather than spawning over it or waiting unbounded.
        throw new Error(
          `cap-exceeded: all ${this.#maxWorkspaces} workspace slots are busy; cannot start ${entry.projectRoot}`,
        );
      }
      await this.#evict(victim);
    }
  }

  async #evict(victim: PoolEntry): Promise<void> {
    victim.state = "stopping";
    this.#entries.delete(victim.workspaceId);
    try {
      const spawned = await victim.started;
      await spawned.stop();
    } catch {
      // A workspace that never started, or already died, needs no killing.
    }
    // The -data directory is deliberately left on disk: warm restart is 1.5 s against 2.3 s cold,
    // and the gap grows with project size (INV-POOL-4).
  }

  #lease(entry: PoolEntry, spawned: SpawnedWorkspace): WorkspaceLease {
    let released = false;
    return {
      workspaceId: entry.workspaceId,
      projectRoot: entry.projectRoot,
      dataDir: entry.dataDir,
      pid: spawned.pid,
      client: spawned.client,
      release: async () => {
        if (released) return;
        released = true;
        entry.leases -= 1;
        if (entry.leases <= 0 && entry.state !== "stopping") {
          entry.leases = 0;
          entry.state = "idle";
          entry.lastUsedTick = ++this.#tick;
        }
      },
    };
  }
}

export function createWorkspacePool(options: WorkspacePoolOptions): WorkspacePool {
  return new JdtWorkspacePool(options);
}

// -------------------------------------------------------------------------------------------
// The real process boundary: java … -jar plugins/org.eclipse.equinox.launcher_*.jar
//                                 -configuration <dir> -data <abs path>
// (harness/docs/design/evidence.md). The pool starts the process and wires an LspClient over its
// stdio; the initialize handshake and the semantic readiness probe belong to readiness-gate.
// -------------------------------------------------------------------------------------------

const CONFIGURATION_DIRS: Record<string, string> = {
  "darwin-arm64": "config_mac_arm",
  "darwin-x64": "config_mac",
  "linux-arm64": "config_linux_arm",
  "linux-x64": "config_linux",
  "win32-x64": "config_win",
};

export function resolveConfigurationDir(installDir: string): string {
  const key = `${process.platform}-${process.arch}`;
  const name = CONFIGURATION_DIRS[key];
  if (name === undefined) {
    throw new Error(`No JDT LS -configuration directory is known for platform ${key}`);
  }
  const dir = path.join(installDir, name);
  if (!existsSync(dir)) {
    throw new Error(`JDT LS install ${installDir} has no ${name} configuration directory`);
  }
  return dir;
}

export function findEquinoxLauncher(installDir: string): string {
  const pluginsDir = path.join(installDir, "plugins");
  let entries: string[];
  try {
    entries = readdirSync(pluginsDir);
  } catch {
    throw new Error(`JDT LS install ${installDir} has no plugins directory`);
  }
  const name = entries
    .filter((entry) => entry.startsWith("org.eclipse.equinox.launcher_") && entry.endsWith(".jar"))
    .sort()
    .at(-1);
  if (name === undefined) {
    throw new Error(`JDT LS install ${installDir} has no plugins/org.eclipse.equinox.launcher_*.jar`);
  }
  return path.join(pluginsDir, name);
}

function createJdtlsSpawner(cacheRoot: string): (args: SpawnWorkspaceArgs) => Promise<SpawnedWorkspace> {
  return async ({ canonicalRoot, dataDir }: SpawnWorkspaceArgs): Promise<SpawnedWorkspace> => {
    const install = await resolveInstall({ cacheDir: path.join(cacheRoot, "jdtls") });
    const child = spawn(
      install.javaPath,
      [
        "-Declipse.application=org.eclipse.jdt.ls.core.id1",
        "-Dosgi.bundles.defaultStartLevel=4",
        "-Declipse.product=org.eclipse.jdt.ls.core.product",
        "-Dfile.encoding=UTF-8",
        "--add-modules=ALL-SYSTEM",
        "--add-opens",
        "java.base/java.util=ALL-UNNAMED",
        "--add-opens",
        "java.base/java.lang=ALL-UNNAMED",
        "-jar",
        findEquinoxLauncher(install.installDir),
        "-configuration",
        resolveConfigurationDir(install.installDir),
        "-data",
        dataDir,
      ],
      { cwd: canonicalRoot, stdio: ["pipe", "pipe", "pipe"] },
    );
    if (child.pid === undefined) throw new Error(`Could not spawn JDT LS for ${canonicalRoot}`);
    // Nothing consumes JDT LS's stderr yet; drain it so a chatty JVM cannot stall on a full pipe.
    child.stderr?.resume();

    return {
      pid: child.pid,
      client: new LspClient(child as unknown as LspProcess),
      stop: () => terminate(child),
    };
  };
}

export async function terminate(child: ChildProcess, graceMs = STOP_GRACE_MS): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise<void>((resolve) => child.once("exit", () => resolve()));
  child.kill("SIGTERM");
  const escalation = setTimeout(() => child.kill("SIGKILL"), graceMs);
  escalation.unref();
  try {
    await exited;
  } finally {
    clearTimeout(escalation);
  }
}
