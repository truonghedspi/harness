// daemon-supervisor — one daemon per socket path (harness/docs/design/runtime-model.md).
//
// Invariants owned here:
//   INV-SHIM-2  At most one daemon ever exists per socket path; concurrent launches converge on
//               that one daemon, never on two.
//   INV-SHIM-4  Daemon shutdown always terminates every JDT LS child it spawned — no orphaned JVM
//               survives it.
//
// Scope (A-004): the Unix-domain-socket path only — macOS and Linux for v1, the Windows named pipe
// is deferred to v1.1. The flagged Streamable HTTP front door (A-003) is out of scope for this cut,
// so nothing here validates `Origin`, binds a TCP port or authenticates: X-010 is still open and an
// unrequested auth surface would be a decision this component is not entitled to make.
//
// The convergence protocol, in the order that makes the race safe:
//   1. probe: connect() to the socket path. A completed connection proves a live daemon owns it,
//      so this launcher delegates to it and never binds.
//   2. lock: take `<socket>.lock` with O_EXCL. Only the holder may unlink a socket file or bind.
//      This is what stops two launchers that both saw a *stale* socket from both unlinking it —
//      the loser of the O_EXCL race would otherwise delete the winner's live socket and bind a
//      second daemon over it.
//   3. re-probe under the lock, then unlink the stale file, then listen(). The re-probe is belt and
//      braces, not a proven load-bearing step: because the lock is held for the daemon's whole life,
//      a launcher that reaches step 3 has already established that no live daemon holds the lock.
//      No test distinguishes its removal, so it is documented as redundancy rather than as safety.
//   4. a launcher that cannot take the lock loops back to step 1, so it ends up delegating to
//      whichever launcher won.
// The lock is held for the daemon's whole life and carries its pid, so a delegating launcher can
// name the single daemon it converged on.

import { closeSync, existsSync, mkdirSync, openSync, readFileSync, unlinkSync, writeSync } from "node:fs";
import { connect, createServer, type Server, type Socket } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";

import type { WorkspacePool } from "../workspace/workspace-pool.ts";

/** The socket file name the shim looks for inside the runtime directory. */
export const SOCKET_FILE_NAME = "jdt-mcp.sock";
/**
 * sockaddr_un.sun_path is 104 bytes on macOS and 108 on Linux, including the terminator.
 *
 * A longer path does not fail — that is why this guard has to exist. Measured on Node 22.23.2 /
 * macOS: `listen()` on a 234-byte path *succeeds*, `server.listening` is true and `address()` echoes
 * the full path back, but libuv truncated the name into sun_path, so no socket file is ever created
 * at the path that was asked for. `probeDaemon` opens with `existsSync(socketPath)`, which is then
 * permanently false, so no later launcher can ever see this daemon to converge on it: INV-SHIM-2
 * breaks silently, with a daemon that reports itself perfectly healthy.
 */
export const MAX_SOCKET_PATH_LENGTH = 103;

const DEFAULT_PROBE_TIMEOUT_MS = 250;
const DEFAULT_START_TIMEOUT_MS = 5_000;
const LOCK_RETRY_MS = 20;
/** How long `shutdown()` waits for a graceful `server.close()` before forcing the sockets shut. */
const FORCE_CLOSE_AFTER_MS = 2_000;

/** Connect errors that all mean the same thing: nobody is serving this path right now. */
const NO_LIVE_DAEMON_CODES = new Set(["ENOENT", "ECONNREFUSED", "ECONNRESET", "ENOTSOCK", "EPIPE"]);

export type DaemonRole = "daemon" | "delegated";

export interface DaemonSupervisorOptions {
  /** Full socket path; defaults to `<runtimeDir>/jdt-mcp.sock`. */
  socketPath?: string;
  /** Overrides `$XDG_RUNTIME_DIR` resolution; mainly a test seam. */
  runtimeDir?: string;
  /** Pools the daemon owns from the start; every one of them is closed by `shutdown()`. */
  pools?: readonly WorkspacePool[];
  /** Called for each accepted client connection. The wire protocol belongs to `mcp-shim`. */
  onConnection?: (socket: Socket) => void;
  probeTimeoutMs?: number;
  /** Upper bound on the whole converge-or-bind dance, including waiting out a contended lock. */
  startTimeoutMs?: number;
  /** Signals that trigger `shutdown()`. Set to `[]` to own process lifecycle yourself. */
  shutdownOnSignals?: readonly NodeJS.Signals[];
}

export interface DaemonHandle {
  /** `daemon` if this launcher owns the socket; `delegated` if it converged on an existing one. */
  readonly role: DaemonRole;
  readonly socketPath: string;
  /** The pid of the single daemon serving this socket path, ours or the one we converged on. */
  readonly daemonPid: number | undefined;
  /** The live connection to the daemon; only present for a `delegated` handle. */
  readonly connection: Socket | undefined;
  /** Hand a pool to the daemon so that `shutdown()` is guaranteed to terminate its children. */
  adopt(pool: WorkspacePool): void;
  shutdown(): Promise<void>;
}

