#!/usr/bin/env node
// init.mjs — the baseline gate. Run at the start AND end of every session (Lesson 6/9/12).
// Green = the standard startup path works and verification passes. A loop must never run on red.
//
// This is the IMPLEMENTATION. `./init.sh` and `init.cmd` are one-line wrappers around it, so the
// same gate runs on macOS, Linux, Git Bash, WSL, cmd.exe and PowerShell. It is Node rather than a
// shell script plus a PowerShell twin for two reasons: node is already a hard dependency of every
// other tool in this harness (tools/*.mjs), and two hand-maintained implementations of the same
// gate would drift — silently, in the direction of the one nobody runs.
//
// Windows specifics handled below, each of which breaks a naive port:
//   * package-manager binaries are `npm.cmd` / `pnpm.cmd` shims, not executables → shell: true
//   * the Maven and Gradle wrappers are `mvnw.cmd` / `gradlew.bat`, not `./mvnw` / `./gradlew`
//   * there is no exec bit, so "is init.sh chmod +x" is not a meaningful check there
//   * `python3` usually does not exist; `python` does
import { existsSync, readdirSync, mkdirSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
process.chdir(ROOT);
const IS_WIN = process.platform === "win32";

const say = (m) => console.log(m);
const die = (m) => { console.error(m); process.exit(1); };
const has = (f) => existsSync(path.join(ROOT, f));

// Every verification command goes through here, and a non-zero exit STOPS the run.
//
// The bash version this replaces wrote `has check && { run check; } || true` — intended as "skip a
// script that does not exist", but `|| true` cannot tell that apart from "the script ran and
// failed". A project with a failing test suite printed "Baseline green" and exited 0. A gate that
// cannot go red is not a gate, so the two cases are separate here: `optional` decides whether to
// RUN a step, never whether to accept its failure.
function run(cmd, { label = null, okExitCodes = [0] } = {}) {
  if (label) say(`=== ${label} ===`);
  const r = spawnSync(cmd, { stdio: "inherit", shell: true, cwd: ROOT });
  if (r.error) die(`init: could not run \`${cmd}\` — ${r.error.message}`);
  const code = r.status === null ? 1 : r.status;
  if (!okExitCodes.includes(code)) {
    die(`\ninit: \`${cmd}\` failed with exit code ${code}. Baseline is RED — fix this before the loop runs.`);
  }
  return code;
}
// Is a command available at all? `command -v` does not exist on cmd.exe.
const available = (bin) =>
  spawnSync(IS_WIN ? "where" : "command", IS_WIN ? [bin] : ["-v", bin],
    { stdio: "ignore", shell: !IS_WIN }).status === 0;

say(`=== Harness init: Harness ===`);

// Observability (Lesson 11): ensure the trace sink exists and record this run.
mkdirSync(path.join(ROOT, "trace"), { recursive: true });
if (has("tools/trace.mjs")) {
  spawnSync(process.execPath, ["tools/trace.mjs", "init", "session-start", "init.mjs"],
    { stdio: "ignore", cwd: ROOT });
}

// Keep the always-loaded feature digest in step with the source of truth (docs/reference/
// llm-failure-modes.md: the full list dominates every agent's context, the digest is what they read).
if (has("tools/feature-digest.mjs")) {
  spawnSync(process.execPath, ["tools/feature-digest.mjs", "--target", "."], { stdio: "ignore", cwd: ROOT });
}

// >>> VERIFICATION  (custom, provided at setup)
say("=== Custom verification ===");
run("bash harness-loop/scripts/demo.sh");
// <<< VERIFICATION

say("=== Baseline green ===");
say("");
say("Next: read feature_list.json, pick ONE eligible feature, advance it, re-verify before 'done'.");
