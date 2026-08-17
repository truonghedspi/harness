#!/usr/bin/env node
// Stable interface for a contained harness; callers do not need to know its internal tree.
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const home = path.basename(scriptDir) === "scripts" ? path.resolve(scriptDir, "..") : scriptDir;
const project = path.basename(home) === "harness" ? path.dirname(home) : home;
const [command = "status", ...args] = process.argv.slice(2);
const entries = {
  status: [path.join(home, "tools", "harness-status.mjs"), ["--target", project]],
  verify: [path.join(home, "tools", "verify-harness.mjs"), ["--target", home]],
  coverage: [path.join(home, "check-coverage.mjs"), ["--target", home]],
  route: [path.join(home, "loop", "route.mjs"), []],
  run: [path.join(home, "loop", "run-loop.mjs"), []],
  init: [path.join(home, "init.mjs"), []],
  env: [path.join(home, "tools", "environment.mjs"), []],
};
if (!entries[command]) {
  console.error("usage: node harness/cli.mjs <status|env|init|coverage|verify|route|run> [args]");
  process.exit(2);
}
const [script, baseArgs] = entries[command];
const result = spawnSync(process.execPath, [script, ...baseArgs, ...args], { cwd: project, stdio: "inherit" });
if (result.error) { console.error(result.error.message); process.exit(1); }
process.exit(result.status ?? 1);
