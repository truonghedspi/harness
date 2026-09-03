// Traceability (skills/test-design/SKILL.md, role: Test-Implementer).
//
// Conditions: TCON-SHIM-0001, TCON-SHIM-0002, TCON-SHIM-0003
// Requirements: INV-SHIM-1, INV-SHIM-2, INV-SHIM-4
// Plan: TP-SHIM-0001 | Feature: feat-prove-daemon-lifecycle
//
// The three invariants proven here are all properties of TRUE PROCESS, not of value
// returns, so every "launch" in this file is a child `node` process that loads directly into `startShim` /
// `startDaemon` from `src/`. The project does not declare `bin` in package.json and this oracle does not need a CLI:
// The boundaries to measure are real stdout, real process table and real single-instance lock, all three
// observed from a child process that loads the module directly. Which assertion actually requires a CLI entry
// point belongs to feat-prove-cross-process-integration, not this file.
//
// Four design choices, and why:
//
// 1. INV-SHIM-1 measures stdout of the shim process ITSELF. A `Writable` injected via `McpShimOptions.stdout`
// never see a stray `console.log`, which is literally the line that breaks the deal
// one-message-one-line client. The session here has two shims: the first shim is cold start and
// auto-spawn daemon, the second shim converges on that daemon — so the noise that the second shim filters comes from
// ANOTHER PROCESS, via real Unix socket.
// 2. INV-SHIM-2 counts daemons with `lsof` on the correct socket path, not just with `role` but the
// self-declared launcher. `lsof -t <socket>` lists only the process that is HOLDING (bind) that path —
// connected clients don't appear — so it's a live daemon count on the process table.
// The four launchers wait at a barrier before calling `startDaemon` together, making them real
// compete for locks instead of being sequentially ranked by module loading time.
// 3. INV-SHIM-4 measured in `ps` after shutdown. The JDT LS child processes here are the real Node processes
// fixture spawn (project convention in pool-crash-handling / pool-lifecycle: "real child
//process" means a real child process acting as an emulator, not loading the real JDT LS binary), and
// they are the grandchildren of the test process. If shutdown misses a child, will that child be reparented?// don't die with the daemon — exactly the kind of orphaned JVM that this invariant prohibits, and `ps` sees.
// 4. There is no assertion that the process dies when the socket fails. `startDaemon` returns
// `handle.connection` carries `probeDaemon`'s redundant "error" listener (intentional decision,
// DECISIONS.md 2026-08-23), so the link error disappears silently rather than being thrown. Correct behavior when linking
// failure is to write stderr then reconnect transparently (INV-SHIM-3) — outside the three conditions of the plan
// this (see spec_gaps of TP-SHIM-0001) and is not tested here.

