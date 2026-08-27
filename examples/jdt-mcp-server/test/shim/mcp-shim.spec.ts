// Level 1 + Level 3 oracle for feat-mcp-shim.
//
// Falsifiers under test:
//   INV-SHIM-1  a daemon-side error or log line reaches stdout during a session, breaking the
//               one-MCP-message-per-line contract.
//   INV-SHIM-3  a daemon restart mid-session forces the client to re-initialise instead of the shim
//               reconnecting transparently.
//
// Why two levels. INV-SHIM-1 is a property of the *process's real stdout*, not of a stream object the
// test handed in: a stray `console.log` anywhere in the shim writes to `process.stdout` and an
// in-process oracle holding an injected `Writable` would never see it. So the two INV-SHIM-1 cases
// spawn the shim as a real child process and read the bytes off its real stdout pipe. The rest —
// connect-or-spawn routing, reconnect bookkeeping, frame reassembly — is observable in-process and is
// tested there, where the assertions can be exact.
//
// Scope is the Unix-socket path only (A-004). The connect-or-spawn protocol itself belongs to
// daemon-supervisor and is proven by its own spec; what is proven here is that the shim *uses* it and
// what it does with the bytes on either side.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import type { Socket } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { PassThrough, Writable } from "node:stream";
import { StringDecoder } from "node:string_decoder";

import { SOCKET_FILE_NAME, startDaemon, type DaemonHandle } from "../../src/daemon/daemon-supervisor.ts";
import { isMcpMessage, startShim, type LaunchDaemon, type McpShim } from "../../src/shim/mcp-shim.ts";

/** Short prefix on purpose: sun_path is 104 bytes on macOS and tmpdir() already eats ~52 of them. */
function makeRoot(): string {
  return mkdtempSync(path.join(tmpdir(), "jdt-s-"));
}

interface Collector {
  stream: Writable;
  text(): string;
  lines(): string[];
}

function collector(): Collector {
  let text = "";
  const stream = new Writable({
    write(chunk: Buffer | string, _encoding, callback): void {
      text += typeof chunk === "string" ? chunk : chunk.toString("utf8");
      callback();
    },
  });
  return {
    stream,
    text: () => text,
    lines: () => text.split("\n").filter((line) => line.length > 0),
  };
}

/**
 * `describe` may be a thunk: a template string is built *before* the wait and therefore reports the
 * state the case started from, which is exactly the state that is uninteresting when it times out.
 */