/**
 * A-004: `$XDG_RUNTIME_DIR` is the spec'd home for per-user sockets, but macOS does not set it and
 * systemd-less Linux may not either, so fall back to the OS temp dir rather than refusing to start.
 */
export function resolveSocketPath(options: { runtimeDir?: string; env?: NodeJS.ProcessEnv } = {}): string {
  const env = options.env ?? process.env;
  const runtimeDir = options.runtimeDir ?? env["XDG_RUNTIME_DIR"] ?? tmpdir();
  return path.join(runtimeDir, SOCKET_FILE_NAME);
}

export async function startDaemon(options: DaemonSupervisorOptions = {}): Promise<DaemonHandle> {
  const socketPath = path.resolve(options.socketPath ?? resolveSocketPath({ runtimeDir: options.runtimeDir }));
  if (Buffer.byteLength(socketPath) > MAX_SOCKET_PATH_LENGTH) {
    throw new Error(
      `Unix socket path is too long (${Buffer.byteLength(socketPath)} > ${MAX_SOCKET_PATH_LENGTH} bytes): ${socketPath}`,
    );
  }
  const probeTimeoutMs = options.probeTimeoutMs ?? DEFAULT_PROBE_TIMEOUT_MS;
  const startTimeoutMs = options.startTimeoutMs ?? DEFAULT_START_TIMEOUT_MS;
  const lockPath = `${socketPath}.lock`;
  mkdirSync(path.dirname(socketPath), { recursive: true });

  const deadline = Date.now() + startTimeoutMs;
  for (;;) {
    const existing = await probeDaemon(socketPath, probeTimeoutMs);
    if (existing !== undefined) return delegatedHandle(socketPath, existing, readLockPid(lockPath));

    const lock = acquireLock(lockPath);
    if (lock === undefined) {
      // Another launcher is mid-bind. Never unlink or bind without the lock (INV-SHIM-2); wait for
      // it to publish its socket and delegate to it on the next pass.
      if (Date.now() >= deadline) {
        throw new Error(`Timed out after ${startTimeoutMs} ms waiting for the daemon holding ${lockPath}`);
      }
      await sleep(LOCK_RETRY_MS);
      continue;
    }

    try {
      const raced = await probeDaemon(socketPath, probeTimeoutMs);
      if (raced !== undefined) {
        releaseLock(lock);
        return delegatedHandle(socketPath, raced, readLockPid(lockPath));
      }
      // Reached only under the lock, and only once the probe has proven nobody is listening: the
      // file is a leftover from a daemon that died without cleaning up. Removing it is what keeps
      // listen() from failing with EADDRINUSE forever.
      if (existsSync(socketPath)) unlinkSync(socketPath);
      return await bindDaemon(socketPath, lock, options);
    } catch (error) {
      releaseLock(lock);
      throw error;
    }
  }
}

async function bindDaemon(socketPath: string, lock: Lock, options: DaemonSupervisorOptions): Promise<DaemonHandle> {
  const pools: WorkspacePool[] = [...(options.pools ?? [])];
  const connections = new Set<Socket>();
  const server = createServer((socket) => {
    connections.add(socket);
    socket.once("close", () => connections.delete(socket));
    options.onConnection?.(socket);
  });

  await listenOnSocket(server, socketPath);

  let closed = false;
  let shuttingDown: Promise<void> | undefined;
  const signals = options.shutdownOnSignals ?? (["SIGINT", "SIGTERM"] as const);
  const onSignal = (): void => {
    void handle.shutdown();
  };
  for (const signal of signals) process.once(signal, onSignal);

  const handle: DaemonHandle = {
    role: "daemon",
    socketPath,
    daemonPid: process.pid,
    connection: undefined,
    adopt(pool: WorkspacePool): void {
      if (closed) {
        throw new Error("daemon-supervisor: cannot adopt a workspace pool after shutdown; close it directly");
      }
      pools.push(pool);
    },
    shutdown(): Promise<void> {
      shuttingDown ??= (async () => {
        closed = true;
        for (const signal of signals) process.removeListener(signal, onSignal);
        for (const socket of connections) socket.destroy();
        connections.clear();
        await closeServer(server, connections);

        // INV-SHIM-4: every adopted pool is closed, and one failing close never short-circuits the
        // rest — a single stuck pool must not be able to leave the other JVMs orphaned.
        const failures: unknown[] = [];
        for (const pool of pools.splice(0)) {
          try {
            await pool.close();
          } catch (error) {
            failures.push(error);
          }
        }

        safeUnlink(socketPath);
        releaseLock(lock);
        if (failures.length > 0) {
          throw new AggregateError(failures, "daemon shutdown could not close every workspace pool");
        }
      })();
      return shuttingDown;
    },
  };
  return handle;
}

