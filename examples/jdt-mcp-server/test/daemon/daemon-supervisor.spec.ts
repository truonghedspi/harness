// Level 1 oracle for feat-daemon-supervisor.
//
// Falsifiers under test:
//   INV-SHIM-2  N parallel launches each start their own daemon instead of converging on one.
//   INV-SHIM-4  daemon shutdown leaves a JDT LS child process running.
//
// The JDT LS process boundary itself is already pinned by workspace-pool's own specs, so the pool's
// spawn seam is injected here: what this file must prove is that the daemon *reaches* that
// termination path for every pool it owns, and that only one launcher ever binds the socket.
// Scope is the Unix-socket path only (A-004); the flagged HTTP front door (A-003) is out of scope.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { connect, type Socket } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  MAX_SOCKET_PATH_LENGTH,
  resolveSocketPath,
  SOCKET_FILE_NAME,
  startDaemon,
  type DaemonHandle,
} from "../../src/daemon/daemon-supervisor.ts";
import { createWorkspacePool, type SpawnWorkspaceArgs, type WorkspacePool } from "../../src/workspace/workspace-pool.ts";

/** Short prefix on purpose: sun_path is 104 bytes on macOS, and tmpdir() already eats ~52 of them. */
function makeRoot(): string {
  return mkdtempSync(path.join(tmpdir(), "jdt-d-"));
}

function makeProject(root: string, name: string): string {
  const projectRoot = path.join(root, name);
  mkdirSync(projectRoot, { recursive: true });
  return projectRoot;
}

interface FakeChild {
  pid: number;
  stopped: boolean;
  dataDir: string;
}

/** Stands in for the JDT LS children a real pool spawns; `stopped` is the INV-SHIM-4 observation. */
function makeSpawnRecorder(): {
  spawnWorkspace: (args: SpawnWorkspaceArgs) => Promise<{ pid: number; stop(): Promise<void> }>;
  children: FakeChild[];
} {
  const children: FakeChild[] = [];
  let nextPid = 7_100;
  return {
    children,
    spawnWorkspace: async (args) => {
      await new Promise((resolve) => setTimeout(resolve, 1));
const child: FakeChild = { pid: nextPid++, stopped: false, dataDir: args.dataDir };
      children.push(child);
      return {
        pid: child.pid,
        stop: async () => {
          child.stopped = true;
        },
      };
    },
  };
}

async function poolWithWorkspaces(
  root: string,
  name: string,
  projectNames: readonly string[],
): Promise<{ pool: WorkspacePool; children: FakeChild[] }> {
  const recorder = makeSpawnRecorder();
  const pool = createWorkspacePool({
    cacheRoot: path.join(root, `${name}-cache`),
    maxWorkspaces: projectNames.length,
    spawnWorkspace: recorder.spawnWorkspace,
  });
  for (const projectName of projectNames) {
    const lease = await pool.acquire(makeProject(root, `${name}-${projectName}`));
    await lease.release();
  }
  return { pool, children: recorder.children };
}

async function waitFor(predicate: () => boolean, budgetMs: number, describe: string): Promise<void> {
  const deadline = Date.now() + budgetMs;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error(`timed out after ${budgetMs} ms waiting for: ${describe}`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

function connectOnce(socketPath: string): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const socket = connect(socketPath);
    socket.once("connect", () => resolve(socket));
    socket.once("error", reject);
  });
}

/** Default budget for all cleanup calls; see `withBudget` annotation. */
const CLEANUP_BUDGET_MS = 5_000;

/**
 * `node --test` applies `{ timeout }` to the test function BODY, not the `t.after` hook. An `await`
 * Up to promise never settles in the cleanup hook so it hangs indefinitely: the runtime doesn't report any errors,
 * doesn't end, and eats up baseline's budget. `server.close()` is a promise like
 * so — it only calls the callback when all accepted connections are closed.
 *
 * Every shutdown call, whether in the hook or in the body, must go through here so that the overdue becomes one
 * controlled error instead of a silent hang.
 */