async function waitFor(predicate: () => boolean, budgetMs: number, describe: string | (() => string)): Promise<void> {
  const deadline = Date.now() + budgetMs;
  while (!predicate()) {
    if (Date.now() >= deadline) {
      throw new Error(`timed out after ${budgetMs} ms waiting for: ${typeof describe === "string" ? describe : describe()}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Byte index of the *second* byte of `character` inside `buffer`, proven to be a UTF-8 continuation
 * byte (`0b10xxxxxx`). Cutting a chunk there splits one character across two reads, which is the only
 * input that tells `StringDecoder` apart from `chunk.toString("utf8")`.
 *
 * A fixture that merely *contains* non-ASCII text proves nothing: if every chunk boundary happens to
 * land on a character boundary, both decoders return the same text. So the property is asserted here
 * rather than claimed in a comment.
 */
function midCharacterCut(buffer: Buffer, character: string): number {
  const encoded = Buffer.from(character, "utf8");
  assert.ok(encoded.length >= 2, `the fixture character must be multi-byte, ${JSON.stringify(character)} is not`);
  const start = buffer.indexOf(encoded);
  assert.ok(start >= 0, `the fixture must contain ${JSON.stringify(character)}`);
  const cut = start + 1;
  assert.equal(
    (buffer[cut] as number) & 0xc0,
    0x80,
    `byte ${cut} must be a UTF-8 continuation byte, i.e. the cut really falls inside a character`,
  );
  return cut;
}

/**
 * Full-text equality with a failure message a human can read: two 200 KB strings printed side by side
 * say nothing, the index of the first divergence says everything.
 */
function assertSameText(actual: string | undefined, expected: string, what: string): void {
  if (actual === expected) return;
  if (actual === undefined) assert.fail(`${what}: nothing arrived at all`);
  let index = 0;
  while (index < actual.length && index < expected.length && actual[index] === expected[index]) index += 1;
  assert.fail(
    `${what}: differs at character ${index} — expected ${JSON.stringify(expected.slice(index, index + 24))}, ` +
      `got ${JSON.stringify(actual.slice(index, index + 24))} (lengths ${expected.length} vs ${actual.length})`,
  );
}

/**
 * A daemon-side handler that answers each request with a tagged result. `noiseBefore` is written to
 * the socket *before* each answer, which is the INV-SHIM-1 hazard in its purest form: the daemon
 * channel carries something that is not an MCP message.
 */
function taggedResponder(
  tag: string,
  received: string[],
  noiseBefore: readonly string[] = [],
): (socket: Socket) => void {
  return (socket: Socket): void => {
    let buffer = "";
    socket.on("data", (chunk: Buffer) => {
      buffer += chunk.toString("utf8");
      for (;;) {
        const index = buffer.indexOf("\n");
        if (index < 0) return;
        const line = buffer.slice(0, index);
        buffer = buffer.slice(index + 1);
        if (line.trim().length === 0) continue;
        received.push(line);
        const message = JSON.parse(line) as { id?: unknown };
        for (const noise of noiseBefore) socket.write(`${noise}\n`);
        socket.write(`${JSON.stringify({ jsonrpc: "2.0", id: message.id, result: { tag } })}\n`);
      }
    });
  };
}

function request(id: number, method: string): string {
  return `${JSON.stringify({ jsonrpc: "2.0", id, method, params: {} })}\n`;
}

function parsedStdout(out: Collector): Array<{ id?: number; result?: { tag?: string } }> {
  return out.lines().map((line, index) => {
    try {
      return JSON.parse(line) as { id?: number; result?: { tag?: string } };
    } catch (error) {
      throw new Error(
        `INV-SHIM-1: stdout line ${index + 1} is not a valid MCP message: ${JSON.stringify(line.slice(0, 300))}`,
        { cause: error },
      );
    }
  });
}

test(
  "auto-spawn: with no daemon on the path, the shim brings one up and round-trips a message",
  { timeout: 15_000 },
  async (t) => {
    const root = makeRoot();
    const socketPath = path.join(root, SOCKET_FILE_NAME);
    const stdin = new PassThrough();
    const out = collector();
    const err = collector();
    const received: string[] = [];
    assert.equal(existsSync(socketPath), false, "precondition: nothing is serving this socket path yet");

    const shim = await startShim({
      socketPath,
      stdin,
      stdout: out.stream,
      stderr: err.stream,
      shutdownOnSignals: [],
      onConnection: taggedResponder("auto-spawned", received),
    });
    t.after(async () => {
      await shim.stop();
      rmSync(root, { recursive: true, force: true });
    });

    assert.equal(shim.role, "daemon", "with nobody serving the path, the shim must have brought the daemon up");
    assert.ok(statSync(socketPath).isSocket(), "auto-spawn must leave a real socket at the agreed path");
    assert.equal(shim.stats().connected, true, "the shim must hold a live link to the daemon it started");

    stdin.write(request(1, "initialize"));
    await waitFor(() => out.lines().length >= 1, 5_000, "the daemon's answer to reach the client's stdout");

    assert.deepEqual(received, [JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} })]);
    const responses = parsedStdout(out);
    assert.equal(responses.length, 1, `exactly one response line, got ${out.lines().length}`);
    assert.equal(responses[0]?.id, 1);
    assert.equal(responses[0]?.result?.tag, "auto-spawned");
    assert.equal(err.text(), "", `a clean session must log nothing at all, got: ${err.text()}`);
  },
);

test(
  "connect, not spawn: a second shim converges on the running daemon instead of starting its own",
  { timeout: 15_000 },
  async (t) => {
    const root = makeRoot();
    const socketPath = path.join(root, SOCKET_FILE_NAME);
    const handles: DaemonHandle[] = [];
    const shims: McpShim[] = [];
    t.after(async () => {
      for (const shim of shims) await shim.stop();
      for (const handle of handles) await handle.shutdown();
      rmSync(root, { recursive: true, force: true });
    });

    const servedByDaemon: string[] = [];
    handles.push(
      await startDaemon({
        socketPath,
        shutdownOnSignals: [],
        onConnection: taggedResponder("pre-existing-daemon", servedByDaemon),
      }),
    );
    assert.equal(handles[0]?.role, "daemon", "precondition: the test's own daemon must own the socket");

    const stdin = new PassThrough();
    const out = collector();
    const servedByShim: string[] = [];
    const shim = await startShim({
      socketPath,
      stdin,
      stdout: out.stream,
      stderr: collector().stream,
      shutdownOnSignals: [],
      // If the shim ever bound the socket itself, this handler would serve the traffic and the tag
      // would come back wrong — which is exactly the second-daemon failure INV-SHIM-2 forbids.
      onConnection: taggedResponder("shim-hosted", servedByShim),
    });
    shims.push(shim);

    assert.equal(shim.role, "delegated", "a shim starting against a live daemon must delegate, never bind");

    stdin.write(request(7, "tools/list"));
    await waitFor(() => out.lines().length >= 1, 5_000, "the pre-existing daemon's answer to reach stdout");

    assert.equal(servedByShim.length, 0, "the shim must not have served its own traffic");
    assert.equal(servedByDaemon.length, 1, "the running daemon must be the one that saw the request");
    const responses = parsedStdout(out);
    assert.equal(responses[0]?.result?.tag, "pre-existing-daemon", "the answer must come from the daemon already up");
    assert.equal(responses[0]?.id, 7);
  },
);

test(
  "INV-SHIM-1: daemon-channel noise is diverted to stderr, never mixed into the client's stdout",
  { timeout: 15_000 },
  async (t) => {
    const root = makeRoot();
    const socketPath = path.join(root, SOCKET_FILE_NAME);
    const stdin = new PassThrough();
    const out = collector();
    const err = collector();
    const received: string[] = [];
    const noise = [
      "Error: java.lang.IllegalStateException: workspace index not ready",
      "    at org.eclipse.jdt.ls.core.internal.Handler.handle(Handler.java:42)",
      "[jdt-mcp daemon] WARN resync in progress",
      "42",
      "null",
      '{"jsonrpc":"2.0","id":9,"result":{"broken":',
    ];

    const shim = await startShim({
      socketPath,
      stdin,
      stdout: out.stream,
      stderr: err.stream,
      shutdownOnSignals: [],
      onConnection: taggedResponder("noisy", received, noise),
    });
    t.after(async () => {
      await shim.stop();
      rmSync(root, { recursive: true, force: true });
    });

    for (let id = 1; id <= 3; id += 1) stdin.write(request(id, "tools/call"));
    await waitFor(() => out.lines().length >= 3, 5_000, "all three answers to reach stdout");
    // Give any leak a full chance to arrive before asserting the absence of one.
    await new Promise((resolve) => setTimeout(resolve, 100));

    const responses = parsedStdout(out);
    assert.equal(responses.length, 3, `stdout must carry exactly the 3 responses, got ${out.lines().length} lines`);
    assert.deepEqual(
      responses.map((response) => response.id),
      [1, 2, 3],
      "and they must arrive in order, unmangled",
    );
    assert.equal(out.text().endsWith("\n"), true, "every stdout message is newline-terminated");
    assert.equal(
      shim.stats().divertedLines,
      noise.length * 3,
      "every non-MCP line the daemon emitted must have been diverted, not silently dropped",
    );
    for (const line of noise) {
      // The shim quotes what it diverts (a raw stack trace on stderr would be its own framing mess),
      // so the debuggable form on stderr is the JSON-quoted one.
      assert.ok(
        err.text().includes(JSON.stringify(line)),
        `the diverted line must still be visible on stderr for debugging: ${JSON.stringify(line)}`,
      );
      assert.ok(!out.text().includes(line), `INV-SHIM-1 violated: stdout carries ${JSON.stringify(line)}`);
    }
  },
);

test(
  "framing: a message split across many writes is reassembled at the newline, both directions",
  { timeout: 15_000 },
  async (t) => {
    const root = makeRoot();
    const socketPath = path.join(root, SOCKET_FILE_NAME);
    const stdin = new PassThrough();
    const out = collector();
    const received: string[] = [];
    let serverSocket: Socket | undefined;

    const shim = await startShim({
      socketPath,
      stdin,
      stdout: out.stream,
      stderr: collector().stream,
      shutdownOnSignals: [],
      onConnection: (socket: Socket) => {
        serverSocket = socket;
        // The daemon side reassembles with a `StringDecoder` too, and that is not decoration: the shim
        // hands a whole 200 KB line to the socket in one write, the kernel hands it back in reads of
        // its own choosing, and a boundary inside a multi-byte character would corrupt what this test
        // *measures* rather than what it tests. The oracle's own framer must not be the broken one.
        const decoder = new StringDecoder("utf8");
        let buffer = "";
        socket.on("data", (chunk: Buffer) => {
          buffer += decoder.write(chunk);
          for (;;) {
            const index = buffer.indexOf("\n");
            if (index < 0) return;
            received.push(buffer.slice(0, index));
            buffer = buffer.slice(index + 1);
          }
        });
      },
    });
    t.after(async () => {
      await shim.stop();
      rmSync(root, { recursive: true, force: true });
    });

    // Client → daemon, part one: one long message across seven writes, to pin reassembly at volume.
    // These boundaries are character boundaries (`String.slice` then encode), so they say nothing
    // about multi-byte decoding — part two below is the case that does.
    const big = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "java/hover", params: { name: "café-ú-∑", pad: "x".repeat(200_000) } });
    assert.ok(!big.includes("\n"), "precondition: an MCP message must not contain an embedded newline");
    const chunkSize = Math.ceil(big.length / 7);
    for (let offset = 0; offset < big.length; offset += chunkSize) {
      stdin.write(Buffer.from(big.slice(offset, offset + chunkSize), "utf8"));
    }
    // Two more messages inside a single write, to pin the other half of the framing.
    stdin.write(`\n${request(2, "a")}${request(3, "b")}`);

    await waitFor(() => received.length >= 3, 5_000, "the daemon to see three whole messages");
    await sleep(50);
    assert.equal(received.length, 3, `three messages must arrive as three lines, got ${received.length}`);
    assertSameText(received[0], big, "the seven-chunk message must be reassembled byte-exact");
    assert.equal((JSON.parse(received[1] ?? "{}") as { id?: number }).id, 2);
    assert.equal((JSON.parse(received[2] ?? "{}") as { id?: number }).id, 3);

    // Client → daemon, part two: a chunk boundary *inside* one character (the 4-byte "𝄞", cut after
    // its first byte, leaving three continuation bytes stranded in the decoder). Decoding each chunk
    // on its own turns that character into replacement characters and the message still parses as
    // JSON — corruption with no error anywhere, which is the failure mode `StringDecoder` prevents.
    //
    // The split is not merely written in two calls, it is *proven* to arrive in two reads: an
    // anchor message rides in the same chunk as the head bytes, so the daemon seeing the anchor means
    // the shim's framer has already consumed the head; and the tail follows only after that plus a
    // settling delay, so it cannot be coalesced into the same chunk.
    const anchorRequest = JSON.stringify({ jsonrpc: "2.0", id: 41, method: "anchor", params: {} });
    const splitRequest = JSON.stringify({ jsonrpc: "2.0", id: 42, method: "java/hover", params: { name: "café-ú-∑-𝄞-ü" } });
    const splitRequestBytes = Buffer.from(`${splitRequest}\n`, "utf8");
    const requestCut = midCharacterCut(splitRequestBytes, "𝄞");

    stdin.write(Buffer.concat([Buffer.from(`${anchorRequest}\n`, "utf8"), splitRequestBytes.subarray(0, requestCut)]));
    await waitFor(() => received.length >= 4, 5_000, "the anchor message that rides with the head bytes");
    assert.equal(received[3], anchorRequest, "precondition: the head bytes are now inside the shim's framer");
    await sleep(100);
    stdin.write(splitRequestBytes.subarray(requestCut));
    await waitFor(() => received.length >= 5, 5_000, "the message whose character was split across two chunks");
    assertSameText(received[4], splitRequest, "a character split across two chunks must be reassembled byte-exact");

    // Daemon → client: the same two parts, in reverse.
    assert.ok(serverSocket !== undefined, "precondition: the daemon side must hold the connection");
    const reply = JSON.stringify({ jsonrpc: "2.0", id: 1, result: { text: "ü".repeat(100_000) } });
    const replyBuffer = Buffer.from(`${reply}\n`, "utf8");
    for (let offset = 0; offset < replyBuffer.length; offset += 30_000) {
      serverSocket.write(replyBuffer.subarray(offset, offset + 30_000));
    }
    await waitFor(() => out.text().includes("\n"), 5_000, "the reassembled reply to reach stdout");
    await sleep(50);
    assert.equal(out.lines().length, 1, `a chunked reply must surface as exactly one stdout line, got ${out.lines().length}`);
    assertSameText(out.lines()[0], reply, "the reply must be reassembled byte-exact");
    assert.ok(isMcpMessage(out.lines()[0] ?? ""), "and it must still parse as one MCP message");

    const anchorReply = JSON.stringify({ jsonrpc: "2.0", id: 41, result: { tag: "anchor" } });
    const splitReply = JSON.stringify({ jsonrpc: "2.0", id: 42, result: { text: "héllo-∑-𝄞-ü" } });
    const splitReplyBytes = Buffer.from(`${splitReply}\n`, "utf8");
    const replyCut = midCharacterCut(splitReplyBytes, "𝄞");

    serverSocket.write(Buffer.concat([Buffer.from(`${anchorReply}\n`, "utf8"), splitReplyBytes.subarray(0, replyCut)]));
    await waitFor(() => out.lines().length >= 2, 5_000, "the anchor reply that rides with the head bytes");
    assert.equal(out.lines()[1], anchorReply, "precondition: the head bytes are now inside the shim's framer");
    await sleep(100);
    serverSocket.write(splitReplyBytes.subarray(replyCut));
    await waitFor(() => out.lines().length >= 3, 5_000, "the reply whose character was split across two chunks");
    await sleep(50);
    assert.equal(out.lines().length, 3, `no extra lines may appear, got ${out.lines().length}`);
    assertSameText(out.lines()[2], splitReply, "a character split across two chunks must reach stdout byte-exact");
    assert.equal(shim.stats().divertedLines, 0, "and nothing may have been diverted along the way");
  },
);

/** Absolute paths so the child processes load exactly the modules under test. */
const SHIM_MODULE = path.resolve(import.meta.dirname, "../../src/shim/mcp-shim.ts");
const SUPERVISOR_MODULE = path.resolve(import.meta.dirname, "../../src/daemon/daemon-supervisor.ts");

/**
 * A real daemon process, so the INV-SHIM-3 case can SIGKILL it the way a crash would. Each generation
 * tags its answers with its own pid, so a reply proves *which* daemon produced it.
 *
 * The optional third argument is a `trailingFragment`: bytes appended to the *same* socket write as
 * the first answer and deliberately left unterminated, so that a SIGKILL after that point reproduces
 * "the daemon died with half a message on the wire". Sharing one write with the answer is what makes
 * the ordering deterministic instead of a sleep: once the answer is on the client's stdout, the
 * shim's framer provably already holds the fragment.
 */
function daemonProcessScript(): string {
  return `import { startDaemon } from ${JSON.stringify(SUPERVISOR_MODULE)};

const [socketPath, tag, trailingFragment] = process.argv.slice(2);
let fragmentSent = false;
const handle = await startDaemon({
  socketPath,
  shutdownOnSignals: [],
  onConnection: (socket) => {
    let buffer = "";
    socket.on("data", (chunk) => {
      buffer += chunk.toString("utf8");
      for (;;) {
        const index = buffer.indexOf("\\n");
        if (index < 0) return;
        const line = buffer.slice(0, index);
        buffer = buffer.slice(index + 1);
        if (line.trim().length === 0) continue;
        const message = JSON.parse(line);
        let payload = JSON.stringify({ jsonrpc: "2.0", id: message.id, result: { tag, pid: process.pid } }) + "\\n";
        if (trailingFragment !== undefined && !fragmentSent) {
          fragmentSent = true;
          payload += trailingFragment;
        }
        socket.write(payload);
      }
    });
  },
});
if (handle.role !== "daemon") {
  console.error("role=" + handle.role);
  process.exit(3);
}
console.log("listening");
`;
}

/**
 * The shim under real stdio. `mode` picks the hazard: a daemon that interleaves stack traces with its
 * answers, or an auto-spawn that fails outright. In both cases the thing under test is the same — the
 * bytes on this process's own stdout.
 */
function shimProcessScript(): string {
  return `import { startShim } from ${JSON.stringify(SHIM_MODULE)};

const [socketPath, mode] = process.argv.slice(2);

if (mode === "launch-fails") {
  try {
    await startShim({
      socketPath,
      shutdownOnSignals: [],
      launch: async () => {
        throw new Error("auto-spawn refused: no JVM >= 21 resolvable");
      },
    });
    process.stderr.write("shim started when it should not have\\n");
    process.exit(4);
  } catch (error) {
    process.stderr.write("shim could not start: " + error.message + "\\n");
    process.exit(1);
  }
}

const shim = await startShim({
  socketPath,
  shutdownOnSignals: [],
  onConnection: (socket) => {
    socket.write("[jdt-mcp daemon] INFO accepted a client connection\\n");
    let buffer = "";
    socket.on("data", (chunk) => {
      buffer += chunk.toString("utf8");
      for (;;) {
        const index = buffer.indexOf("\\n");
        if (index < 0) return;
        const line = buffer.slice(0, index);
        buffer = buffer.slice(index + 1);
        if (line.trim().length === 0) continue;
        const message = JSON.parse(line);
        socket.write("Error: java.lang.IllegalStateException: index not ready\\n");
        socket.write("    at org.eclipse.jdt.ls.core.internal.Handler.handle(Handler.java:42)\\n");
        socket.write(JSON.stringify({ jsonrpc: "2.0", id: message.id, result: { ok: true } }) + "\\n");
      }
    });
  },
});
await shim.done;
`;
}

interface ChildStreams {
  child: ChildProcess;
  stdout(): string;
  stderr(): string;
  kill(): void;
}

/** Spawns one daemon generation and waits until it actually owns the socket. */
async function spawnDaemonProcess(
  scriptPath: string,
  args: readonly string[],
  sink: ChildStreams[],
): Promise<ChildStreams> {
  const daemon = spawnScript(scriptPath, args);
  sink.push(daemon);
  await waitFor(
    () => daemon.stdout().includes("listening"),
    10_000,
    `daemon ${String(args[1])} to bind the socket (stderr: ${JSON.stringify(daemon.stderr().slice(-300))})`,
  );
  return daemon;
}

/**
 * Records the text written to *this process's own* stdout while `body` runs, and restores the method
 * afterwards no matter how `body` ends.
 *
 * A `Writable` injected through `McpShimOptions.stdout` cannot see `console.log`, nor a direct
 * `process.stdout.write` — both go to the process stream, which is precisely where a stray log line
 * would land and precisely what the MCP client is parsing. Overriding the method for the duration of
 * the case sees both, so `recorded() === ""` is the in-process form of "nothing left the official
 * data path".
 *
 * Only string chunks are recorded, and that is not a convenience. `node --test` runs each spec file
 * in a child process and reports its own results back over *this same* `process.stdout`, serialised
 * with the V8 serialiser (`NODE_TEST_CONTEXT=child-v8`). Those writes always carry a `Buffer`;
 * `console.log` and every `${...}` log line in `mcp-shim.ts` always carry a string. Recording blindly
 * therefore records the runner's own bookkeeping and the case fails on binary noise that has nothing
 * to do with the shim — measured, not assumed: the first run of this file failed with the runner's
 * `test:start` frame as the "leak". The context is asserted rather than trusted, so a future runner
 * that reports as text fails loudly here instead of quietly turning this case green forever.
 */
async function withStdoutRecorder<T>(body: (recorded: () => string) => Promise<T>): Promise<T> {
  assert.equal(
    process.env["NODE_TEST_CONTEXT"],
    "child-v8",
    "this recorder ignores Buffer writes because that is the runner's binary reporting channel; " +
      "under any other reporting mode that assumption no longer holds",
  );
  const original = process.stdout.write;
  let recorded = "";
  process.stdout.write = function patched(this: unknown, chunk: unknown, ...rest: unknown[]): boolean {
    if (typeof chunk === "string") recorded += chunk;
    return (original as (...args: unknown[]) => boolean).call(process.stdout, chunk, ...rest);
  } as typeof process.stdout.write;
  try {
    // Positive anchor: a negative assertion on a recorder that silently stopped working is vacuous,
    // so prove it is armed against the exact call shape under test before asserting the absence.
    const probe = "stdout-recorder-armed";
    console.log(probe);
    assert.ok(recorded.includes(probe), "the stdout recorder must capture console.log before it can prove an absence");
    recorded = "";
    return await body(() => recorded);
  } finally {
    process.stdout.write = original;
  }
}

function spawnScript(scriptPath: string, args: readonly string[]): ChildStreams {
  const child = spawn(process.execPath, ["--experimental-strip-types", scriptPath, ...args], {
    stdio: ["pipe", "pipe", "pipe"],
    detached: true,
  });
  let stdout = "";
  let stderr = "";
  child.stdout?.on("data", (chunk: Buffer) => (stdout += chunk.toString("utf8")));
  child.stderr?.on("data", (chunk: Buffer) => (stderr += chunk.toString("utf8")));
  const kill = (): void => {
    if (child.exitCode !== null || child.signalCode !== null || child.pid === undefined) return;
    try {
      process.kill(-child.pid, "SIGKILL");
    } catch {
      child.kill("SIGKILL");
    }
  };
  return { child, stdout: () => stdout, stderr: () => stderr, kill };
}

test(
  "INV-SHIM-1 at the process boundary: the shim's real stdout carries only MCP messages, noise and all",
  { timeout: 25_000 },
  async (t) => {
    const root = makeRoot();
    const socketPath = path.join(root, SOCKET_FILE_NAME);
    const scriptPath = path.join(root, "shim-child.mjs");
    writeFileSync(scriptPath, shimProcessScript());

    const shim = spawnScript(scriptPath, [socketPath, "noisy"]);
    t.after(() => {
      shim.kill();
      rmSync(root, { recursive: true, force: true });
    });

    for (let id = 1; id <= 3; id += 1) shim.child.stdin?.write(request(id, "tools/call"));
    await waitFor(
      () => shim.stdout().split("\n").filter((line) => line.length > 0).length >= 3,
      10_000,
      `three answers on the shim's real stdout (stdout so far: ${JSON.stringify(shim.stdout().slice(0, 400))})`,
    );
    await new Promise((resolve) => setTimeout(resolve, 200));

    const lines = shim.stdout().split("\n").filter((line) => line.length > 0);
    for (const [index, line] of lines.entries()) {
      assert.ok(
        isMcpMessage(line),
        `INV-SHIM-1 violated: real stdout line ${index + 1} is not a valid MCP message: ${JSON.stringify(line.slice(0, 300))}`,
      );
    }
    assert.equal(lines.length, 3, `stdout must carry the 3 answers and nothing else, got ${lines.length} lines`);
    assert.deepEqual(
      lines.map((line) => (JSON.parse(line) as { id: number }).id),
      [1, 2, 3],
    );
    // The daemon-side lines are not lost, they are on the other stream — which is the whole contract.
    assert.ok(
      shim.stderr().includes("java.lang.IllegalStateException"),
      `the daemon's error lines must show up on stderr, got: ${JSON.stringify(shim.stderr().slice(0, 400))}`,
    );
    assert.ok(shim.stderr().includes("INFO accepted a client connection"), "and so must its info lines");
  },
);

test(
  "INV-SHIM-1: an auto-spawn that fails writes nothing at all to stdout",
  { timeout: 25_000 },
  async (t) => {
    const root = makeRoot();
    const socketPath = path.join(root, SOCKET_FILE_NAME);
    const scriptPath = path.join(root, "shim-child.mjs");
    writeFileSync(scriptPath, shimProcessScript());

    const shim = spawnScript(scriptPath, [socketPath, "launch-fails"]);
    t.after(() => {
      shim.kill();
      rmSync(root, { recursive: true, force: true });
    });

    const exit = await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) => {
      shim.child.once("exit", (code, signal) => resolve({ code, signal }));
    });

    assert.equal(
      shim.stdout(),
      "",
      `INV-SHIM-1 violated: a failed auto-spawn wrote to stdout: ${JSON.stringify(shim.stdout().slice(0, 400))}`,
    );
    assert.equal(exit.code, 1, `the shim must fail loudly rather than serve nothing (signal=${String(exit.signal)})`);
    assert.ok(
      shim.stderr().includes("no JVM >= 21 resolvable"),
      `the failure must be reported on stderr, got: ${JSON.stringify(shim.stderr().slice(0, 400))}`,
    );
  },
);