import { test } from "node:test";
import assert from "node:assert/strict";
import { executeFileSync, spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { connect, type Socket } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";

import { SOCKET_FILE_NAME } from "../../src/daemon/daemon-supervisor.ts";

/** Absolute path, so that the child process loads the correct ciphertext being tested. */
const SHIM_MODULE = path.resolve(import.meta.dirname, "../../src/shim/mcp-shim.ts");
const SUPERVISOR_MODULE = path.resolve(import.meta.dirname, "../../src/daemon/daemon-supervisor.ts");
const POOL_MODULE = path.resolve(import.meta.dirname, "../../src/workspace/workspace-pool.ts");

/** Prefix is ​​intentionally short: sun_path is only 104 bytes on macOS, and tmpdir() eats ~50 bytes. */
function makeRoot(): string {
  return mkdtempSync(path.join(tmpdir(), "jdt-l-"));
}

interface Child {
  child: ChildProcess;
  stdout(): string;
  stderr(): string;
  lines(): string[];
  kill(): void;
}

/**
 * `detached` so that each child process is a separate process group: when cleaning up, we can kill the whole group,
 * including grandchild processes, instead of leaving the orphaned daemon or JDT LS to hold the socket.
 */
function spawnScript(scriptPath: string, args: readonly string[]): Child {
  const child = spawn(process.execPath, ["--experimental-strip-types", scriptPath, ...args], {
    stdio: ["pipe", "pipe", "pipe"],
    detached: true,
  });
  let stdout = "";
  let stderr = "";child.stdout?.on("data", (chunk: Buffer) => (stdout += chunk.toString("utf8")));
  child.stderr?.on("data", (chunk: Buffer) => (stderr += chunk.toString("utf8")));
  return {
    child,
    stdout: () => stdout,
    stderr: () => stderr,
    lines: () => stdout.split("\n").filter((line) => line.length > 0),
    kill: () => {
      if (child.exitCode !== null || child.signalCode !== null || child.pid === undefined) return;
      try {
        process.kill(-child.pid, "SIGKILL");
      } catch {
        child.kill("SIGKILL");
      }
    },
  };
}

/** `describe` can be thunk: a builtin string that only recounts the state at the beginning of the wait, i.e. the useless state. */
async function waitFor(predicate: () => boolean, budgetMs: number, describe: string | (() => string)): Promise<void> {
  const deadline = Date.now() + budgetMs;
  while (!predicate()) {
    if (Date.now() >= deadline) {
      throw new Error(
        `timed out after ${budgetMs} ms waiting for: ${typeof describe === "string" ? describe : describe()}`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function request(id: number, method: string): string {
  return `${JSON.stringify({ jsonrpc: "2.0", id, method, params: {} })}\n`;
}

/**
 * Real progress table. `ps -o pid= -p ...` lists the correct pids that exist; a process has died
 * but not yet reaped (zombie) STILL appears here, so this measurement is stricter than `kill(pid, 0)`
 * is not looser — there is no way for an orphaned JVM to get through.
 */
function livePids(pids: readonly number[]): number[] {
  if (pids.length === 0) return [];
  let output = "";
  try {
    output = executeFileSync("ps", ["-o", "pid=", "-p", pids.join(",")], { encoding: "utf8" });
  } catch {
    // `ps` exits non-zero when NO pid is alive; that's a valid result, not a tool error.
    output = "";
  }
  return output
    .split("\n")
    .map((line) => Number.parseInt(line.trim(), 10))
    .filter((pid) => Number.isInteger(pid) && pids.includes(pid));
}/** Processes HOLDING the socket path, meaning daemons are listening on it. */
function pidsListeningOn(socketPath: string): number[] {
  let output = "";
  try {
    output = executeFileSync("lsof", ["-t", socketPath], { encoding: "utf8" });
  } catch {
    output = "";
  }
  return output
    .split("\n")
    .map((line) => Number.parseInt(line.trim(), 10))
    .filter((pid) => Number.isInteger(pid));
}

// -----------------------------------------------------------------------------------------------
// TCON-SHIM-0001 [INV-SHIM-1]
// -----------------------------------------------------------------------------------------------

/**
 * Scenario of a real shim process. Its daemon side intentionally emits exactly what INV-SHIM-1 does
 * prohibit reaching the client: acceptance banner, Java stack trace, WARN line, one `null` and one `42` (two
 * valid JSON string but NOT MCP message), then the actual answer. The answer is yes
 * written in three separate writes and carrying one large field, so if the message frame is not intact
 * For each message, stdout will have a broken line.
 *
 * The ready datum comes out to STDERR, not stdout: stdout is what is being measured, a datum on it will automatically
 * corrupts the measurement.
 */
function shimProcessScript(): string {
  return `import { startShim } from ${JSON.stringify(SHIM_MODULE)};

const [socketPath] = process.argv.slice(2);
const NEWLINE = String.fromCharCode(10);
const NOISE = [
  "Error: java.lang.IllegalStateException: workspace index not ready",
  " at org.eclipse.jdt.ls.core.internal.Handler.handle(Handler.java:42)",
  "[jdt-mcp daemon] WARN resync in progress",
  "null",
  "42",
];

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function daemonSide(socket) {
  socket.write("[jdt-mcp daemon] INFO accepted a client connection" + NEWLINE);
  // Sequential queue: each response is written in three separate writes, so two responses run
  //parallel will mix each other's bytes. That's the daemon's fault, not the hazard that shim has
  // responsible for editing, so fixture records each message one by one, completely.
  const queue = [];
  let pumping = false;
  async function pump() {
    if (pumping) return;pumping = true;
    while (queue.length > 0) {
      const message = queue.shift();
      for (const noise of NOISE) socket.write(noise + NEWLINE);
      const answer = JSON.stringify({
        jsonrpc: "2.0",
        id: message.id,
        result: {
          servedBy: process.pid,
          // A REAL newline inside the string value: JSON.stringify escapes it to two characters, so
          // message must still fit on one line.
          note: "first" + NEWLINE + "second",
          pad: "p".repeat(50000),
        },
      });
      const third = Math.ceil(answer.length / 3);
      socket.write(answer.slice(0, third));
      await delay(10);
      socket.write(answer.slice(third, third * 2));
      await delay(10);
      socket.write(answer.slice(third * 2) + NEWLINE);
    }
    pumping = false;
  }
  let buffer = "";
  socket.on("data", (chunk) => {
    buffer += chunk.toString("utf8");
    for (;;) {
      const index = buffer.indexOf(NEWLINE);
      if (index < 0) {
        void pump();
        return;
      }
      const line = buffer.slice(0, index);
      buffer = buffer.slice(index + 1);
      if (line.trim().length === 0) continue;
      queue.push(JSON.parse(line));
    }
  });
}

const shim = await startShim({ socketPath, shutdownOnSignals: [], onConnection: daemonSide });
process.stderr.write("shim-ready role=" + shim.role + NEWLINE);
await shim.done;
`;
}

interface McpLine {
  raw: string;
  parsed: { id?: number; result?: { servedBy?: number; note?: string; pad?: string } };
}

/**
 * A single pass over everything shim has written to its own stdout: split by newline, each
 * line must parse to EXACTLY ONE valid MCP message. Three failures are caught here — the daemon's log line
 * gets through, the message is cut off between two writes, and a valid JSON value but not an object.
 */
function assertEveryStdoutLineIsOneMcpMessage(label: string, child: Child): McpLine[] {
  const raw = child.stdout();
  const lines = raw.split("\n").filter((line) => line.length > 0);
  assert.ok(lines.length > 0, `${label}: empty stdout, nothing to check — oracle would be meaningless`);assert.equal(raw.endsWith("\n"), true, `${label}: every message on stdout must end with newline`);
  return lines.map((line, index) => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch (error) {
      assert.fail(
        `${label}: INV-SHIM-1 broken — line ${index + 1} of stdout could not be parsed into JSON: ` +
          `${JSON.stringify(line.slice(0, 300))} (${(error as Error).message})`,
      );
    }
    assert.ok(
      typeof parsed === "object" && parsed !== null,
      `${label}: INV-SHIM-1 broken — line ${index + 1} parsable but not an MCP message: ` +
        `${JSON.stringify(line.slice(0, 300))}`,
    );
    return { raw: line, parsed: parsed as McpLine["parsed"] };
  });
}

test(
  "TCON-SHIM-0001: across a real shim+daemon session with daemon-side interference, every line on shim's stdout is exactly one MCP message [INV-SHIM-1]",
  { timeout: 60_000 },
  async(t) => {
    const root = makeRoot();
    const socketPath = path.join(root, SOCKET_FILE_NAME);
    const scriptPath = path.join(root, "shim-child.mjs");
    writeFileSync(scriptPath, shimProcessScript());
    const children: Child[] = [];
    t.after(() => {
      for (const child of children) child.kill();
      rmSync(root, { recursive: true, force: true });
    });

    assert.equal(existsSync(socketPath), false, "premise: nothing is serving this socket path yet");

    // First shim cold start: there are no daemons on the path, so it must auto-spawn.
    const host = spawnScript(scriptPath, [socketPath]);
    children.push(host);
    await waitFor(
      () => host.stderr().includes("shim-ready role="),
      20_000,
      () => `first shim finished booting (stderr: ${JSON.stringify(host.stderr().slice(-300))})`,
    );
    assert.match(
      host.stderr(),
      /shim-ready role=daemon/,
      `cold boot must inject the first shim into the daemon role, stderr: ${JSON.stringify(host.stderr().slice(-300))}`,
    );
    assert.ok(statSync(socketPath).isSocket(), "auto-spawn must leave a real socket in the correct path");

    // The second shim converges on that daemon: from here, the noise it must filter comes from ANOTHER PROCESS.const joiner = spawnScript(scriptPath, [socketPath]);
    children.push(joiner);
    await waitFor(
      () => joiner.stderr().includes("shim-ready role="),
      20_000,
      () => `second shim finished booting (stderr: ${JSON.stringify(joiner.stderr().slice(-300))})`,
    );
    assert.match(
      joiner.stderr(),
      /shim-ready role=delegated/,
      `The second shim must converge to the running daemon, stderr: ${JSON.stringify(joiner.stderr().slice(-300))}`,
    );

    const hostIds = [1, 2, 3];
    const joinerIds = [11, 12, 13];
    for (const id of hostIds) host.child.stdin?.write(request(id, "tools/call"));
    for (const id of joinerIds) joiner.child.stdin?.write(request(id, "tools/call"));

    await waitFor(
      () => host.lines().length >= hostIds.length && joiner.lines().length >= joinerIds.length,
      30_000,
      () =>
        `both shim answer enough (host: ${host.lines().length}, joiner: ${joiner.lines().length}, ` +
        `host stderr: ${JSON.stringify(host.stderr().slice(-300))})`,
    );
    // Give any leaks enough time to arrive BEFORE asserting there are no flows.
    await sleep(400);

    const noise = [
      "[jdt-mcp daemon] INFO accepted a client connection",
      "Error: java.lang.IllegalStateException: workspace index not ready",
      " at org.eclipse.jdt.ls.core.internal.Handler.handle(Handler.java:42)",
      "[jdt-mcp daemon] WARN resync in progress",
    ];
    const hostPid = host.child.pid;
    assert.ok(hostPid !== undefined, "premise: fixture must know the pid of the process holding the daemon role");

    for (const [label, child, ids, expectedServer] of [
      ["shim auto-spawn", host, hostIds, hostPid],
      ["convergence shim", joiner, joinerIds, hostPid],
    ] as const) {
      // A single scan of the entire capture, before all other assertions: this is it
      // falsifier of the condition, so it must be the first thing to break when there is a strange line on stdout.
      const messages = assertEveryStdoutLineIsOneMcpMessage(label, child);
      assert.equal(
        messages.length,
        ids.length,
        `${label}: stdout can only carry ${ids.length} responses, get ${messages.length} lines`,
      );assert.deepEqual(
        messages.map((message) => message.parsed.id),
        ids,
        `${label}: answers must arrive in the correct order and without distortion`,
      );
      for (const line of noise) {
        assert.ok(
          !child.stdout().includes(line),
          `${label}: INV-SHIM-1 broken — stdout carries noise line ${JSON.stringify(line)}`,
        );
        // Not empty: noise ACTUALLY went through the daemon channel and was passed to stderr. If
        // lacking this assertion, "clean stdout" just says that nothing happens.
        assert.ok(
          child.stderr().includes(JSON.stringify(line)),
          `${label}: noisy line must appear on stderr to be debugging: ${JSON.stringify(line)} ` +
            `(stderr: ${JSON.stringify(child.stderr().slice(-500))})`,
        );
      }
      for (const [index, message] of messages.entries()) {
        assert.equal(
          message.parsed.result?.servedBy,
          expectedServer,
          `${label}: answer ${index + 1} must be served by the correct daemon process`,
        );
        assert.equal(
          message.parsed.result?.pad?.length,
          50_000,
          `${label}: response ${index + 1} must be intact, no bytes lost at the boundary of writes`,
        );
        // Message carries an escaped newline inside the string: after parsing there must be a real newline, also
        // raw lines do not — meaning no message spans more than one line.
        assert.ok(
          message.parsed.result?.note?.includes("\n"),
          `${label}: ${index + 1} response must preserve escaped newline inside string value`,
        );
        assert.ok(
          !message.raw.includes("\n"),
          `${label}: the answer ${index + 1} cannot span more than one line on the wire`,
        );
      }
    }
  },
);

// -----------------------------------------------------------------------------------------------
// TCON-SHIM-0002 [INV-SHIM-2]
// -----------------------------------------------------------------------------------------------

/**
 * An independent launcher. It finishes loading the module, then STOPS at the fence and reports "armed" via stderr; only if* receives "go" on stdin then calls `startDaemon`. Without this barrier, module loading time
 * of N different processes arrange themselves sequentially and lock contention windows — the only thing that
 * INV-SHIM-2 exists to close — never to open.
 */
function launcherProcessScript(): string {
  return `import { startDaemon } from ${JSON.stringify(SUPERVISOR_MODULE)};

const [socketPath, label] = process.argv.slice(2);
const NEWLINE = String.fromCharCode(10);

process.stderr.write("armed" + NEWLINE);
await new Promise((resolve) => {
  let buffer = "";
  process.stdin.on("data", (chunk) => {
    buffer += chunk.toString("utf8");
    if (buffer.includes("go")) resolve();
  });
});

const handle = await startDaemon({
  socketPath,
  shutdownOnSignals: [],
  startTimeoutMs: 20000,
  onConnection: (socket) => socket.write(JSON.stringify({ servedBy: process.pid }) + NEWLINE),
});
console.log(JSON.stringify({ label, self: process.pid, role: handle.role, daemonPid: handle.daemonPid ?? null }));
// Keep the process alive so that the process table can still be observed during positive testing.
setInterval(() => {}, 1000);
`;
}

interface LauncherReport {
  label: string;
  self: number;
  role: string;
  daemonPid: number | null; null;
}

test(
  "TCON-SHIM-0002: four independent launchers running simultaneously converging on a single daemon [INV-SHIM-2]",
  { timeout: 60_000 },
  async(t) => {
    const root = makeRoot();
    const socketPath = path.join(root, SOCKET_FILE_NAME);
    const scriptPath = path.join(root, "launcher-child.mjs");
    writeFileSync(scriptPath, launcherProcessScript());
    const children: Child[] = [];
    const sockets: Socket[] = [];
    t.after(() => {
      for (const socket of sockets) socket.destroy();
      for (const child of children) child.kill();
      rmSync(root, { recursive: true, force: true });
    });

    const N = 4;
    assert.ok(N >= 3, "condition requires N >= 3 launchers at the same time");
    assert.equal(existsSync(socketPath), false, "premise: no daemons running on this path yet");

    for (let index = 0; index < N; index += 1) {
      children.push(spawnScript(scriptPath, [socketPath, `launcher-${index}`]));
    }
    await waitFor(() => children.every((child) => child.stderr().includes("armed")),
      30_000,
      () => `both ${N} launcher to fence (stderr: ${JSON.stringify(children.map((child) => child.stderr()))})`,
    );

    // Open the fence in a single synchronous loop: all N are released at approximately the same time.
    for (const child of children) child.child.stdin?.write("go\n");

    await waitFor(
      () => children.every((child) => child.lines().length >= 1),
      30_000,
      () =>
        `both ${N} launchers report convergent results (stdout: ${JSON.stringify(children.map((child) => child.stdout()))}, ` +
        `stderr: ${JSON.stringify(children.map((child) => child.stderr().slice(-200)))})`,
    );

    const reports = children.map((child, index) => {
      const line = child.lines()[0] ?? "";
      try {
        return JSON.parse(line) as LauncherReport;
      } catch (error) {
        return assert.fail(
          `launcher ${index} failed to report: ${JSON.stringify(line.slice(0, 300))} (${(error as Error).message})`,
        );
      }
    });

    // 1. Every launcher must call the SAME pid daemon.
    const namedPids = new Set(reports.map((report) => report.daemonPid));
    assert.equal(
      namedPids.size,
      1,
      `all ${N} launchers must call the same pid daemon, receiving ${JSON.stringify([...namedPids])}`,
    );
    const daemonPid = reports[0]?.daemonPid;
    assert.ok(typeof daemonPid === "number", "the daemon pid named by launchers must be a real pid");

    // 2. Exactly one launcher bind, the rest delegate — no launcher is allowed to fail.
    const bound = reports.filter((report) => report.role === "daemon");
    const delegated = reports.filter((report) => report.role === "delegated");
    assert.equal(
      bound.length,
      1,
      `exactly one launcher is allowed to bind socket, with ${bound.length} (${JSON.stringify(reports)})`,
    );
    assert.equal(delegated.length, N - 1, `${N - 1} remaining launchers must delegate, cannot fail`);
    assert.equal(bound[0]?.self, daemonPid, "the named pid must be the same process that bound the socket");// 3. Progress table: yes ONE daemon is listening on that socket path. `lsof -t` only
    // lists the process holding the same path, so this is a direct daemon count.
    const listening = pidsListeningOn(socketPath);
    assert.ok(
      listening.includes(daemonPid),
      `process table measurement must see daemon ${daemonPid} on ${socketPath}, lsof returns ${JSON.stringify(listening)}`,
    );
    assert.deepEqual(
      listening
      [daemonPid],
      `INV-SHIM-2 broken: progress table has ${listening.length} daemon listening on ${socketPath}`,
    );
    assert.ok(statSync(socketPath).isSocket(), "and indeed a socket file exists at the specified path");

    // 4. The single-instance lock carries that exact pid — no second launcher ever holds it.
    assert.equal(
      readFileSync(`${socketPath}.lock`, "utf8").trim(),
      String(daemonPid),
      "single-instance lock must carry the pid of the correct running daemon",
    );

    // 5. Dynamic control: the process that actually serves this path is the pid itself.
    const probe = await new Promise<Socket>((resolve, reject) => {
      const socket = connect(socketPath);
      socket.once("connect", () => resolve(socket));
      socket.once("error", reject);
    });
    sockets.push(probe);
    const greeting = await new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("daemon did not greet again within 10 s")), 10_000);
      probe.once("data", (chunk: Buffer) => {
        clearTimeout(timer);
        resolve(chunk.toString("utf8").split("\n")[0] ?? "");
      });
    });
    assert.equal(
      (JSON.parse(greeting) as {servedBy?: number }).servedBy,
      daemonPid,
      "the process serving the socket path must be the only daemon that all four launchers call",
    );
  },
);

