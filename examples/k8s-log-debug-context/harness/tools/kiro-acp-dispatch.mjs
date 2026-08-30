#!/usr/bin/env node
// Drive one Kiro custom agent through Agent Client Protocol (ACP). The project loop is an ACP
// client, not an emulation of a terminal user: one process, one initialized session, one prompt.
import { spawn } from "node:child_process";
import readline from "node:readline";

const [agent, ...messageParts] = process.argv.slice(2);
const message = messageParts.join(" ");
if (!agent || !message) {
  console.error('usage: node harness/tools/kiro-acp-dispatch.mjs <agent> "<message>"');
  process.exit(2);
}

const timeoutMs = Number(process.env.HARNESS_ACP_TIMEOUT_MS || 30 * 60_000);
const child = spawn("kiro-cli", ["acp", "--agent", agent, "--trust-all-tools"], {
  cwd: process.cwd(), env: process.env, stdio: ["pipe", "pipe", "pipe"],
});
let nextId = 0;
let stderr = "";
let settled = false;
const pending = new Map();

function send(frame) {
  child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", ...frame })}\n`);
}

function request(method, params) {
  const id = nextId++;
  send({ id, method, params });
  return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
}

function fail(error) {
  if (settled) return;
  settled = true;
  clearTimeout(timer);
  for (const { reject } of pending.values()) reject(error);
  pending.clear();
  console.error(error instanceof Error ? error.message : String(error));
  child.kill();
  process.exitCode = 1;
}

function renderUpdate(params) {
  const update = params?.update || params;
  if (!update || update.sessionUpdate !== "agent_message_chunk") return;
  const text = update.content?.text || update.text;
  if (text) process.stdout.write(String(text));
}

const lines = readline.createInterface({ input: child.stdout });
lines.on("line", (line) => {
  let frame;
  try { frame = JSON.parse(line); }
  catch { fail(new Error(`ACP protocol error: non-JSON stdout from kiro-cli: ${line.slice(0, 200)}`)); return; }
  if (frame.id !== undefined && (frame.result !== undefined || frame.error !== undefined)) {
    const waiter = pending.get(frame.id);
    if (!waiter) return;
    pending.delete(frame.id);
    if (frame.error) waiter.reject(new Error(`ACP ${frame.error.code ?? "error"}: ${frame.error.message || JSON.stringify(frame.error)}`));
    else waiter.resolve(frame.result || {});
    return;
  }
  if (frame.method === "session/update" || frame.method === "session/notification") {
    renderUpdate(frame.params);
    return;
  }
  // --trust-all-tools keeps tool execution inside Kiro. Fail closed if a future backend asks this
  // minimal client to provide an editor-side capability it did not advertise during initialize.
  if (frame.id !== undefined && frame.method) {
    send({ id: frame.id, error: { code: -32601, message: `client method not supported: ${frame.method}` } });
  }
});

child.stderr.on("data", (chunk) => { stderr += chunk; process.stderr.write(chunk); });
child.on("error", (error) => fail(error));
child.on("close", (code, signal) => {
  if (settled) return;
  fail(new Error(`kiro ACP process exited before the turn completed (${code ?? signal})${stderr ? `: ${stderr.trim().slice(-500)}` : ""}`));
});

const timer = setTimeout(() => fail(new Error(`kiro ACP turn timed out after ${timeoutMs}ms`)), timeoutMs);

try {
  await request("initialize", {
    clientName: "harness-loop", clientVersion: "1", protocolVersion: "2025-08-22",
    clientCapabilities: {
      fs: { readTextFile: false, writeTextFile: false }, terminal: false,
    },
  });
  const session = await request("session/new", { cwd: process.cwd(), mcpServers: [] });
  if (!session.sessionId) throw new Error("ACP session/new returned no sessionId");
  const result = await request("session/prompt", {
    sessionId: session.sessionId, prompt: [{ type: "text", text: message }],
  });
  const stopReason = result.stopReason || "end_turn";
  if (stopReason !== "end_turn") throw new Error(`kiro ACP turn stopped: ${stopReason}`);
  settled = true;
  clearTimeout(timer);
  child.stdin.end();
  child.kill();
  process.exitCode = 0;
} catch (error) {
  fail(error);
}
