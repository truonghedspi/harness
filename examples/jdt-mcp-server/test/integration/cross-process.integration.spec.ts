// Traceability (harness/skills/test-design/SKILL.md, role: Test-Implementer).
//
// Requirements: INV-SYNC-1, INV-ROUTE-1
// Feature:      feat-prove-cross-process-integration
//
// Level 3 (process-boundary, end to end) oracle: the real shim -> daemon -> JDT LS pipeline. The
// production daemon composition root does not yet exist as a shipped artifact, so this file builds it
// once (the same wiring navigation-tools.integration.spec.ts builds in-process, but here across two
// real processes): the daemon wires project-router + workspace-pool + readiness-gate + file-sync
// watcher + sync-guard into an LspFacade, and routes MCP `tools/call` for java_definition through it.
// A real shim connects to the daemon over a Unix socket; the test speaks MCP to the shim's stdio.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";

const ROOT = path.resolve(".");
const SHIM_MODULE = path.join(ROOT, "src/shim/mcp-shim.ts");
const SUPERVISOR_MODULE = path.join(ROOT, "src/daemon/daemon-supervisor.ts");
const POOL_MODULE = path.join(ROOT, "src/workspace/workspace-pool.ts");
const ROUTER_MODULE = path.join(ROOT, "src/workspace/project-router.ts");
const GATE_MODULE = path.join(ROOT, "src/workspace/readiness-gate.ts");
const WATCHER_MODULE = path.join(ROOT, "src/workspace/file-sync-watcher.ts");
const SYNC_GUARD_MODULE = path.join(ROOT, "src/workspace/sync-guard.ts");
const DEFINITION_MODULE = path.join(ROOT, "src/tools/definition.ts");

const JDTLS_FIXTURE_HOME = path.resolve(".cache/jdtls-fixture/1.61.0.202607231254");

const GREETER_SOURCE = 'package fixture;\npublic class Greeter {\n    public String greet(String name) { return "hi " + name; }\n}\n';
const APP_SOURCE = 'package fixture;\npublic class App {\n    public static void main(String[] a) { Greeter g = new Greeter(); System.out.println(g.greet("w")); }\n}\n';

/** Vị trí 1-based của token `greet` trong lời gọi (App.java). */
function greetCallPosition(): { line: number; column: number } {
  const lines = APP_SOURCE.split("\n");
  const lineIndex = lines.findIndex((line) => line.includes("g.greet("));
  assert.ok(lineIndex >= 0, "fixture must call g.greet(...)");
  const column = lines[lineIndex]!.indexOf("greet");
  return { line: lineIndex + 1, column: column + 1 };
}

