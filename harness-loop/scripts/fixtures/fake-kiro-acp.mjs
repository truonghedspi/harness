#!/usr/bin/env node
// Demo-only ACP backend. It proves the client wire contract without spending a model turn.
import { appendFileSync } from "node:fs";
import readline from "node:readline";

if (process.env.HARNESS_FAKE_RUNTIME_LOG) {
  appendFileSync(process.env.HARNESS_FAKE_RUNTIME_LOG, `${process.argv.slice(2).join(" ")}\n`);
}
if (process.env.HARNESS_FAKE_RUNTIME_OUTPUT) {
  console.error(process.env.HARNESS_FAKE_RUNTIME_OUTPUT);
  process.exit(0);
}
const lines = readline.createInterface({ input: process.stdin });
lines.on("line", (line) => {
  const request = JSON.parse(line);
  if (request.method === "initialize") {
    process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id: request.id, result: {
      protocolVersion: "2025-08-22", agentCapabilities: {}, agentInfo: { name: "fake-kiro" },
    } })}\n`);
  } else if (request.method === "session/new") {
    process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id: request.id, result: { sessionId: "demo-session" } })}\n`);
  } else if (request.method === "session/prompt") {
    process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", method: "session/update", params: {
      sessionId: "demo-session", update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "[stub]" } },
    } })}\n`);
    process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id: request.id, result: { stopReason: "end_turn" } })}\n`);
  }
});
