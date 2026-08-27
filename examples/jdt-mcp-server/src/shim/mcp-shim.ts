// mcp-shim — the stdio front end one MCP client talks to (harness/docs/design/runtime-model.md).
//
// Invariants owned here:
//   INV-SHIM-1  Nothing but single-line valid MCP messages ever reaches stdout; every log, warning
//               and daemon-side line goes to stderr.
//   INV-SHIM-3  A daemon restart is invisible to the client except as errors on calls in flight at
//               the moment of the restart: subsequent calls succeed with no client-side
//               re-initialisation.
//
// Topology: the MCP client launches this shim as its stdio subprocess; the shim owns no workspace
// pool and no JDT LS process. It converges on the one daemon per socket path via
// `daemon-supervisor.startDaemon` — the connect-or-spawn protocol lives there and is NOT reimplemented
// here. When no daemon is serving the path, `startDaemon` binds it in *this* process and the handle
// comes back with `role: "daemon"`; when one already serves it, the handle is `delegated` and already
// carries the live connection. Either way the shim then talks to the daemon over one socket.
//
// Two framings meet in this system and only one of them is ours: MCP is newline-delimited with no
// embedded newlines, LSP is `Content-Length`. `lsp-client` owns the second, this file the first, and
// the spec blesses reusing the stdio framing over a Unix socket verbatim ("Custom transports that run
// over a reliable bidirectional byte stream … SHOULD reuse the stdio framing", harness/docs/design/evidence.md).
//
// Why this is not `socket.pipe(process.stdout)`:
//
//   1. INV-SHIM-1 is a property of *stdout*, and the shim is the last thing standing in front of it.
//      A raw pipe forwards whatever the daemon side happens to emit — a stack trace, a warning, a
//      half-written progress line — straight into the client's parser, and the MCP spec says the
//      server "MUST NOT write anything to its stdout that is not a valid MCP message". So every line
//      coming off the socket is framed and checked here, and anything that is not one MCP message is
//      diverted to stderr rather than forwarded.
//   2. INV-SHIM-3 needs whole-message granularity. A byte pipe that loses its socket mid-message has
//      already handed half a message to a daemon that is gone; the other half would go to the
//      replacement. Buffering *complete lines* is what makes a reconnect safe: the shim only ever
//      writes whole messages, so a restart can cost in-flight calls but can never corrupt the frame.

import { connect, type Socket } from "node:net";
import path from "node:path";
import { StringDecoder } from "node:string_decoder";
import type { Readable, Writable } from "node:stream";

import {
  resolveSocketPath,
  startDaemon as defaultStartDaemon,
  type DaemonHandle,
  type DaemonRole,
  type DaemonSupervisorOptions,
} from "../daemon/daemon-supervisor.ts";

/** Pause between reconnect attempts after the daemon link drops. */
export const DEFAULT_RECONNECT_DELAY_MS = 25;
/** Bound on the reconnect loop, so a permanently dead socket path fails loudly instead of spinning. */
export const DEFAULT_MAX_RECONNECT_ATTEMPTS = 40;

/** The launcher seam. Defaults to the real `startDaemon`; tests inject to control *when* it runs. */
export type LaunchDaemon = (options: DaemonSupervisorOptions) => Promise<DaemonHandle>;

export interface McpShimOptions {
  /** Full socket path; defaults to `<runtimeDir>/jdt-mcp.sock`, exactly as the daemon resolves it. */
  socketPath?: string;
  runtimeDir?: string;
  /** The client side of the MCP stdio transport. Defaults to this process's own streams. */
  stdin?: Readable;
  stdout?: Writable;
  stderr?: Writable;
  launch?: LaunchDaemon;
  /** Used only when this process ends up being the daemon; the daemon's wire protocol is not ours. */
  onConnection?: (socket: Socket) => void;
  probeTimeoutMs?: number;
  startTimeoutMs?: number;
  shutdownOnSignals?: readonly NodeJS.Signals[];
  reconnectDelayMs?: number;
  maxReconnectAttempts?: number;
}

export interface McpShimStats {
  /** True while a daemon link is established and writable. */
  connected: boolean;
  /** How many times a daemon link was established, first one included. */
  links: number;
  /** Links established *after* the first, i.e. transparent reconnects (INV-SHIM-3). */
  reconnects: number;
  /** Whole MCP lines handed to the daemon. */
  linesToDaemon: number;
  /** Whole MCP lines written to the client's stdout. */
  linesToClient: number;
  /** Lines from the daemon that were NOT valid MCP messages and went to stderr instead (INV-SHIM-1). */
  divertedLines: number;
  /** Client lines held because no link was up; they are flushed in order once one is. */
  bufferedLines: number;
}

