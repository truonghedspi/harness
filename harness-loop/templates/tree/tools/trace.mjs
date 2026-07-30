#!/usr/bin/env node
// trace.mjs — append one structured event to trace/trace.jsonl (observability, Lesson 11).
// Usage:  node tools/trace.mjs <actor> <event> [feature] [detail]
//         echo '<hook payload>' | node tools/trace.mjs <actor> <event>   (raw captured)
// Events are append-only and git-tracked: the loop's decision path is replayable, so retries
// and handoffs don't start blind. The harness records this — not the agent's own prints.
import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const traceDir = path.join(root, "trace");
mkdirSync(traceDir, { recursive: true });

const [actor = "unknown", event = "unknown", feature = "", detail = ""] = process.argv.slice(2);

let raw = "";
if (!process.stdin.isTTY) {
  try { raw = readFileSync(0, "utf8").trim(); } catch { /* no stdin */ }
}

const entry = {
  ts: new Date().toISOString(),
  actor,
  event,
  ...(feature && { feature }),
  ...(detail && { detail }),
  ...(raw && { raw: raw.slice(0, 2000) }),
  cwd: process.cwd(),
  pid: process.pid,
};

appendFileSync(path.join(traceDir, "trace.jsonl"), JSON.stringify(entry) + "\n");
