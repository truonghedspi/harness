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

// -------------------------------------------------------------------------------------------
// Attachments — things attached to a JDT LS PROCESS, exactly once per process.
//
// Why is this a separate concept and not a parameter of acquire(): a JDT LS process
// warm serves MANY leases over its lifecycle. Sign up for subscriber notifications for each lease
// LspClient's handler array grows longer with each tool call, and no call will unregister it
// previous call — a leak that increases linearly with traffic. So the correct life cycle is spawn ↔ evict:
// attach runs immediately after the process is born, detach runs when it is killed.
// -------------------------------------------------------------------------------------------

export interface WorkspaceAttachContext {
  workspaceId: string;
  projectRoot: string;
  canonicalRoot: string;
  dataDir: string;
  pid: number;
  /** Absent with fake spawn seams that do not say LSP; attachment must withstand that. */
  client?: LspClient;
}

export type WorkspaceDetach = () => void | Promise<void>;

/** Runs exactly once for each spawned process; The returned function runs exactly once at evict. */
export type WorkspaceAttachment = (context: WorkspaceAttachContext) => WorkspaceDetach | void; void;

/** The `onNotification` half of the LspClient that a subscriber needs; Keep narrow and structured. */
export interface WorkspaceNotificationSource {
  onNotification(method: string, handler: (params: unknown) => void): void;
}

/**
 * Port to diagnostics-cache, declare here instead of importing back: `DiagnosticsCache` returns it
 * the structure is immediate, so the pool does not depend on the cache module.
 */
export interface WorkspaceDiagnosticsSink {
  attach(workspaceId: string, source: WorkspaceNotificationSource): () => void;
  forget(workspaceId: string): void;
}

/**
 * Connect the production line of the diagnostics line: `attach` exactly once for each LspClient immediately after spawn,* and when evict unregisters and forgets the workspace.
 *
 * It has been proven that BOTH things must be done: quit `detach()` to leave a handler alive, and
 * a late publishDiagnostics rebuilds the recently deleted item. The order between them is NO: `detach`
 * currently only flips one synchronization flag, there is no offset between the two calls so no publish will interfere
 * can enter. If `detach` someday becomes asynchronous, this order will again make sense and need one
 * private case proves it.
 */
export function diagnosticsAttachment(cache: WorkspaceDiagnosticsSink): WorkspaceAttachment {
  return (context: WorkspaceAttachContext): WorkspaceDetach | void => {
    if (context.client === undefined) return undefined;
    const detach = cache.attach(context.workspaceId, context.client);
    return () => {
      detach();
      cache.forget(context.workspaceId);
    };
  };
}

export interface WorkspacePoolOptions {
  cacheRoot: string;
  maxWorkspaces?: number;
  /** The process system boundary, injectable so lifecycle can be proven without starting a JVM. */
  spawnWorkspace?: (args: SpawnWorkspaceArgs) => Promise<SpawnedWorkspace>;
  /** Run once per spawned JDT LS process, never once per lease. */
  attachments?: readonly WorkspaceAttachment[];
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
  /** Populated once, by the single #startWorkspace call that owns this entry's process. */
  detachments: WorkspaceDetach[];
}

class JdtWorkspacePool implements WorkspacePool {
  readonly #cacheRoot: string;
  readonly #maxWorkspaces: number;
  readonly #spawnWorkspace: (args: SpawnWorkspaceArgs) => Promise<SpawnedWorkspace>;
  readonly #attachments: readonly WorkspaceAttachment[];
  readonly #entries = new Map<string, PoolEntry>();
  #tick = 0;
  #closed = false;

  public constructor(options: WorkspacePoolOptions) {    this.#cacheRoot = path.resolve(options.cacheRoot);
    this.#maxWorkspaces = options.maxWorkspaces ?? DEFAULT_MAX_WORKSPACES;
    if (!Number.isInteger(this.#maxWorkspaces) || this.#maxWorkspaces < 1) {
      throw new Error(`--max-workspaces must be a positive integer, got ${String(options.maxWorkspaces)}`);
    }
    this.#spawnWorkspace = options.spawnWorkspace ?? createJdtlsSpawner(this.#cacheRoot);
    this.#attachments = options.attachments ?? [];
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
        detachments: [],
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
    const spawned = await this.#spawnWorkspace({
      projectRoot: entry.projectRoot,
      canonicalRoot: entry.canonicalRoot,
      dataDir: entry.dataDir,
      workspaceId: entry.workspaceId,
    });