export interface McpShim {
  readonly socketPath: string;
  /** Role of the *current* link: `daemon` if this process hosts it, `delegated` if it converged. */
  readonly role: DaemonRole;
  stats(): McpShimStats;
  /** Resolves once the shim has stopped forwarding; never rejects. */
  readonly done: Promise<void>;
  stop(): Promise<void>;
}

/**
 * The stdout gate. A line qualifies only if it parses as JSON *and* is a JSON-RPC object or a batch
 * array — the two shapes MCP puts on the wire. A bare `42`, an empty line, a stack trace or a
 * half-flushed log line all fail, and failing is the point: those are the lines that would otherwise
 * break the client's one-message-per-line contract.
 */
export function isMcpMessage(line: string): boolean {
  const trimmed = line.trim();
  if (trimmed.length === 0) return false;
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return false;
  }
  return typeof parsed === "object" && parsed !== null;
}

/**
 * Reassembles newline-delimited frames from arbitrary chunk boundaries.
 *
 * `StringDecoder` rather than `chunk.toString()`: a socket can split a multi-byte UTF-8 character
 * across two reads, and decoding each chunk independently turns an identifier with a non-ASCII
 * character into two replacement characters — a corrupted message that still parses as JSON, which is
 * the worst possible failure mode here.
 */
class LineFramer {
  readonly #decoder = new StringDecoder("utf8");
  #buffer = "";

  push(chunk: Buffer | string, onLine: (line: string) => void): void {
    this.#buffer += typeof chunk === "string" ? chunk : this.#decoder.write(chunk);
    for (;;) {
      const index = this.#buffer.indexOf("\n");
      if (index < 0) return;
      const line = this.#buffer.slice(0, index);
      this.#buffer = this.#buffer.slice(index + 1);
      onLine(line);
    }
  }

  /** Whatever is left when the stream ends: a final message the peer forgot to terminate. */
  flush(onLine: (line: string) => void): void {
    const rest = this.#buffer + this.#decoder.end();
    this.#buffer = "";
    if (rest.length > 0) onLine(rest);
  }
}