test(
  "INV-SHIM-3: a daemon killed mid-session is replaced transparently — the client never re-initialises",
  { timeout: 30_000 },
  async (t) => {
    const root = makeRoot();
    const socketPath = path.join(root, SOCKET_FILE_NAME);
    const scriptPath = path.join(root, "daemon-child.mjs");
    writeFileSync(scriptPath, daemonProcessScript());

    const daemons: ChildStreams[] = [];
    const shims: McpShim[] = [];
    t.after(async () => {
      for (const shim of shims) await shim.stop();
      for (const daemon of daemons) daemon.kill();
      rmSync(root, { recursive: true, force: true });
    });

    async function startDaemonProcess(tag: string): Promise<ChildStreams> {
      const daemon = spawnScript(scriptPath, [socketPath, tag]);
      daemons.push(daemon);
      await waitFor(
        () => daemon.stdout().includes("listening"),
        10_000,
        `daemon ${tag} to bind the socket (stderr: ${JSON.stringify(daemon.stderr().slice(-300))})`,
      );
      return daemon;
    }

    // The launcher seam is gated, not faked: the real `startDaemon` still runs, the test only decides
    // *when* the shim is allowed to re-run it. Without that, killing the daemon would race the shim
    // into binding the free socket itself, and the case would prove nothing about a real restart.
    let gate: Promise<void> = Promise.resolve();
    let openGate: () => void = () => {};
    const closeGate = (): void => {
      gate = new Promise<void>((resolve) => {
        openGate = resolve;
      });
    };
    const launch: LaunchDaemon = async (options) => {
      await gate;
      return startDaemon(options);
    };

    const first = await startDaemonProcess("gen-A");
    const stdin = new PassThrough();
    const out = collector();
    const err = collector();
    const shim = await startShim({
      socketPath,
      stdin,
      stdout: out.stream,
      stderr: err.stream,
      shutdownOnSignals: [],
      launch,
      reconnectDelayMs: 20,
    });
    shims.push(shim);
    assert.equal(shim.role, "delegated", "precondition: the shim must have converged on the running daemon");

    // 1. A call the client makes before anything goes wrong.
    stdin.write(request(1, "initialize"));
    await waitFor(() => out.lines().length >= 1, 5_000, "the first answer, from gen-A");
    const beforeRestart = parsedStdout(out)[0];
    assert.equal(beforeRestart?.result?.tag, "gen-A", "the first answer must come from the first daemon");
    const firstPid = (beforeRestart as { result?: { pid?: number } }).result?.pid;
    assert.equal(firstPid, first.child.pid, "and its pid must be that daemon process");

    // 2. The daemon dies without warning. SIGKILL gives it no chance to say goodbye, which is the
    //    crash this invariant is written for.
    closeGate();
    const firstExited = new Promise<void>((resolve) => first.child.once("exit", () => resolve()));
    first.kill();
    await firstExited;
    await waitFor(() => !shim.stats().connected, 5_000, "the shim to notice its daemon link is gone");

    // 3. The client keeps talking, unaware. It does NOT re-send `initialize` — that is the whole
    //    point of the invariant, and the absence of a second initialize here is the assertion.
    stdin.write(request(2, "tools/call"));
    await waitFor(() => shim.stats().bufferedLines === 1, 5_000, "the shim to hold the call as a whole message");

    // 4. A genuinely different daemon process takes over the path.
    const second = await startDaemonProcess("gen-B");
    openGate();

    await waitFor(
      () => out.lines().length >= 2,
      10_000,
      `the second answer to arrive after the restart (stderr: ${JSON.stringify(err.text().slice(-500))})`,
    );

    const responses = parsedStdout(out) as Array<{ id?: number; result?: { tag?: string; pid?: number } }>;
    assert.equal(responses.length, 2, `stdout must carry exactly two answers, got ${out.lines().length} lines`);
    assert.equal(responses[1]?.id, 2, "the post-restart call must be answered, not lost");
    assert.equal(responses[1]?.result?.tag, "gen-B", "and answered by the replacement daemon");
    assert.equal(responses[1]?.result?.pid, second.child.pid, "which must be a different process than the first");
    assert.notEqual(responses[1]?.result?.pid, firstPid, "a restart the shim rode out, not the same daemon");

    // The shim itself never restarted and never closed the client's transport: same object, same
    // streams, one extra link. A client that had to re-initialise would be looking at a dead pipe.
    assert.equal(shim.stats().reconnects, 1, "the shim must have re-run connect-or-spawn exactly once");
    assert.equal(shim.stats().links, 2, "one link before the restart and one after");
    assert.equal(shim.stats().connected, true, "and the new link must be live");
    assert.equal(shim.stats().bufferedLines, 0, "the buffered call must have been flushed, not stranded");
    assert.equal(out.stream.writableEnded, false, "the client's stdout must never have been closed");
    assert.equal(stdin.writableEnded, false, "nor its stdin");
    for (const line of out.lines()) {
      assert.ok(isMcpMessage(line), `INV-SHIM-1 still holds across a restart: ${JSON.stringify(line.slice(0, 200))}`);
    }
  },
);