    // Exactly once per process: `started` is created once per entry (INV-POOL-5), so
    // every lease after that only awaits this same promise again and does not run attachment again.
    const context: WorkspaceAttachContext = {
      workspaceId: entry.workspaceId,
      projectRoot: entry.projectRoot,
      canonicalRoot: entry.canonicalRoot,
      dataDir: entry.dataDir,
      pid: spawned.pid,
      client: spawned.client,
    };
    try {
      for (const attach of this.#attachments) {
        const detach = attach(context);
        if (typeof detach === "function") entry.detachments.push(detach);
      }
    } catch (error) {// A broken attachment is a broken start. The newly born process must die with it, otherwise
      // pool leaves behind a JVM that no one owns and no one can kill.
      await this.#runDetachments(entry);
      await spawned.stop().catch(() => {});
      throw error;
    }
    return spawned;
  }

  /** Runs the attach order in reverse, and a failed detach cannot block the remaining detach. */
  async #runDetachments(entry: PoolEntry): Promise<void> {
    const detachments = entry.detachments.splice(0).reverse();
    for (const detach of detachments) {
      try {
        await detach();
      } catch {
        // Cleanup is best-effort: eviction still has to complete.
      }
    }
  }

  async #ensureCapacityFor(entry: PoolEntry): Promise<void> {
    while (this.#entries.size > this.#maxWorkspaces) {
      const victim = [...this.#entries.values()]
        .filter((candidate) => candidate !== entry && candidate.leases === 0 && candidate.state === "idle")
        .sort((a, b) => a.lastUsedTick - b.lastUsedTick)[0];
      if (victim === undefined) {
        // X-003's `cap-exceeded`: every live workspace is in use, so honoring the cap means
        // failing this call clearly rather than spawning over it or waiting unbounded.
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

    // Wait for start to finish BEFORE any cleanup. `entry.detachments` is complete only after
    // #startWorkspace finishes running, and evict falls in the middle of a cold start (~2.3 s) which is a common event:
    // `close()` evict EVERY entry, including entries in the "starting" state. Remove earlier than remove on one
    // array is empty — attachment registers right after and no one runs its detach function anymore, so
    // file-sync's `fs.watch` handle stays and the process never exits naturally.
    let spawned: SpawnedWorkspace | undefined;
    try {
      spawned = await victim.started;
    } catch {// A failed start has cleaned itself up in #startWorkspace: no processes to kill, and array
      // detach is empty so the detach below is no-op.
    }

    // Remove BEFORE killing the process. The danger lies in the opposite direction from the one usually told: one
    // Late notifications falling into the cache of the disappearing workspace are harmless, because `forget()`
    // in the detach function itself delete it immediately afterwards. What bears the force is the successor. `workspaceId` is
    // sha256 of the canonical root, independent of process generation, should be a concurrent acquisition for the same
    // root attaches a NEW process under this id while the victim is stopped. Invert `stop()`
    // forward will push `cache.forget(workspaceId)` after the full amnesty period STOP_GRACE_MS 5 000 ms,
    // about 2.3 s wider than cold start. The late forgetful turn deleted the diagnostics that the successor had just steamed
    // passive, so a reported JDT LS file reads back as "unreported" and INV-DIAG-1 breaks. In order
    // Currently, the gap is only one microtask that an asynchronous spawn cannot fit into.
    // Demonstration case: test/workspace/workspace-succession.spec.ts (TCON-DIAG-0004).
    await this.#runDetachments(victim);
    if (spawned !== undefined) {
      try {
        await spawned.stop();
      } catch {
        // A workspace that already died needs no killing.
      }
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
}// -------------------------------------------------------------------------------------------
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
