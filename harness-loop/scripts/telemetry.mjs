#!/usr/bin/env node
// Redacted runtime-neutral tool telemetry. Never append raw hook input or tool responses.
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";

const args = process.argv.slice(2);
const opt = (name, fallback = null) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : fallback; };
const root = path.resolve(opt("--target", process.cwd()));
const home = existsSync(path.join(root, "harness", "feature_list.json")) ? path.join(root, "harness") : root;
const runtime = opt("--runtime", "unknown");
const actor = opt("--actor", process.env.HARNESS_AGENT || "unknown");
const maxEvents = 20_000;
const output = path.join(home, "trace", "tool-events.jsonl");
const hash = (value) => createHash("sha256").update(`${root}\0${String(value || "")}`).digest("hex");
const readJSON = (p) => { try { return JSON.parse(readFileSync(p, "utf8")); } catch { return null; } };
const payload = (() => { try { return JSON.parse(readFileSync(0, "utf8") || "{}"); } catch { return {}; } })();
const current = readJSON(path.join(home, "loop", "current.json")) || {};

function relative(input) {
  if (!input || typeof input !== "string") return null;
  const abs = path.resolve(root, input);
  const rel = path.relative(root, abs);
  if (rel === "" || (!rel.startsWith(".." + path.sep) && rel !== ".." && !path.isAbsolute(rel))) return rel || ".";
  return `external:${path.basename(abs)}`;
}

const rawName = String(payload.tool_name || payload.toolName || payload.name || payload.tool || "unknown");
const name = rawName.toLowerCase();
const input = payload.tool_input || payload.toolInput || payload.input || {};
const operations = Array.isArray(input.operations) ? input.operations : [input];
const records = [];
for (const operation of operations) {
  const isRead = /^(read|fs_read)$/.test(name);
  const isGrep = /grep|search/.test(name);
  const isGlob = /glob/.test(name);
  const isShell = /bash|shell|execute_bash|command_execution/.test(name);
  if (!isRead && !isGrep && !isGlob && !isShell) continue;
  const className = isRead ? "file-read" : isGrep ? "search" : isGlob ? "glob" : "shell";
  const candidatePath = operation.file_path || operation.path || operation.directory || operation.cwd || null;
  const query = isGrep ? operation.pattern || operation.query : isGlob ? operation.pattern || operation.glob : null;
  records.push({
    schema: "tool-event/1", ts: new Date().toISOString(),
    runId: process.env.HARNESS_RUN_ID || null,
    sessionIdHash: hash(payload.session_id || payload.sessionId || payload.conversation_id || "unknown"),
    actor, feature: process.env.HARNESS_FEATURE || current.feature || null,
    runtime, runtimeVersion: process.env.HARNESS_RUNTIME_VERSION || null,
    phase: "completed", tool: isRead ? "read" : isGrep ? "grep" : isGlob ? "glob" : "shell",
    class: className, path: relative(candidatePath), queryHash: query ? hash(String(query).trim().replace(/\s+/g, " ")) : null,
    scope: operation.glob || operation.pattern ? (candidatePath ? "path" : "repository") : candidatePath ? "file" : null,
    success: payload.error == null && payload.is_error !== true,
    durationMs: Number.isFinite(payload.duration_ms) ? payload.duration_ms : null,
    observation: isShell ? "inferred-shell" : "direct",
    coverage: runtime === "codex" ? "shell-incomplete" : "native-configured",
  });
}

if (records.length) {
  mkdirSync(path.dirname(output), { recursive: true });
  let count = 0;
  try { count = readFileSync(output, "utf8").split("\n").filter(Boolean).length; } catch {}
  if (count < maxEvents) {
    for (const record of records.slice(0, maxEvents - count)) {
      const line = JSON.stringify(record);
      appendFileSync(output, line.length <= 2048 ? line + "\n" : JSON.stringify({ ...record, path: null, queryHash: null }) + "\n");
    }
  } else if (!existsSync(output + ".truncated")) {
    appendFileSync(output, JSON.stringify({ schema: "tool-event/1", ts: new Date().toISOString(),
      actor, runtime, class: "telemetry-truncated", success: false }) + "\n");
    appendFileSync(output + ".truncated", "1\n");
  }
}