test(
  "INV-SHIM-3: a daemon killed with half a message on the wire cannot corrupt the replacement's first frame",
  { timeout: 30_000 },
  async (t) => {
    const root = makeRoot();
    const socketPath = path.join(root, SOCKET_FILE_NAME);
    const scriptPath = path.join(root, "daemon-child.mjs");
    writeFileSync(scriptPath, daemonProcessScript());

    const daemons: ChildStreams[] = [];
    const shims: McpShim[] = [];
    t.after(async () => {
      for (const shim of shims) await shim.stop();
      for (const daemon of daemons) daemon.kill();
      rmSync(root, { recursive: true, force: true });
    });

    // Same gated seam as the case above: the real `startDaemon` runs, the test only decides *when*,
    // so the restart is a real one instead of the shim racing itself into the free socket path.
    let gate: Promise<void> = Promise.resolve();
    let openGate: () => void = () => {};
    const closeGate = (): void => {
      gate = new Promise<void>((resolve) => {
        openGate = resolve;
      });
    };
    const launch: LaunchDaemon = async (options) => {
      await gate;
      return startDaemon(options);
    };

    // A truncated JSON object: it can never be mistaken for a message of its own, and if it is ever
    // glued to the next daemon's first line that line stops parsing — which is the corruption the
    // file header (point 2) claims is impossible.
    const TRUNCATED_TAIL = '{"jsonrpc":"2.0","id":99,"result":{"tag":"gen-A","half';

    const first = await spawnDaemonProcess(scriptPath, [socketPath, "gen-A", TRUNCATED_TAIL], daemons);
    const stdin = new PassThrough();
    const out = collector();
    const err = collector();
    const shim = await startShim({
      socketPath,
      stdin,
      stdout: out.stream,
      stderr: err.stream,
      shutdownOnSignals: [],
      launch,
      reconnectDelayMs: 20,
    });
    shims.push(shim);
    assert.equal(shim.role, "delegated", "precondition: the shim must have converged on the running daemon");

    // 1. One ordinary call. gen-A answers it and, in the same write, starts a message it will never
    //    finish. Seeing the answer on stdout is the proof that the unfinished half is in the framer.
    stdin.write(request(1, "initialize"));
    await waitFor(() => out.lines().length >= 1, 5_000, "gen-A's answer to call 1");
    assert.equal(parsedStdout(out)[0]?.result?.tag, "gen-A", "the first answer must come from gen-A");
    assert.equal(shim.stats().divertedLines, 0, "precondition: nothing has been diverted yet");
    // Belt and braces in case the kernel ever split that one write into two reads.
    await new Promise((resolve) => setTimeout(resolve, 150));

    // 2. gen-A dies mid-message. Not between two whole messages — *inside* one.
    closeGate();
    const firstExited = new Promise<void>((resolve) => first.child.once("exit", () => resolve()));
    first.kill();
    await firstExited;
    await waitFor(() => !shim.stats().connected, 5_000, "the shim to notice its daemon link is gone");

    // 3. The client keeps talking, unaware, and a genuinely different daemon takes the path over.
    stdin.write(request(2, "tools/call"));
    await waitFor(() => shim.stats().bufferedLines === 1, 5_000, "the shim to hold the call as a whole message");
    const second = await spawnDaemonProcess(scriptPath, [socketPath, "gen-B"], daemons);
    openGate();

    await waitFor(
      () => out.lines().length >= 2,
      10_000,
      `the answer to call 2 to survive the mid-message death of gen-A (stdout so far: ${JSON.stringify(out.text().slice(-300))}, stderr: ${JSON.stringify(err.text().slice(-500))})`,
    );
    await new Promise((resolve) => setTimeout(resolve, 100));

    const responses = parsedStdout(out) as Array<{ id?: number; result?: { tag?: string; pid?: number } }>;
    assert.equal(responses.length, 2, `stdout must carry exactly two answers, got ${out.lines().length} lines`);
    assert.equal(responses[1]?.id, 2, "the post-restart call must be answered, not swallowed by a stale half-frame");
    assert.equal(responses[1]?.result?.tag, "gen-B", "and answered, intact, by the replacement daemon");
    assert.equal(responses[1]?.result?.pid, second.child.pid, "which must be a different process than gen-A");
    assert.ok(
      !out.text().includes('"half'),
      `the unfinished half of gen-A's message must never reach the client: ${JSON.stringify(out.text().slice(0, 400))}`,
    );

    // The half-message is not silently dropped either: it is accounted for exactly once, on stderr,
    // when the dead link closed — and nowhere near the bytes of the daemon that replaced it.
    assert.equal(
      shim.stats().divertedLines,
      1,
      `exactly the one truncated tail must have been diverted (stderr: ${JSON.stringify(err.text().slice(-500))})`,
    );
    assert.ok(
      err.text().includes(JSON.stringify(TRUNCATED_TAIL)),
      `the truncated tail must be visible on stderr for debugging, got: ${JSON.stringify(err.text().slice(-500))}`,
    );
    assert.equal(shim.stats().reconnects, 1, "the shim must have re-run connect-or-spawn exactly once");
    assert.equal(shim.stats().bufferedLines, 0, "the buffered call must have been flushed, not stranded");
    assert.equal(out.stream.writableEnded, false, "the client's stdout must never have been closed");
  },
);