// -----------------------------------------------------------------------------------------------
// TCON-SHIM-0003 [INV-SHIM-4]
// -----------------------------------------------------------------------------------------------

/** The child process plays the role of JDT LS: lives until killed, and says "alive" to keep the fixture from sleeping. */const FAKE_JDTLS_SCRIPT = `process.stdout.write("alive" + String.fromCharCode(10));
setInterval(() => {}, 1000);
`;

/**
 * A real daemon supports three real JDT LS child processes, divided into TWO pools: the first pool is given at once
 * initialized, second pool is `adopt` later. Two pools and three fish is intentional — a kill-only setting
 * the first child, just kill the most recently used child, or just close the initialization pool and leave the adoption pool
 * passes a one-child test, while leaving the JVM orphaned.
 *
 * Child processes are grandchildren of the test process, so if shutdown misses one, that child will be reparented
 * and continues to live — exactly the same type of failure seen by `ps` on the test side.
 */
function workspaceDaemonScript(): string {
  return `import { spawn } from "node:child_process";
import { startDaemon } from ${JSON.stringify(SUPERVISOR_MODULE)};
import { createWorkspacePool, terminate } from ${JSON.stringify(POOL_MODULE)};

const [socketPath, cacheRoot, fakeScript, joinedRoots] = process.argv.slice(2);
const NEWLINE = String.fromCharCode(10);
const roots = joinedRoots.split(",");

function makeSpawner() {
  return async ({ canonicalRoot }) => {
    const child = spawn(process.execPath, [fakeScript], {
      cwd: canonicalRoot,
      stdio: ["ignore", "pipe", "ignore"],
    });
    await new Promise((resolve, reject) => {
      child.stdout.on("data", (chunk) => {
        if (chunk.toString("utf8").includes("alive")) resolve();
      });
      child.once("error", reject);
    });
    return { pid: child.pid, stop: () => terminate(child, 2000) };
  };
}

const constructed = createWorkspacePool({ cacheRoot: cacheRoot + "/constructed", spawnWorkspace: makeSpawner() });
const adopted = createWorkspacePool({ cacheRoot: cacheRoot + "/adopted", spawnWorkspace: makeSpawner() });

const handle = await startDaemon({ socketPath, pools: [constructed], shutdownOnSignals: [] });
if (handle.role !== "daemon") {
  process.stderr.write("role=" + handle.role + NEWLINE);
  process.exit(3);
}
handle.adopt(adopted);

const pids = [];
for (let index = 0; index < roots.length; index += 1) {
  const pool = index === roots.length - 1 ? adopted : constructed;
  const lease = await pool.acquire(roots[index]);pids.push(lease.pid);
  await lease.release();
}
console.log("children " + pids.join(","));

process.stdin.on("data", (chunk) => {
  if (!chunk.toString("utf8").includes("shutdown")) return;
  handle.shutdown().then(
    () => console.log("shutdown-resolved"),
    (error) => process.stderr.write("shutdown-failed: " + error.message + NEWLINE),
  );
});
`;
}