function delegatedHandle(socketPath: string, connection: Socket, daemonPid: number | undefined): DaemonHandle {
  let closed = false;
  return {
    role: "delegated",
    socketPath,
    daemonPid,
    connection,
    adopt(): void {
      throw new Error(
        "daemon-supervisor: this launcher delegated to an existing daemon and owns no workspace pools",
      );
    },
    async shutdown(): Promise<void> {
      // Only the connection is ours. Tearing down the daemon we converged on is exactly the thing
      // a second launcher must never do.
      if (closed) return;
      closed = true;
      connection.destroy();
    },
  };
}

/**
 * Resolves to a live connection when a daemon owns the path, or `undefined` when nobody does
 * (missing file, stale socket, or a listener that never accepts within the probe budget).
 */
function probeDaemon(socketPath: string, timeoutMs: number): Promise<Socket | undefined> {
  return new Promise<Socket | undefined>((resolve, reject) => {
    if (!existsSync(socketPath)) {
      resolve(undefined);
      return;
    }
    let settled = false;
    const socket = connect(socketPath);
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(undefined);
    }, timeoutMs);
    timer.unref();
    socket.once("connect", () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(socket);
    });
    socket.once("error", (error: NodeJS.ErrnoException) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      if (error.code !== undefined && NO_LIVE_DAEMON_CODES.has(error.code)) {
        resolve(undefined);
        return;
      }
      reject(error);
    });
  });
}

function listenOnSocket(server: Server, socketPath: string): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const onError = (error: Error): void => {
      server.removeListener("listening", onListening);
      reject(error);
    };
    const onListening = (): void => {
      server.removeListener("error", onError);
      resolve();
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(socketPath);
  });
}

/**
 * INV-SHIM-4: closing the server is what lets the daemon process exit. `server.close()` releases
 * the listening handle, and until it does, that handle keeps the event loop alive — a `shutdown()`
 * that skips it leaves a process that answers "done" and then never dies, taking every JDT LS child
 * with it. The daemon-exits-after-shutdown case pins that at the process boundary.
 *
 * `forceAfterMs` is UNPROVEN REDUNDANCY, documented as such rather than claimed as the guarantee.
 * Measured on the current code: `shutdown()` destroys every accepted connection and clears the set
 * synchronously, and calls `server.close()` in the same turn, so no connection can enter the set
 * afterwards. Instrumenting both points shows `closeServer` is entered with 0 connections on all 8
 * shutdowns the spec performs, and the timer body never runs at all. Emptying that body therefore
 * changes nothing that any test can observe. It is kept as a net for a degraded path — a connection
 * that ever outlived the destroy above would wedge `close()` forever — not because anything here
 * depends on it.
 *
 * `net.Server` has no `closeAllConnections()` (that is `http.Server` only), so the caller's own
 * connection set is the accounting used here.
 */
function closeServer(server: Server, connections: Set<Socket>, forceAfterMs = FORCE_CLOSE_AFTER_MS): Promise<void> {
  return new Promise<void>((resolve) => {
    if (!server.listening) {
      resolve();
      return;
    }
    const forceTimer = setTimeout(() => {
      for (const socket of connections) socket.destroy();
      connections.clear();
    }, forceAfterMs);
    server.close(() => {
      clearTimeout(forceTimer);
      resolve();
    });
  });
}

interface Lock {
  path: string;
  fd: number;
}

/** `wx` is the whole point: the create is atomic, so exactly one launcher can hold the lock. */
function acquireLock(lockPath: string): Lock | undefined {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const fd = openSync(lockPath, "wx");
      writeSync(fd, `${process.pid}\n`);
      return { path: lockPath, fd };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      // A lock file whose owner is gone would otherwise wedge every future start.
      const owner = readLockPid(lockPath);
      if (owner === undefined || !isProcessAlive(owner)) {
        safeUnlink(lockPath);
        continue;
      }
      return undefined;
    }
  }
  return undefined;
}

function releaseLock(lock: Lock): void {
  try {
    closeSync(lock.fd);
  } catch {
    // Already closed; the unlink below is what actually frees the lock.
  }
  safeUnlink(lock.path);
}

function readLockPid(lockPath: string): number | undefined {
  try {
    const pid = Number.parseInt(readFileSync(lockPath, "utf8").trim(), 10);
    return Number.isInteger(pid) && pid > 0 ? pid : undefined;
  } catch {
    return undefined;
  }
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM means the process exists but belongs to someone else — still alive, still the owner.
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

function safeUnlink(target: string): void {
  try {
    unlinkSync(target);
  } catch {
    // Never fail a shutdown over a file that is already gone.
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms);
    timer.unref();
  });
}