test(
  "INV-SHIM-1 on the reconnect path: a dropped link, a refused relaunch and a failed shutdown all log to stderr only",
  { timeout: 20_000 },
  async (t) => {
    const root = makeRoot();
    const socketPath = path.join(root, SOCKET_FILE_NAME);
    const handles: DaemonHandle[] = [];
    const shims: McpShim[] = [];
    t.after(async () => {
      for (const shim of shims) await shim.stop();
      for (const handle of handles) await handle.shutdown();
      rmSync(root, { recursive: true, force: true });
    });

    const served: string[] = [];
    const respond = taggedResponder("svc", served);
    const serverSockets: Socket[] = [];
    handles.push(
      await startDaemon({
        socketPath,
        shutdownOnSignals: [],
        onConnection: (socket: Socket) => {
          serverSockets.push(socket);
          respond(socket);
        },
      }),
    );

    // The seam still runs the real `startDaemon`; what the test supplies is only the *failure* the
    // shim has to survive — two refused launches, and a handle whose `shutdown()` rejects. Those are
    // the branches this file logs from most, and none of them is on the client's data path.
    let launches = 0;
    const launch: LaunchDaemon = async (options) => {
      launches += 1;
      if (launches === 2 || launches === 3) throw new Error("simulated: this launch is refused");
      const real = await startDaemon(options);
      handles.push(real);
      return {
        role: real.role,
        socketPath: real.socketPath,
        daemonPid: real.daemonPid,
        connection: real.connection,
        adopt: (pool) => real.adopt(pool),
        shutdown: async () => {
          throw new Error("simulated: shutdown refused");
        },
      };
    };

    const stdin = new PassThrough();
    const out = collector();
    const err = collector();

    await withStdoutRecorder(async (recorded) => {
      const shim = await startShim({
        socketPath,
        stdin,
        stdout: out.stream,
        stderr: err.stream,
        shutdownOnSignals: [],
        launch,
        reconnectDelayMs: 10,
      });
      shims.push(shim);
      assert.equal(shim.role, "delegated", "precondition: the shim must have converged on the running daemon");

      stdin.write(request(1, "initialize"));
      await waitFor(() => out.lines().length >= 1, 5_000, "the first answer to reach stdout");

      // Drop the link from the daemon side. The shim now walks the whole reconnect path: the "link
      // closed" line, a failed release of the dead handle, two refused relaunches, then a success.
      serverSockets[0]?.destroy();
      await waitFor(() => !shim.stats().connected, 5_000, "the shim to notice the link dropped");
      await waitFor(
        () => shim.stats().reconnects === 1,
        10_000,
        `the shim to reconnect after the refused launches (stderr: ${JSON.stringify(err.text().slice(-500))})`,
      );

      stdin.write(request(2, "tools/call"));
      await waitFor(() => out.lines().length >= 2, 5_000, "the post-reconnect answer to reach stdout");

      // ... and then the stop path, whose daemon shutdown also fails.
      await shim.stop();

      // The branches really were traversed — otherwise the stdout assertion below would be vacuous.
      assert.ok(
        err.text().includes("daemon link closed; reconnecting transparently"),
        `the drop must have been logged: ${JSON.stringify(err.text().slice(-800))}`,
      );
      assert.ok(
        err.text().includes("releasing the previous daemon link failed"),
        `the failed release must have been logged: ${JSON.stringify(err.text().slice(-800))}`,
      );
      assert.ok(
        err.text().includes("reconnect attempt 1/") && err.text().includes("reconnect attempt 2/"),
        `both refused relaunches must have been logged: ${JSON.stringify(err.text().slice(-800))}`,
      );
      assert.ok(
        err.text().includes("daemon shutdown during stop failed"),
        `the failed shutdown must have been logged: ${JSON.stringify(err.text().slice(-800))}`,
      );

      assert.equal(
        recorded(),
        "",
        `INV-SHIM-1 violated: the reconnect/stop path wrote to the process's own stdout: ${JSON.stringify(recorded().slice(0, 600))}`,
      );
      for (const line of out.lines()) {
        assert.ok(isMcpMessage(line), `and the injected stdout still carries only MCP messages: ${JSON.stringify(line.slice(0, 200))}`);
      }
    });
  },
);