async function withBudget<T>(label: string, budgetMs: number, work: () => Promise<T>): Promise<T> {const expired = Symbol("budget-expired");
  let timer: NodeJS.Timeout | undefined;
  const outcome = await Promise.race([
    work().then(
      (value) => ({ ok: true as const, value }),
      (error: unknown) => ({ ok: false as const, error }),
    ),
    // Intentionally NOT unref(): this timer must also keep the event loop alive. `startDaemon` waits for lock
    // timer has been unrefed, so if there are no refs, the event loop is exhausted and node --test destroys the entire file
    // "Promise resolution is still pending" instead of properly reporting which cases are overdue.
    new Promise<typeof expired>((resolve) => {
      timer = setTimeout(() => resolve(expired), budgetMs);
    }),
  ]);
  if (timer !== undefined) clearTimeout(timer);
  if (outcome === expired) {
    throw new Error(`budget exceeded: ${label} did not settle within ${budgetMs} ms`);
  }
  if (!outcome.ok) throw outcome.error;
  return outcome.value;
}

/** Each handle has its own budget, so a stuck handle does not block the remaining cleanup. */
async function shutdownAll(handles: readonly DaemonHandle[]): Promise<void> {
  const failures: unknown[] = [];
  for (const [index, handle] of handles.entries()) {
    try {
      await withBudget(`shutdown() of handle #${index} (role=${handle.role})`, CLEANUP_BUDGET_MS, () =>
        handle.shutdown(),
      );
    } catch (error) {
      failures.push(error);
    }
  }
  if (failures.length > 0) throw new AggregateError(failures, "cleanup could not shut every daemon handle down");
}

test("resolveSocketPath uses $XDG_RUNTIME_DIR and falls back to the temp dir (A-004)", () => {
  assert.equal(
    resolveSocketPath({ env: { XDG_RUNTIME_DIR: "/run/user/501" } }),
    path.join("/run/user/501", SOCKET_FILE_NAME),
  );
  assert.equal(resolveSocketPath({ env: {} }), path.join(tmpdir(), SOCKET_FILE_NAME));
  assert.ok(MAX_SOCKET_PATH_LENGTH <= 103, "the guard must stay within the smallest sun_path (macOS, 104 bytes)");
});

test(
  "INV-SHIM-2: N concurrent launches converge on exactly one daemon, the rest delegate to it",
  { timeout: 15_000 },
  async(t) => {
    const root = makeRoot();
    const socketPath = path.join(root, SOCKET_FILE_NAME);
    const accepted: Socket[] = [];    const handles: DaemonHandle[] = [];
    t.after(async () => {
      await shutdownAll(handles);
      rmSync(root, { recursive: true, force: true });
    });

    const launches = Array.from({ length: 5 }, () =>
      startDaemon({
        socketPath,
        shutdownOnSignals: [],
        onConnection: (socket) => accepted.push(socket),
      }),
    );
    handles.push(...(await Promise.all(launches)));

    const daemons = handles.filter((handle) => handle.role === "daemon");
    const delegated = handles.filter((handle) => handle.role === "delegated");
    assert.equal(
      daemons.length,
      1,
      `5 parallel launches must bind exactly one daemon, bound ${daemons.length}`,
    );
    assert.equal(delegated.length, 4, "every launcher that did not bind must have delegated, not failed");
    assert.equal(
      new Set(handles.map((handle) => handle.daemonPid)).size,
      1,
      "every launcher must name the same single daemon pid",
    );
    assert.equal(handles[0]?.daemonPid, process.pid, "the daemon pid must be the process that actually bound");

    // The delegating launchers must be talking to *that* daemon, not merely be silent about it.
    for (const handle of delegated) assert.ok(handle.connection !== undefined, "a delegated launcher keeps its link");
    await waitFor(() => accepted.length === 4, 5_000, "the one daemon to accept all 4 delegated connections");
    assert.ok(statSync(socketPath).isSocket(), "exactly one socket file must exist at the agreed path");
  },
);

