// Traceability (harness/skills/test-design/SKILL.md, role: Test-Implementer).
//
// Requirements: INV-DIAG-4
// Feature:      feat-diag-open-on-query
//
// Level 3 (process-boundary, end to end) oracle for the daemon-side didOpen wiring: on a workspace
// whose Maven import already ran (`.project`/`.classpath` present), JDT LS does not re-run the
// initial import build, so `publishDiagnostics` never arrives for a file the daemon never opened.
// The regression is `java_diagnostics` answering `not-reported` forever for such a file. The fix
// under test: the daemon sends `textDocument/didOpen` for the queried document and waits for its
// publish before answering. Phase 1 imports the workspace (creates the metadata); phase 2 restarts a
// fresh daemon against the already-imported workspace and asserts the answer is `reported`.

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";

const ROOT = path.resolve(".");
const CLI_MODULE = path.join(ROOT, "src/cli.ts");
const JDTLS_FIXTURE_HOME = path.resolve(".cache/jdtls-fixture/1.61.0.202607231254");

const BROKEN = 'package fixture; public class Sample { int value = "wrong"; }\n';

interface DaemonChild {
  child: ChildProcessWithoutNullStreams;
  stdout: string;
  stderr: string;
}

function spawnDaemon(runtimeDir: string): DaemonChild {
  const child = spawn(process.execPath, ["--experimental-strip-types", CLI_MODULE], {
    stdio: ["pipe", "pipe", "pipe"],
    env: { ...process.env, JDTLS_HOME: JDTLS_FIXTURE_HOME, XDG_RUNTIME_DIR: runtimeDir },
  });
  const state = { stdout: "", stderr: "" };
  child.stdout.on("data", (c) => (state.stdout += c.toString("utf8")));
  child.stderr.on("data", (c) => (state.stderr += c.toString("utf8")));
  return {
    child,
    get stdout() { return state.stdout; },
    get stderr() { return state.stderr; },
  };
}

function waitFor(read: () => boolean, detail: string, timeoutMs = 60_000): Promise<void> {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + timeoutMs;
    const poll = () => {
      if (read()) return resolve();
      if (Date.now() >= deadline) return reject(new Error(`timed out waiting for ${detail}`));
      setTimeout(poll, 25);
    };
    poll();
  });
}

function killAndWait(d: DaemonChild): Promise<void> {
  return new Promise((resolve) => {
    if (d.child.exitCode !== null || d.child.signalCode !== null) return resolve();
    d.child.once("exit", () => resolve());
    d.child.kill("SIGKILL");
  });
}

interface JsonRpcResult { id: number; result: unknown }

function resultsOf(stdout: string): JsonRpcResult[] {
  return stdout.split("\n").map((l) => l.trim()).filter(Boolean)
    .map((l) => { try { return JSON.parse(l); } catch { return null; } })
    .filter((m) => m !== null && m.id !== undefined && m.result !== undefined) as JsonRpcResult[];
}

/** Send initialize + one java_diagnostics call; resolve to the tool's result text. */
async function runDiagnostics(daemon: DaemonChild, javaPath: string): Promise<string> {
  const before = resultsOf(daemon.stdout).length;
  daemon.child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "test", version: "0" } } }) + "\n");
  daemon.child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "java_diagnostics", arguments: { path: javaPath } } }) + "\n");
  await waitFor(() => resultsOf(daemon.stdout).length >= before + 2, "initialize + java_diagnostics responses");
  const call = resultsOf(daemon.stdout).find((r) => r.id === 2);
  assert.ok(call, "tools/call java_diagnostics must respond");
  const result = call.result as { content?: Array<{ text?: string }> };
  assert.ok(result.content?.[0]?.text, `tools/call must carry text content; stdout=${JSON.stringify(daemon.stdout.slice(-500))}`);
  return result.content[0].text as string;
}

test(
  "INV-DIAG-4: java_diagnostics answers 'reported' for a file on an already-imported workspace",
  { timeout: 240_000 },
  async (t) => {
    const root = mkdtempSync(path.join(tmpdir(), "jdt-diag-open-"));
    t.after(() => rmSync(root, { recursive: true, force: true }));
    const runtimeDir = path.join(root, "runtime");
    mkdirSync(runtimeDir, { recursive: true });

    const projectRoot = path.join(root, "project");
    const javaPath = path.join(projectRoot, "src/main/java/fixture/Sample.java");
    mkdirSync(path.dirname(javaPath), { recursive: true });
    writeFileSync(path.join(projectRoot, "pom.xml"), "<project><modelVersion>4.0.0</modelVersion><groupId>fixture</groupId><artifactId>sample</artifactId><version>1</version></project>\n");
    writeFileSync(javaPath, BROKEN, "utf8");

    // Phase 1: a first daemon acquires the workspace and imports it (m2e writes .project/.classpath).
    const d1 = spawnDaemon(runtimeDir);
    t.after(() => { try { d1.child.kill("SIGKILL"); } catch { /* already dead */ } });
    await waitFor(() => d1.stderr.includes("ready"), "daemon 1 ready");
    await runDiagnostics(d1, javaPath);
    await waitFor(() => existsSync(path.join(projectRoot, ".project")), "m2e import wrote .project", 30_000);
    await killAndWait(d1);
    rmSync(path.join(runtimeDir, "jdt-mcp.sock"), { force: true });
    rmSync(path.join(runtimeDir, "jdt-mcp.sock.lock"), { force: true });

    // Phase 2: a fresh daemon, fresh cache, against the now-already-imported workspace.
    const d2 = spawnDaemon(runtimeDir);
    t.after(() => { try { d2.child.kill("SIGKILL"); } catch { /* already dead */ } });
    await waitFor(() => d2.stderr.includes("ready"), "daemon 2 ready");
    const text = await runDiagnostics(d2, javaPath);

    const answer = JSON.parse(text);
    assert.equal(answer.isError, false, `java_diagnostics must succeed: ${text}`);
    assert.equal(answer.value.files[0].status, "reported", `must be 'reported', not 'not-reported': ${text}`);
    const problems = answer.value.files[0].problems ?? [];
    assert.ok(
      problems.some((p: { message?: string }) => String(p.message).includes("Type mismatch")),
      `must carry the deliberate type error: ${text}`,
    );
  },
);