test(
  "INV-SHIM-1 when reconnecting fails for good: giving up is reported on stderr and stdout stays untouched",
  { timeout: 20_000 },
  async (t) => {
    const root = makeRoot();
    const socketPath = path.join(root, SOCKET_FILE_NAME);
    const handles: DaemonHandle[] = [];
    const shims: McpShim[] = [];
    t.after(async () => {
      for (const shim of shims) await shim.stop();
      for (const handle of handles) await handle.shutdown();
      rmSync(root, { recursive: true, force: true });
    });

    const served: string[] = [];
    const respond = taggedResponder("svc", served);
    const serverSockets: Socket[] = [];
    handles.push(
      await startDaemon({
        socketPath,
        shutdownOnSignals: [],
        onConnection: (socket: Socket) => {
          serverSockets.push(socket);
          respond(socket);
        },
      }),
    );

    let launches = 0;
    const launch: LaunchDaemon = async (options) => {
      launches += 1;
      if (launches > 1) throw new Error("simulated: the socket path is permanently dead");
      const real = await startDaemon(options);
      handles.push(real);
      return real;
    };

    const stdin = new PassThrough();
    const out = collector();
    const err = collector();

    await withStdoutRecorder(async (recorded) => {
      const shim = await startShim({
        socketPath,
        stdin,
        stdout: out.stream,
        stderr: err.stream,
        shutdownOnSignals: [],
        launch,
        reconnectDelayMs: 5,
        maxReconnectAttempts: 2,
      });
      shims.push(shim);

      stdin.write(request(1, "initialize"));
      await waitFor(() => out.lines().length >= 1, 5_000, "the first answer to reach stdout");

      serverSockets[0]?.destroy();
      await shim.done;

      assert.equal(shim.stats().reconnects, 0, "no reconnect can have succeeded");
      assert.ok(
        err.text().includes("giving up after 2 reconnect attempts"),
        `giving up must be reported on stderr: ${JSON.stringify(err.text().slice(-800))}`,
      );
      assert.equal(
        recorded(),
        "",
        `INV-SHIM-1 violated: giving up wrote to the process's own stdout: ${JSON.stringify(recorded().slice(0, 600))}`,
      );
      assert.equal(out.lines().length, 1, `stdout carries the one answer and nothing else, got ${out.lines().length}`);
      assert.ok(isMcpMessage(out.lines()[0] ?? ""), "and that line is still a valid MCP message");
    });
  },
);

