#!/usr/bin/env node
// Fixture-calibrate the normalizer and publish configured coverage. Live runtime coverage remains
// explicit: Codex is shell-incomplete until its native hooks expose read/search tool calls.
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";

const args = process.argv.slice(2);
const opt = (n, d = null) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const root = path.resolve(opt("--target", process.cwd()));
const runtime = opt("--runtime", "all");
const script = path.join(root, "tools", "telemetry.mjs");
const wanted = runtime === "all" ? ["claude", "kiro", "codex"] : [runtime];
const scratch = mkdtempSync(path.join(tmpdir(), "harness-telemetry-"));
const results = [];
try {
  mkdirSync(path.join(scratch, "tools"), { recursive: true });
  writeFileSync(path.join(scratch, "fixture.txt"), "needle\n");
  for (const rt of wanted) {
    for (const payload of [
      { tool_name: rt === "kiro" ? "fs_read" : "Read", tool_input: { file_path: "fixture.txt" } },
      { tool_name: "Grep", tool_input: { path: ".", pattern: "needle" } },
      { tool_name: "Glob", tool_input: { path: ".", pattern: "*.txt" } },
      { tool_name: rt === "kiro" ? "execute_bash" : "Bash", tool_input: { command: "sed fixture.txt" } },
    ]) spawnSync(process.execPath, [script, "--target", scratch, "--runtime", rt, "--actor", "calibration"],
      { input: JSON.stringify(payload), encoding: "utf8" });
    const events = readFileSync(path.join(scratch, "trace", "tool-events.jsonl"), "utf8").split("\n")
      .filter(Boolean).map(JSON.parse).filter((e) => e.runtime === rt);
    results.push({ runtime: rt, adapter: events.length === 4 ? "pass" : "fail",
      observed: [...new Set(events.map((e) => e.class))],
      coverage: rt === "codex" ? "shell-incomplete" : "native-configured-needs-live-probe" });
  }
} finally { rmSync(scratch, { recursive: true, force: true }); }
mkdirSync(path.join(root, "trace"), { recursive: true });
writeFileSync(path.join(root, "trace", "telemetry-capabilities.json"), JSON.stringify({
  schema: "telemetry-capabilities/1", generatedAt: new Date().toISOString(), results }, null, 2) + "\n");
process.stdout.write(JSON.stringify({ results }) + "\n");
process.exit(results.every((r) => r.adapter === "pass") ? 0 : 1);