test(
  "INV-SHIM-2: a stale socket file left by a killed daemon is cleaned up and rebound, not EADDRINUSE",
  { timeout: 15_000 },
  async (t) => {
    const root = makeRoot();
    const socketPath = path.join(root, SOCKET_FILE_NAME);
    const handles: DaemonHandle[] = [];
    t.after(async () => {
      await shutdownAll(handles);
      rmSync(root, { recursive: true, force: true });
    });

    // A real orphan: SIGKILL gives the child no chance to unlink its own socket.
    const orphan = spawn(
      process.execPath,
      ["-e", 'require("net").createServer().listen(process.argv[1], () => console.log("listening"))', socketPath],
      { stdio: ["ignore", "pipe", "inherit"] },
    );
    await new Promise<void>((resolve, reject) => {
      orphan.stdout.on("data", (chunk: Buffer) => {
        if (chunk.toString().includes("listening")) resolve();
      });
      orphan.once("error", reject);
    });
    const orphanExited = new Promise<void>((resolve) => orphan.once("exit", () => resolve()));
    orphan.kill("SIGKILL");
    await orphanExited;
    assert.ok(existsSync(socketPath), "precondition: the killed daemon must have left its socket file behind");

    const handle = await startDaemon({ socketPath, shutdownOnSignals: [] });
    handles.push(handle);
    assert.equal(handle.role, "daemon", "a stale socket must not be mistaken for a live daemon");

    const client = await connectOnce(socketPath);
    t.after(() => client.destroy());
    assert.ok(client.writable, "the rebound socket must actually serve connections");
  },
);

test(
  "INV-SHIM-4: shutdown terminates every JDT LS child of every pool the daemon owns",
  { timeout: 15_000 },
  async (t) => {
    const root = makeRoot();
    const socketPath = path.join(root, SOCKET_FILE_NAME);
    t.after(() => rmSync(root, { recursive: true, force: true }));

    const constructed = await poolWithWorkspaces(root, "boot", ["alpha", "beta"]);
    const adopted = await poolWithWorkspaces(root, "late", ["gamma"]);
    const handle = await startDaemon({ socketPath, pools: [constructed.pool], shutdownOnSignals: [] });
    handle.adopt(adopted.pool);

    const children = [...constructed.children, ...adopted.children];
    assert.equal(children.length, 3, "precondition: the daemon owns three live JDT LS children");
    assert.deepEqual(
      children.map((child) => child.stopped),
      [false, false, false],
      "precondition: no child is stopped before shutdown",
    );

    await handle.shutdown();

    const survivors = children.filter((child) => !child.stopped);
    assert.deepEqual(
      survivors.map((child) => child.pid),
      [],
      `shutdown left ${survivors.length} JDT LS child process(es) running`,
    );
    assert.equal(existsSync(socketPath), false, "shutdown must not leave its own socket file behind");
  },
);

test(
"shutdown releases the socket and the lock, so the next launcher becomes the daemon",
  { timeout: 15_000 },
  async(t) => {
    const root = makeRoot();
    const socketPath = path.join(root, SOCKET_FILE_NAME);
    const handles: DaemonHandle[] = [];
    t.after(async () => {
      await shutdownAll(handles);
      rmSync(root, { recursive: true, force: true });
    });

    const first = await startDaemon({ socketPath, shutdownOnSignals: [] });
    assert.equal(first.role, "daemon");
    await first.shutdown();
    await first.shutdown(); // idempotent: a second shutdown must not throw

    const second = await startDaemon({ socketPath, shutdownOnSignals: [] });
    handles.push(second);
    assert.equal(second.role, "daemon", "after a clean shutdown the path must be claimable again");
    assert.equal(existsSync(`${socketPath}.lock`), true, "the live daemon must hold its single-instance lock");
  },
);