test(
  "INV-SHIM-3: with nobody replacing the dead daemon the shim takes the role itself and keeps serving",
  { timeout: 30_000 },
  async (t) => {
    const root = makeRoot();
    const socketPath = path.join(root, SOCKET_FILE_NAME);
    const scriptPath = path.join(root, "daemon-child.mjs");
    writeFileSync(scriptPath, daemonProcessScript());

    const daemons: ChildStreams[] = [];
    const shims: McpShim[] = [];
    t.after(async () => {
      for (const shim of shims) await shim.stop();
      for (const daemon of daemons) daemon.kill();
      rmSync(root, { recursive: true, force: true });
    });

    // No gate this time: this is the other branch of the race, and the likelier one in operation —
    // the daemon dies and nothing takes its place, so connect-or-spawn has to end in *spawn*, in
    // this process, mid-session. `role` therefore has to move from delegated to daemon.
    const first = await spawnDaemonProcess(scriptPath, [socketPath, "gen-A"], daemons);
    const stdin = new PassThrough();
    const out = collector();
    const err = collector();
    const servedByShim: string[] = [];
    const shim = await startShim({
      socketPath,
      stdin,
      stdout: out.stream,
      stderr: err.stream,
      shutdownOnSignals: [],
      reconnectDelayMs: 20,
      onConnection: taggedResponder("shim-hosted", servedByShim),
    });
    shims.push(shim);
    assert.equal(shim.role, "delegated", "precondition: the shim must have converged on the running daemon");

    stdin.write(request(1, "initialize"));
    await waitFor(() => out.lines().length >= 1, 5_000, "gen-A's answer to call 1");
    assert.equal(parsedStdout(out)[0]?.result?.tag, "gen-A", "the first answer must come from the daemon process");
    assert.equal(servedByShim.length, 0, "and the shim must not have served it");

    const firstExited = new Promise<void>((resolve) => first.child.once("exit", () => resolve()));
    first.kill();
    await firstExited;
    await waitFor(() => !shim.stats().connected, 5_000, "the shim to notice its daemon link is gone");

    stdin.write(request(2, "tools/call"));
    await waitFor(
      () => out.lines().length >= 2,
      15_000,
      `the shim to answer call 2 after adopting the daemon role (stderr: ${JSON.stringify(err.text().slice(-500))})`,
    );
    await new Promise((resolve) => setTimeout(resolve, 100));

    assert.equal(shim.role, "daemon", "the shim must have taken the vacant daemon role mid-session");
    assert.ok(statSync(socketPath).isSocket(), "and it must be serving a real socket at the agreed path");
    const responses = parsedStdout(out);
    assert.equal(responses.length, 2, `stdout must carry exactly two answers, got ${out.lines().length} lines`);
    assert.equal(responses[1]?.id, 2, "the post-restart call must be answered, not lost");
    assert.equal(responses[1]?.result?.tag, "shim-hosted", "and answered by the shim now hosting the daemon");
    assert.deepEqual(
      servedByShim.map((line) => (JSON.parse(line) as { id?: number }).id),
      [2],
      "the shim-hosted daemon must have seen exactly the call made after the restart",
    );
    assert.equal(shim.stats().reconnects, 1, "the shim must have re-run connect-or-spawn exactly once");
    assert.equal(shim.stats().links, 2, "one link before the restart and one after");
    assert.equal(shim.stats().connected, true, "and the new link must be live");
    assert.equal(shim.stats().bufferedLines, 0, "the buffered call must have been flushed, not stranded");
    assert.equal(stdin.writableEnded, false, "the client's transport must never have been closed");
    for (const line of out.lines()) {
      assert.ok(isMcpMessage(line), `INV-SHIM-1 still holds across the role change: ${JSON.stringify(line.slice(0, 200))}`);
    }
  },
);