/** Daemon composition root: routes MCP `tools/call` for java_definition through the real stack. */
function daemonScript(socketPath: string, cacheRoot: string): string {
  return `import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { startDaemon } from ${JSON.stringify(SUPERVISOR_MODULE)};
import { createWorkspacePool } from ${JSON.stringify(POOL_MODULE)};
import { resolveWorkspace } from ${JSON.stringify(ROUTER_MODULE)};
import { createReadinessGate } from ${JSON.stringify(GATE_MODULE)};
import { attachFileSync } from ${JSON.stringify(WATCHER_MODULE)};
import { withSyncQuiescence } from ${JSON.stringify(SYNC_GUARD_MODULE)};
import { definition } from ${JSON.stringify(DEFINITION_MODULE)};

const socketPath = ${JSON.stringify(socketPath)};
const cacheRoot = ${JSON.stringify(cacheRoot)};
const NEWLINE = String.fromCharCode(10);

const watchers = new Map();
const pool = createWorkspacePool({ cacheRoot, maxWorkspaces: 3, attachments: [attachFileSync({ onStarted: (ctx, watcher) => watchers.set(ctx.workspaceId, watcher) })] });
const targets = new Map();
const gate = createReadinessGate({ resolveTarget: (id) => targets.get(id) });

const handshaken = new Set();
async function ensureHandshake(workspaceId, client, projectRoot) {
  if (handshaken.has(workspaceId)) return;
  handshaken.add(workspaceId);
  client.onRequest("workspace/configuration", (params) => {
    const items = (params && params.items) || [];
    return Array.from({ length: Array.isArray(items) ? items.length : 0 }, () => ({}));
  });
  client.onRequest("client/registerCapability", () => null);
  client.onRequest("window/workDoneProgress/create", () => null);
  client.onNotification("language/status", (params) => {
    if (params && typeof params.type === "string") gate.noteStatus(workspaceId, { type: params.type, message: typeof params.message === "string" ? params.message : undefined });
  });
  const projectUri = pathToFileURL(projectRoot).href;
  await client.request("initialize", {
    processId: process.pid,
    rootUri: projectUri,
    workspaceFolders: [{ uri: projectUri, name: workspaceId }],
    capabilities: { workspace: { configuration: true, workspaceFolders: true }, textDocument: { definition: {}, publishDiagnostics: {} } },
  });
  client.notify("initialized", {});
  targets.set(workspaceId, { workspaceId, projectRoot, client });
}

const lastGeneration = new Map();
async function routeDefinition(args) {
  const resolution = resolveWorkspace(args.path);
  if ("error" in resolution) return { isError: true, code: "unroutable", message: "unroutable: " + resolution.error };
  const lease = await pool.acquire(resolution.projectRoot);
  try {
    const client = lease.client;
    await ensureHandshake(lease.workspaceId, client, resolution.projectRoot);
    await gate.awaitReady(lease.workspaceId, { withinMs: 120000 });
    const watcher = watchers.get(lease.workspaceId);
    const generation = watcher ? watcher.generation : 0;
    const previous = lastGeneration.get(lease.workspaceId) ?? generation;
    lastGeneration.set(lease.workspaceId, generation);
    const facade = {
      workspace: async () => ({ status: "ready", workspaceId: lease.workspaceId }),
      readFile: (p) => { try { return readFileSync(p, "utf8"); } catch { return undefined; } },
      request: async (method, params) => client.request(method, { ...params, textDocument: { ...params.textDocument, uri: pathToFileURL(params.textDocument.uri).href } }),
    };
    if (generation === previous) {
      // No change was dispatched since the last call — answer directly (the current view).
      return definition(facade, { path: args.path, line: args.line, column: args.column });
    }
    // A change was dispatched — guard the call so it reflects it or fails resyncing (INV-SYNC-1).
    return await withSyncQuiescence(
      watcher,
      { withinMs: 20000 },
      () => definition(facade, { path: args.path, line: args.line, column: args.column }),
      (r) => r.isError === false && r.value.resolved === true,
    );
  } catch (error) {
    if (error && error.code === "resyncing") return { isError: true, code: "resyncing", message: error.message };
    throw error;
  } finally {
    await lease.release();
  }
}

const handle = await startDaemon({ socketPath, pools: [pool], shutdownOnSignals: [], onConnection: (socket) => {
  let buffer = "";
  socket.on("data", (chunk) => {
    buffer += chunk.toString("utf8");
    for (;;) {
      const idx = buffer.indexOf(NEWLINE);
      if (idx < 0) return;
      const line = buffer.slice(0, idx).trim();
      buffer = buffer.slice(idx + 1);
      if (!line) continue;
      let msg;
      try { msg = JSON.parse(line); } catch { continue; }
      void (async () => {
        try {
          if (msg.method === "initialize") {
            socket.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: { protocolVersion: "2024-11-05", capabilities: { tools: {} }, serverInfo: { name: "jdt-mcp", version: "0.0.0" } } }) + NEWLINE);
          } else if (msg.method === "tools/list") {
            socket.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: { tools: [{ name: "java_definition", description: "Resolve the declaration of a symbol", inputSchema: { type: "object", properties: { path: { type: "string" }, line: { type: "number" }, column: { type: "number" } } } }] } }) + NEWLINE);
          } else if (msg.method === "tools/call") {
            const result = await routeDefinition(msg.params.arguments ?? {});
            socket.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: { content: [{ type: "text", text: JSON.stringify(result) }], isError: result.isError === true } }) + NEWLINE);
          } else if (msg.id !== undefined && msg.method) {
            socket.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: {} }) + NEWLINE);
          }
        } catch (error) {
          socket.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: { content: [{ type: "text", text: JSON.stringify({ isError: true, code: "workspace-crashed", message: String(error) }) }], isError: true } }) + NEWLINE);
        }
      })();
    }
  });
} });
process.stderr.write("daemon-ready" + NEWLINE);
setInterval(() => {}, 1000);
`;
}

interface McpChild {
  child: ChildProcessWithoutNullStreams;
  stdout: string;
  stderr: string;
  write(line: string): void;
  kill(): void;
}

function spawnChild(args: string[]): McpChild {
  const child = spawn(process.execPath, ["--experimental-strip-types", ...args], { stdio: ["pipe", "pipe", "pipe"] });
  const state = { stdout: "", stderr: "" };
  child.stdout.on("data", (c) => (state.stdout += c.toString("utf8")));
  child.stderr.on("data", (c) => (state.stderr += c.toString("utf8")));
  return {
    child,
    get stdout() { return state.stdout; },
    get stderr() { return state.stderr; },
    write: (line) => child.stdin.write(line + "\n"),
    kill: () => child.kill("SIGKILL"),
  };
}