test(
  "INV-SHIM-2: a lock file orphaned by a killed daemon is reclaimed at once, not honored until timeout",
  { timeout: 15_000 },
  async(t) => {
    const root = makeRoot();
    const socketPath = path.join(root, SOCKET_FILE_NAME);
    const lockPath = `${socketPath}.lock`;
    const handles: DaemonHandle[] = [];
    t.after(async () => {
      await shutdownAll(handles);
      rmSync(root, { recursive: true, force: true });
    });

    // A pid is definitely dead: run a node process that exits now, waiting for the exit event (Node has
    // reap it at that time), then reuse the same pid as the key owner.
    const dead = spawn(process.execPath, ["-e", "process.exit(0)"], { stdio: "ignore" });
    const deadPid = dead.pid;
    await new Promise<void>((resolve) => dead.once("exit", () => resolve()));
    assert.ok(deadPid !== undefined, "precondition: the throwaway process must have reported a pid");
    writeFileSync(lockPath, `${deadPid}\n`);
    assert.equal(
      existsSync(socketPath),
      false,
      "precondition: the only leftover is lock garbage — no socket file, so the probe cannot short-circuit",
    );

    // The required budget (1 s) is set well below the initialization budget (2 s): orphan key revocation must occur// came out on the first try. If the revocation branch is disabled, startDaemon loops until the end
    // startTimeoutMs then throws an error — meaning every launch after a crash is permanently broken.
    const startTimeoutMs = 2_000;
    const startsAt = Date.now();
    const handle = await withBudget("startDaemon over an orphaned lock file", 1_000, () =>
      startDaemon({ socketPath, shutdownOnSignals: [], startTimeoutMs }),
    );
    const elapsedMs = Date.now() - startedAt;
    handles.push(handle);

    assert.equal(handle.role, "daemon", "a lock whose owner is gone must be reclaimed, not treated as live");
    assert.ok(
      elapsedMs < 500,
      `reclaiming an orphaned lock must be immediate, took ${elapsedMs} ms of the ${startTimeoutMs} ms budget`,
    );
    assert.equal(
      readFileSync(lockPath, "utf8").trim(),
      String(process.pid),
      "the reclaimed lock must now carry this daemon's pid, not the dead owner's",
    );
    assert.ok(statSync(socketPath).isSocket(), "the reclaiming launcher must actually bind the socket");
  },
);

test(
  "INV-SHIM-2: shutting down a delegated launcher down must not tear down the daemon it converged on",
  { timeout: 15_000 },
  async(t) => {
    const root = makeRoot();
    const socketPath = path.join(root, SOCKET_FILE_NAME);
    const accepted: Socket[] = [];
    const handles: DaemonHandle[] = [];
    t.after(async () => {
      await shutdownAll(handles);
      rmSync(root, { recursive: true, force: true });
    });

    const launches = Array.from({ length: 5 }, () =>
      startDaemon({
        socketPath,
        shutdownOnSignals: [],
        onConnection: (socket) => accepted.push(socket),
      }),
    );
    handles.push(...(await Promise.all(launches)));
    const daemon = handles.find((handle) => handle.role === "daemon");
    const delegated = handles.filter((handle) => handle.role === "delegated");
    assert.ok(daemon !== undefined, "precondition: exactly one launcher must have bound the socket");
    assert.equal(delegated.length, 4, "precondition: the other four launchers must have delegated");

    await delegated[0]!.shutdown();// All three statements below say the same thing: the delegated handle only owns its connection.
    assert.equal(
      existsSync(socketPath),
      true,
      "a delegated shutdown must leave the daemon's socket file in place, it owns only its own connection",
    );
    assert.ok(statSync(socketPath).isSocket(), "and what it left in place must still be the daemon's socket");
    assert.equal(existsSync(`${socketPath}.lock`), true, "a delegated shutdown must not release the daemon's lock");
    const client = await connectOnce(socketPath);
    t.after(() => client.destroy());
    await waitFor(
      () => accepted.length >= 5,
      5_000,
      "the daemon to keep accepting connections after one delegated launcher shut down",
    );
    assert.ok(client.writable, "the daemon must still serve new clients");

    // Counterexample: only shutdown of the daemon handle itself can remove the socket.
    await withBudget("the daemon's own shutdown", CLEANUP_BUDGET_MS, () => daemon.shutdown());
    assert.equal(existsSync(socketPath), false, "only the daemon's own shutdown removes the socket file");
  },
);