export async function startShim(options: McpShimOptions = {}): Promise<McpShim> {
  const stdin = options.stdin ?? process.stdin;
  const stdout = options.stdout ?? process.stdout;
  const stderr = options.stderr ?? process.stderr;
  const launch = options.launch ?? defaultStartDaemon;
  const socketPath = path.resolve(options.socketPath ?? resolveSocketPath({ runtimeDir: options.runtimeDir }));
  const reconnectDelayMs = options.reconnectDelayMs ?? DEFAULT_RECONNECT_DELAY_MS;
  const maxReconnectAttempts = options.maxReconnectAttempts ?? DEFAULT_MAX_RECONNECT_ATTEMPTS;

  let handle: DaemonHandle | undefined;
  let link: Socket | undefined;
  let stopped = false;
  let reconnecting = false;
  let links = 0;
  let reconnects = 0;
  let linesToDaemon = 0;
  let linesToClient = 0;
  let divertedLines = 0;
  /** Whole client messages waiting for a link. Whole ones only — see the file header, point 2. */
  const pending: string[] = [];

  let finish!: () => void;
  const done = new Promise<void>((resolve) => {
    finish = resolve;
  });

  /**
   * The only diagnostic channel this file has. Every message the shim itself produces goes here;
   * there is deliberately no other write path to `stdout` than `forwardToClient`.
   */
  function log(message: string): void {
    stderr.write(`jdt-mcp shim: ${message}\n`);
  }

  function describe(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }

  /** INV-SHIM-1: the single gate in front of the client's stdout. */
  function forwardToClient(line: string): void {
    if (line.trim().length === 0) return;
    if (!isMcpMessage(line)) {
      divertedLines += 1;
      log(`diverted a non-MCP line from the daemon channel: ${JSON.stringify(line.slice(0, 300))}`);
      return;
    }
    linesToClient += 1;
    stdout.write(`${line}\n`);
  }

  function sendToDaemon(line: string): void {
    if (line.trim().length === 0) return;
    if (link !== undefined && link.writable) {
      link.write(`${line}\n`);
      linesToDaemon += 1;
      return;
    }
    pending.push(line);
  }

  function flushPending(): void {
    while (pending.length > 0 && link !== undefined && link.writable) {
      const line = pending.shift();
      if (line === undefined) return;
      link.write(`${line}\n`);
      linesToDaemon += 1;
    }
  }

  function attach(socket: Socket): void {
    link = socket;
    const framer = new LineFramer();
    socket.on("data", (chunk: Buffer) => framer.push(chunk, forwardToClient));
    // Not "a socket with no `error` listener throws": a delegated socket already carries
    // `probeDaemon`'s surplus listener, so without this line the error vanishes without a trace
    // instead of crashing. Measured: deleting this handler makes the link-error case time out on its
    // stderr assertion, never on a crash. An error here must never surface as a client-side message,
    // only as a reconnect. `close` follows either way and is where the reconnect is decided.
    socket.on("error", (error: Error) => log(`daemon link error: ${describe(error)}`));
    socket.once("close", () => {
      if (link !== socket) return;
      link = undefined;
      framer.flush(forwardToClient);
      if (stopped) return;
      log("daemon link closed; reconnecting transparently (INV-SHIM-3)");
      void reconnect();
    });
  }

  function connectOnce(): Promise<Socket> {
    return new Promise<Socket>((resolve, reject) => {
      const socket = connect(socketPath);
      socket.once("connect", () => resolve(socket));
      socket.once("error", reject);
    });
  }

  /**
   * Establishes one link. A `delegated` handle owns nothing but its connection, so a dead one is
   * released and the connect-or-spawn dance re-run; a `daemon` handle means this process is serving
   * the path, so only the client end of the loopback connection is remade.
   *
   * On any failure the handle is dropped, so the next attempt re-runs the full protocol. That can
   * cost this process its own daemon role, but it is only reachable once something has already
   * broken: a launcher that cannot connect to the socket it just bound has nothing worth preserving.
   */
  async function establish(): Promise<void> {
    if (handle !== undefined && handle.role === "delegated") {
      try {
        await handle.shutdown();
      } catch (error) {
        log(`releasing the previous daemon link failed: ${describe(error)}`);
      }
      handle = undefined;
    }
    try {
      handle ??= await launch({
        socketPath,
        onConnection: options.onConnection,
        probeTimeoutMs: options.probeTimeoutMs,
        startTimeoutMs: options.startTimeoutMs,
        shutdownOnSignals: options.shutdownOnSignals,
      });
      attach(handle.connection ?? (await connectOnce()));
    } catch (error) {
      const broken = handle;
      handle = undefined;
      if (broken !== undefined) {
        try {
          await broken.shutdown();
        } catch {
          // The link is already the problem; a failing teardown must not mask the original error.
        }
      }
      throw error;
    }
    links += 1;
    flushPending();
  }

  /**
   * INV-SHIM-3: the client is never told about this. Its stdin and stdout stay open throughout, so it
   * never has to re-initialise; the only cost of a daemon restart is the calls that were in flight.
   */
  async function reconnect(): Promise<void> {
    if (reconnecting || stopped) return;
    reconnecting = true;
    try {
      for (let attempt = 1; attempt <= maxReconnectAttempts; attempt += 1) {
        await sleep(reconnectDelayMs);
        if (stopped) return;
        try {
          await establish();
          reconnects += 1;
          log(`reconnected to the daemon on attempt ${attempt} (role=${handle?.role ?? "unknown"})`);
          return;
        } catch (error) {
          log(`reconnect attempt ${attempt}/${maxReconnectAttempts} failed: ${describe(error)}`);
        }
      }
      log(`giving up after ${maxReconnectAttempts} reconnect attempts to ${socketPath}`);
      await stop();
    } finally {
      reconnecting = false;
    }
  }

  const fromClient = new LineFramer();
  const onStdinData = (chunk: Buffer): void => fromClient.push(chunk, sendToDaemon);
  const onStdinEnd = (): void => {
    fromClient.flush(sendToDaemon);
    void stop();
  };

  async function stop(): Promise<void> {
    if (stopped) return done;
    stopped = true;
    stdin.off("data", onStdinData);
    stdin.off("end", onStdinEnd);
    link?.destroy();
    link = undefined;
    if (handle !== undefined) {
      const closing = handle;
      handle = undefined;
      try {
        await closing.shutdown();
      } catch (error) {
        log(`daemon shutdown during stop failed: ${describe(error)}`);
      }
    }
    finish();
    return done;
  }

  await establish();
  stdin.on("data", onStdinData);
  stdin.once("end", onStdinEnd);

  return {
    socketPath,
    get role(): DaemonRole {
      return handle?.role ?? "delegated";
    },
    stats(): McpShimStats {
      return {
        connected: link !== undefined && link.writable,
        links,
        reconnects,
        linesToDaemon,
        linesToClient,
        divertedLines,
        bufferedLines: pending.length,
      };
    },
    done,
    stop,
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms);
    timer.unref();
  });
}