test(
  "INV-SHIM-1: a real error on the daemon link is logged to stderr, never surfaces to the client, and never kills the shim",
  { timeout: 20_000 },
  async (t) => {
    const root = makeRoot();
    const socketPath = path.join(root, SOCKET_FILE_NAME);
    const handles: DaemonHandle[] = [];
    const shims: McpShim[] = [];
    t.after(async () => {
      for (const shim of shims) await shim.stop();
      for (const handle of handles) await handle.shutdown();
      rmSync(root, { recursive: true, force: true });
    });

    const served: string[] = [];
    const respond = taggedResponder("svc", served);
    const serverSockets: Socket[] = [];
    handles.push(
      await startDaemon({
        socketPath,
        shutdownOnSignals: [],
        onConnection: (socket: Socket) => {
          serverSockets.push(socket);
          // The *test's* daemon end, not the subject: it is about to be destroyed underneath a peer
          // that is still writing, and its own error handling is out of scope here.
          socket.on("error", () => {});
          respond(socket);
        },
      }),
    );

    const stdin = new PassThrough();
    const out = collector();
    const err = collector();

    await withStdoutRecorder(async (recorded) => {
      const shim = await startShim({
        socketPath,
        stdin,
        stdout: out.stream,
        stderr: err.stream,
        shutdownOnSignals: [],
        reconnectDelayMs: 10,
      });
      shims.push(shim);

      stdin.write(request(1, "initialize"));
      await waitFor(() => out.lines().length >= 1, 5_000, "the answer that proves the link works before it breaks");

      // A genuine `error` event on the daemon link — not a mocked one, and not the ordinary `close`
      // every other case here produces. The daemon end is destroyed and, in the same synchronous
      // block, a megabyte-sized call is written to a link the shim still believes is writable: the
      // write is still outstanding when the peer disappears, so the kernel answers it with EPIPE.
      // That window is real in operation — an MCP client does not wait for the shim to notice a
      // dead daemon before making its next call.
      const inFlight = `${JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { pad: "p".repeat(1_000_000) } })}\n`;
      serverSockets[0]?.destroy();
      stdin.write(inFlight);

      await waitFor(
        () => /daemon link error: \S/.test(err.text()),
        10_000,
        () => `a real error event on the daemon link (stderr so far: ${JSON.stringify(err.text().slice(-400))})`,
      );

      // 1. The shim is still alive and still serving: an error listener that is missing altogether
      //    would have thrown out of the socket and taken the whole process — and the MCP client —
      //    down with it, which is the failure this branch exists to prevent.
      await waitFor(
        () => shim.stats().connected,
        10_000,
        () => `the shim to survive the error and reconnect (stderr: ${JSON.stringify(err.text().slice(-400))})`,
      );
      stdin.write(request(3, "tools/list"));
      await waitFor(
        () => out.lines().length >= 2,
        10_000,
        () => `the shim to answer a call made after the error (stderr: ${JSON.stringify(err.text().slice(-400))})`,
      );
      await sleep(150);

      // 2. INV-SHIM-1: the error went to stderr and to nowhere else. Neither the process's own stdout
      //    nor the client's transport may carry a syllable of it.
      assert.match(
        err.text(),
        /jdt-mcp shim: daemon link error: \S/,
        `the link error must be reported on stderr: ${JSON.stringify(err.text().slice(-600))}`,
      );
      assert.equal(
        recorded(),
        "",
        `INV-SHIM-1 violated: the daemon link error path wrote to the process's own stdout: ${JSON.stringify(recorded().slice(0, 600))}`,
      );
      const responses = parsedStdout(out);
      assert.deepEqual(
        responses.map((response) => response.id),
        [1, 3],
        "stdout carries the two answers and nothing else — no error text, no half message",
      );
      assert.ok(!out.text().includes("EPIPE"), `INV-SHIM-1 violated: stdout mentions the socket error: ${JSON.stringify(out.text().slice(0, 400))}`);
      assert.equal(shim.stats().divertedLines, 0, "nothing came off the wire that had to be diverted");
      assert.equal(out.stream.writableEnded, false, "the client's stdout must never have been closed");
      assert.equal(stdin.writableEnded, false, "nor its stdin");
      // 3. INV-SHIM-3's one admitted cost: the call in flight at the moment of the error is lost, and
      //    only that one. The daemon never sees it, and the shim never re-sends it behind the
      //    client's back either.
      assert.deepEqual(
        served.map((line) => (JSON.parse(line) as { id?: number }).id),
        [1, 3],
        "the call that was in flight when the link broke is the only casualty",
      );
    });
  },
);

test(
  "INV-SHIM-3: several calls made while the link is down are all flushed, in the client's order",
  { timeout: 20_000 },
  async (t) => {
    const root = makeRoot();
    const socketPath = path.join(root, SOCKET_FILE_NAME);
    const handles: DaemonHandle[] = [];
    const shims: McpShim[] = [];
    t.after(async () => {
      for (const shim of shims) await shim.stop();
      for (const handle of handles) await handle.shutdown();
      rmSync(root, { recursive: true, force: true });
    });

    const served: string[] = [];
    const respond = taggedResponder("svc", served);
    const serverSockets: Socket[] = [];
    handles.push(
      await startDaemon({
        socketPath,
        shutdownOnSignals: [],
        onConnection: (socket: Socket) => {
          serverSockets.push(socket);
          respond(socket);
        },
      }),
    );

    // The gate exists to make the buffer *deep*. Every other case here writes one call into a dead
    // link and lets the reconnect happen at once, so `pending` never holds more than a single line —
    // and a queue only ever tested with one element proves neither that the second one is flushed nor
    // that the order survives. Holding the relaunch is what lets three calls pile up at the same time.
    let gate: Promise<void> = Promise.resolve();
    let openGate: () => void = () => {};
    const closeGate = (): void => {
      gate = new Promise<void>((resolve) => {
        openGate = resolve;
      });
    };
    const launch: LaunchDaemon = async (options) => {
      await gate;
      const real = await startDaemon(options);
      handles.push(real);
      return real;
    };

    const stdin = new PassThrough();
    const out = collector();
    const err = collector();
    const shim = await startShim({
      socketPath,
      stdin,
      stdout: out.stream,
      stderr: err.stream,
      shutdownOnSignals: [],
      launch,
      reconnectDelayMs: 10,
    });
    shims.push(shim);
    assert.equal(shim.role, "delegated", "precondition: the shim must have converged on the running daemon");

    stdin.write(request(1, "initialize"));
    await waitFor(() => out.lines().length >= 1, 5_000, "the answer that proves the link works before it drops");
    assert.equal(shim.stats().bufferedLines, 0, "precondition: nothing is buffered while the link is up");

    closeGate();
    serverSockets[0]?.destroy();
    await waitFor(() => !shim.stats().connected, 5_000, "the shim to notice the link dropped");

    // Three calls, no link, no re-initialise: the client does not know anything happened.
    for (const id of [2, 3, 4]) stdin.write(request(id, "tools/call"));
    await waitFor(
      () => shim.stats().bufferedLines === 3,
      5_000,
      () => `all three calls to be held as whole messages at the same time (buffered: ${shim.stats().bufferedLines})`,
    );
    assert.equal(out.lines().length, 1, "and none of them may be answered while there is no daemon to answer");

    openGate();
    await waitFor(
      () => out.lines().length >= 4,
      10_000,
      () =>
        `every held call to be answered after the reconnect (answered: ${JSON.stringify(parsedStdout(out).map((response) => response.id))}, ` +
        `still buffered: ${shim.stats().bufferedLines}, daemon saw: ${served.length}, stderr: ${JSON.stringify(err.text().slice(-400))})`,
    );
    await sleep(150);

    assert.equal(shim.stats().bufferedLines, 0, "no call may be left stranded in the buffer");
    assert.equal(shim.stats().reconnects, 1, "exactly one reconnect carried all three of them");
    assert.deepEqual(
      served.map((line) => (JSON.parse(line) as { id?: number }).id),
      [1, 2, 3, 4],
      "the daemon must see every buffered call exactly once, in the order the client wrote them",
    );
    assert.deepEqual(
      parsedStdout(out).map((response) => response.id),
      [1, 2, 3, 4],
      "and the answers must reach the client in that same order",
    );
    assert.equal(shim.stats().linesToDaemon, 4, "every line is handed over once — none dropped, none sent twice");
  },
);