test(
  "startDaemon refuses a socket path longer than sun_path instead of failing inside libuv",
  { timeout: 15_000 },
  async(t) => {
    const root = makeRoot();
    // If the gate is disabled, startDaemon still returns a listening handle. That handle is right
    // is collected here, otherwise the leak server keeps the event loop alive and the spec file hanging on exit
    // instead of reporting a red case.
    const leaked: DaemonHandle[] = [];
    t.after(async () => {
      await shutdownAll(leaked);
      rmSync(root, { recursive: true, force: true });
    });

    const tooLongPath = path.join(root, "n".repeat(160), SOCKET_FILE_NAME);
    const actualBytes = Buffer.byteLength(tooLongPath);
    assert.ok(
      actualBytes > MAX_SOCKET_PATH_LENGTH,
      `precondition: the path must exceed the guard (${actualBytes} vs ${MAX_SOCKET_PATH_LENGTH})`,
    );

    // Measured on Node 22.23.2 / macOS: remove the blocking gate NOT giving an error. `listen()` reports success,
    // `server.listening` is true, but libuv truncates the name to sun_path so there is NO socket file// at the requested path. probe's `existsSync(socketPath)` door is therefore forever false, and every
    // the launcher then never sees the daemon to converge on — INV-SHIM-2 crashes silently.
    await assert.rejects(
      async() => {
        leaked.push(await startDaemon({ socketPath: tooLongPath, shutdownOnSignals: [], startTimeoutMs: 1_000 }));
      },
      (error: NodeJS.ErrnoException) => {
        assert.match(
          error.message,
          /too long/i,
          `the refusal must name the reason, got: ${error.message}`,
        );
        assert.match(
          error.message,
          new RegExp(`\\b${actualBytes}\\b`),
          `the refuses must name the actual byte length ${actualBytes}, got: ${error.message}`,
        );
        assert.match(
          error.message,
          new RegExp(`\\b${MAX_SOCKET_PATH_LENGTH}\\b`),
          `the refuses must name the limit ${MAX_SOCKET_PATH_LENGTH}, received: ${error.message}`,
        );
        assert.equal(
          error.code,
          undefined,
          `an explicit carries no errno; an opaque libuv failure does (${String(error.code)})`,
        );
        return true;
      },
    );

    // Rejection must occur BEFORE any side effects on the filesystem.
    assert.equal(existsSync(path.dirname(tooLongPath)), false, "a refused path must not create its directory");
    assert.equal(existsSync(`${tooLongPath}.lock`), false, "a refused path must not leave a lock file behind");
  },
);

test(
  "INV-SHIM-4: shutdown destroys the connections it accepted, so the server close actually completes",
  { timeout: 15_000 },
  async(t) => {
    const root = makeRoot();
    const socketPath = path.join(root, SOCKET_FILE_NAME);
    const handles: DaemonHandle[] = [];
    t.after(async () => {
      await shutdownAll(handles);
      rmSync(root, { recursive: true, force: true });
    });

    const handle = await startDaemon({ socketPath, shutdownOnSignals: [] });
    handles.push(handle);
    const client = await connectOnce(socketPath);
    t.after(() => client.destroy());
    const clientClosed = new Promise<void>((resolve) => client.once("close", () => resolve()));// The budget is in the BODY of ca, not in the `t.after` hook, because `node --test` only applies `{ timeout }`
    // for function body. The number 1 s is completely below the FORCE_CLOSE_AFTER_MS (2 s) of closeServer: fast line
    // must destroy the connection immediately, so touching the forced line is already degenerate and must be red. Door
    // forced blocking is just a safety net so shutdown never hangs, not the normal path.
    const promptBudgetMs = 1_000;
    await withBudget("shutdown() with one accepted client connection still open", promptBudgetMs, () =>
      handle.shutdown(),
    );
    await withBudget("the accepted connection to be closed by shutdown", promptBudgetMs, () => clientClosed);
    assert.equal(existsSync(socketPath), false, "a completed shutdown removes its socket file");
  },
);

/** Absolute path to the module being tested, so that the child process loads the correct code. */
const SUPERVISOR_MODULE = path.resolve(import.meta.dirname, "../../src/daemon/daemon-supervisor.ts");

/**
 * Scenario of real daemon process: bind socket, accept exactly one connection, call `shutdown()`,
 * then DO NOT call `process.exit`. Whether the process exits or not therefore means exactly one thing — the following
 * When `shutdown()` resolves, is there any daemon handle left that keeps the event loop alive?
 *
 * The three markers printed to stdout separate three different failure modes: failure to bind, `shutdown()` not settling, and
 * `shutdown()` settles but the process still hangs.
 */