test(
  "TCON-SHIM-0003: daemon shutdown terminates EVERY JDT LS child process it has spawned, not just the first child [INV-SHIM-4]",
  { timeout: 60_000 },
  async(t) => {
    const root = makeRoot();
    const socketPath = path.join(root, SOCKET_FILE_NAME);
    const daemonScript = path.join(root, "workspace-daemon.mjs");
    const fakeScript = path.join(root, "fake-jdtls.mjs");
    writeFileSync(daemonScript, workspaceDaemonScript());
    writeFileSync(fakeScript, FAKE_JDTLS_SCRIPT);

    const projectRoots = ["alpha", "beta", "gamma"].map((name) => {
      const projectRoot = path.join(root, name);
      mkdirSync(projectRoot, { recursive: true });
      return projectRoot;
    });

    let workspacePids: number[] = [];
    const children: Child[] = [];
    t.after(() => {
      for (const pid of workspacePids) {
        try {
          process.kill(pid, "SIGKILL");
        } catch {
          // Died — that is the expected result of this case.
        }
      }
      for (const child of children) child.kill();
      rmSync(root, { recursive: true, force: true });
    });

    const daemon = spawnScript(daemonScript, [
      socketPath,
      path.join(root, "cache"),
      fakeScript,
      projectRoots.join(","),
    ]);
    children.push(daemon);

    await waitFor(
      () => /children \d+(,\d+)*/.test(daemon.stdout()),
      30_000,
      () =>
        `daemon finished building workspaces (stdout: ${JSON.stringify(daemon.stdout())}, ` +
        `stderr: ${JSON.stringify(daemon.stderr().slice(-400))})`,
    );
    workspacePids = (/children ([\d,]+)/.exec(daemon.stdout())?.[1] ??" "")
      .split(",")
      .map((value) => Number.parseInt(value, 10));

    // Premise: TWO OR MORE different workspaces are actually living under one daemon.assert.equal(workspacePids.length, 3, `daemon must support three workspaces, receives ${JSON.stringify(workspacePids)}`);
    assert.equal(new Set(workspacePids).size, 3, "the three workspaces must be three different child processes");
    assert.deepEqual(
      livePids(workspacePids),
      workspacePids,
      "premise: all three JDT LS child processes must be alive in the process table before shutdown",
    );

    daemon.child.stdin?.write("shutdown\n");
    await waitFor(
      () => daemon.stdout().includes("shutdown-resolved"),
      30_000,
      () =>
        `shutdown() of daemon settle (stdout: ${JSON.stringify(daemon.stdout())}, ` +
        `stderr: ${JSON.stringify(daemon.stderr().slice(-400))})`,
    );

    let survivors = livePids(workspacePids);
    const deadline = Date.now() + 10_000;
    while (survivors.length > 0 && Date.now() < deadline) {
      await sleep(50);
      survivors = livePids(workspacePids);
    }

    assert.deepEqual(
      survivors,
      [],
      `INV-SHIM-4 broken: after shutdown the progress table still has ${survivors.length}/${workspacePids.length} ` +
        `JDT LS child process: ${JSON.stringify(survivors)} (all: ${JSON.stringify(workspacePids)})`,
    );
    assert.equal(existsSync(socketPath), false, "shutdown must also not leave its own socket file behind");
  },
);