function waitFor(read: () => boolean, detail: string, timeoutMs = 30_000): Promise<void> {
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

/** A shim process: connects/spawns the daemon and bridges stdio <-> socket (MCP framing). */
function shimScript(socketPath: string): string {
  return `import { startShim } from ${JSON.stringify(SHIM_MODULE)};
const socketPath = ${JSON.stringify(socketPath)};
const NEWLINE = String.fromCharCode(10);
const shim = await startShim({ socketPath, shutdownOnSignals: [] });
process.stderr.write("shim-ready role=" + shim.role + NEWLINE);
await shim.done;
`;
}

test(
  "INV-SYNC-1/INV-ROUTE-1: the real shim-to-daemon-to-JDT-LS pipeline returns a routed, post-edit-or-resync answer",
  { timeout: 180_000 },
  async (t) => {
    const root = mkdtempSync(path.join(tmpdir(), "jdt-cross-"));
    t.after(() => rmSync(root, { recursive: true, force: true }));
    const socketPath = path.join(root, "jdt-mcp.sock");

    const projectRoot = path.join(root, "project");
    const greeterPath = path.join(projectRoot, "src/main/java/fixture/Greeter.java");
    const appPath = path.join(projectRoot, "src/main/java/fixture/App.java");
    mkdirSync(path.dirname(greeterPath), { recursive: true });
    writeFileSync(path.join(projectRoot, "pom.xml"), "<project><modelVersion>4.0.0</modelVersion><groupId>fixture</groupId><artifactId>cross</artifactId><version>1</version></project>\n");
    writeFileSync(greeterPath, GREETER_SOURCE, "utf8");
    writeFileSync(appPath, APP_SOURCE, "utf8");

    const daemonScriptPath = path.join(root, "daemon.mjs");
    writeFileSync(daemonScriptPath, daemonScript(socketPath, path.join(root, "cache")));
    process.env.JDTLS_HOME = JDTLS_FIXTURE_HOME;

    const daemon = spawnChild([daemonScriptPath]);
    t.after(() => daemon.kill());
    await waitFor(() => daemon.stderr.includes("daemon-ready"), "daemon ready");

    const shimScriptPath = path.join(root, "shim.mjs");
    writeFileSync(shimScriptPath, shimScript(socketPath));
    const shim = spawnChild([shimScriptPath]);
    t.after(() => shim.kill());
    await waitFor(() => /shim-ready/.test(shim.stderr), "shim ready");

    let nextId = 1;
    const call = (method: string, params: unknown): void => shim.write(JSON.stringify({ jsonrpc: "2.0", id: nextId++, method, params }));

    // Baseline: the definition resolves into Greeter.java (INV-ROUTE-1: correct workspace).
    const position = greetCallPosition();
    call("initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "test", version: "0" } });
    call("tools/call", { name: "java_definition", arguments: { path: appPath, line: position.line, column: position.column } });
    await waitFor(
      () => (shim.stdout.match(/"result"/g) ?? []).length >= 2,
      "baseline java_definition response",
    );
    const baselineText = shim.stdout.split("\n").map((l) => l.trim()).filter(Boolean)
      .map((l) => { try { return JSON.parse(l); } catch { return null; } })
      .find((m) => m && m.result && m.result.content)?.result.content[0]?.text;
    assert.ok(baselineText, `the pipeline must answer the baseline java_definition; stdout=${JSON.stringify(shim.stdout.slice(-500))}`);
    const baseline = JSON.parse(baselineText);
    assert.equal(baseline.isError, false, `baseline must resolve: ${baselineText}`);
    assert.ok(baseline.value?.resolved === true, `baseline must resolve into Greeter.java: ${baselineText}`);

    // Edit on disk, then call again through the same pipeline — post-edit-or-resync, never stale.
    // Give the daemon's watcher time to observe and dispatch the change (its generation advances).
    writeFileSync(greeterPath, GREETER_SOURCE.replace("greet(", "salute("), "utf8");
    await new Promise((resolve) => setTimeout(resolve, 500));
    call("tools/call", { name: "java_definition", arguments: { path: appPath, line: position.line, column: position.column } });
    await waitFor(
      () => (shim.stdout.match(/"result"/g) ?? []).length >= 3,
      "post-edit java_definition response",
    );
    const postEditText = shim.stdout.split("\n").map((l) => l.trim()).filter(Boolean)
      .map((l) => { try { return JSON.parse(l); } catch { return null; } })
      .filter((m) => m && m.result && m.result.content)
      .map((m) => m.result.content[0]?.text)
      .at(-1);
    assert.ok(postEditText, `the pipeline must answer the post-edit call; stdout=${JSON.stringify(shim.stdout.slice(-500))}`);
    const postEdit = JSON.parse(postEditText);
    const stale = postEdit.isError === false && postEdit.value?.resolved === true;
    assert.equal(stale, false, `the post-edit call must not answer from the pre-edit model; got: ${postEditText}`);
  },
);