function daemonChildScript(): string {
  return `import { connect } from "node:net";
import { startDaemon } from ${JSON.stringify(SUPERVISOR_MODULE)};

const socketPath = process.argv[2];
let markAccepted;
const accepted = new Promise((resolve) => {
  markAccepted = resolve;
});
// Do not pass shutdownOnSignals: this must be the default configuration of a real daemon.
const handle = await startDaemon({ socketPath, onConnection: (socket) => markAccepted(socket) });
if (handle.role !== "daemon") {
  console.log("role=" + handle.role);
  process.exit(3);
}
console.log("listening");

const client = await new Promise((resolve, reject) => {
  const socket = connect(socketPath);
  socket.once("connect", () => resolve(socket));
  socket.once("error", reject);
});// unref: only the handle of the daemon itself has the right to decide whether the process lives or dies. If not
// unref, an open client also keeps the event loop and this shift will be red for unrelated reasons.
client.unref();
await accepted;
console.log("accepted");

await handle.shutdown();
console.log("shutdown-resolved");
// Intentionally NOT calling process.exit(): what must be proven is that there is nothing left to keep the event loop alive.
`;
}

test(
  "INV-SHIM-4: after shutdown() resolves, the daemon process itself can exit — no handle keeps the event loop alive",
  { timeout: 20_000 },
  async(t) => {
    const root = makeRoot();
    const socketPath = path.join(root, SOCKET_FILE_NAME);
    const scriptPath = path.join(root, "daemon-child.mjs");
    writeFileSync(scriptPath, daemonChildScript());

    // detached: the child process is its own process group, so when it expires, we can kill the whole group instead
    // leaves behind an orphaned daemon holding the socket.
    const child: ChildProcess = spawn(process.execPath, ["--experimental-strip-types", scriptPath, socketPath], {
      stdio: ["ignore", "pipe", "pipe"],
      detached: true,
    });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk: Buffer) => (stdout += chunk.toString()));
    child.stderr?.on("data", (chunk: Buffer) => (stderr += chunk.toString()));

    const killChildGroup = (): void => {
      if (child.exitCode !== null || child.signalCode !== null || child.pid === undefined) return;
      try {
        process.kill(-child.pid, "SIGKILL");
      } catch {
        child.kill("SIGKILL");
      }
    };
    t.after(() => {
      killChildGroup();
      rmSync(root, { recursive: true, force: true });
    });

    const exited = new Promise<{ code: number | null; null; signals: NodeJS.Signals | null }>((resolve) => {
      child.once("exit", (code, signal) => resolve({ code, signal }));
    });

    // The budget is in the case BODY, not in the hook t.after: overdue must become a red case WITH NAME,
    // and the child process must be killed right there and then — never let the runtime hang.
    const exitBudgetMs = 5_000;
    const startsAt = Date.now();
    let outcome: { code: number | null; null; signals: NodeJS.Signals | null };
    try {outcome = await withBudget("the daemon process to exit on its own after shutdown()", exitBudgetMs, () => exited);
    } catch (error) {
      killChildGroup();
      const reached = stdout.includes("shutdown-resolved")
        ? "shutdown() RESOLVED and the process still will not exit: a handle it opened is still holding the event loop"
        : "shutdown() never even resolved";
      throw new Error(
        `the daemon process was still alive ${Date.now() - startedAt} ms after being told to shut down — ${reached}` +
          ` (stdout: ${JSON.stringify(stdout)}; stderr: ${JSON.stringify(stderr.slice(-400))})`,
        { cause: error },
      );
    }
    const elapsedMs = Date.now() - startedAt;

    // The order of milestones proves that the process was actually a daemon before exiting, but not
    // exited early because of failure in the bind step.
    assert.match(stdout, /^listening$/m, `the child must have bound the socket first (stderr: ${stderr.slice(-400)})`);
    assert.match(stdout, /^accepted$/m, "the daemon must have accepted a live connection before shutting down");
    assert.match(stdout, /^shutdown-resolved$/m, "shutdown() must have resolved inside the daemon process");
    assert.equal(
      outcome.signal,
      null,
      `the daemon must exit on its own, not be killed (signal=${String(outcome.signal)})`,
    );
    assert.equal(
      outcome.code,
      0,
      `the daemon process must exit cleanly after shutdown(), exited with code ${String(outcome.code)}`,
    );
    assert.ok(
      elapsedMs < exitBudgetMs,
      `exiting must follow shutdown() promptly, took ${elapsedMs} ms of the ${exitBudgetMs} ms budget`,
    );
    assert.equal(existsSync(socketPath), false, "the exited daemon must not leave its socket file behind");
    assert.equal(existsSync(`${socketPath}.lock`), false, "the exited daemon must not leave its lock file behind");
  },
);