#!/usr/bin/env node
// Runtime-specific PreToolUse adapter calibration. It exercises both sides of guard-write's
// interface with the installed runtime/version recorded, so dispatch never trusts a generated hook
// merely because the file exists. This stores decisions and reasons only, never hook payload data.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";

const args = process.argv.slice(2);
const opt = (name, fallback) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : fallback; };
const root = path.resolve(opt("--target", process.cwd()));
const home = existsSync(path.join(root, "harness", "agents.manifest.json")) ? path.join(root, "harness") : root;
const requested = opt("--runtime", "all");
const runtimes = requested === "all" ? ["claude", "codex"] : requested.split(",").map((x) => x.trim()).filter(Boolean);
const quiet = args.includes("--quiet");
const guard = path.join(home, "tools", "guard-write.mjs");

if (!existsSync(guard)) {
  console.error(`hook calibration cannot find ${path.relative(root, guard)}`);
  process.exit(2);
}
if (runtimes.some((runtime) => !["claude", "codex"].includes(runtime))) {
  console.error(`unknown hook runtime: ${requested}`);
  process.exit(2);
}

function version(runtime) {
  const command = runtime === "codex" ? "codex" : "claude";
  const r = spawnSync(command, ["--version"], { cwd: root, encoding: "utf8" });
  return r.status === 0 ? String(r.stdout || r.stderr || "").trim() : "unavailable";
}

function runGuard(runtime, agent, input) {
  const r = spawnSync(process.execPath,
    [guard, "--runtime", runtime, agent],
    { cwd: root, encoding: "utf8", input: JSON.stringify(input) });
  if (r.status !== 0) return { error: `guard exited ${r.status}: ${String(r.stderr || "").trim()}` };
  try { return JSON.parse(r.stdout || "{}"); }
  catch (error) { return { error: `guard returned invalid JSON: ${error.message}` }; }
}

const results = runtimes.map((runtime) => {
  const allow = runGuard(runtime, "maker", { tool_name: "Bash", tool_input: { command: "pwd" } });
  const deny = runGuard(runtime, "checker", {
    tool_name: "apply_patch",
    tool_input: { command: "*** Begin Patch\n*** Add File: src/forbidden.txt\n+x\n*** End Patch" },
  });
  const allowDecision = allow?.hookSpecificOutput?.permissionDecision;
  const denyDecision = deny?.hookSpecificOutput?.permissionDecision;
  const denyReason = deny?.hookSpecificOutput?.permissionDecisionReason;
  const allowPass = runtime === "codex"
    ? !allow.error && allowDecision === undefined && allow?.hookSpecificOutput === undefined
    : allowDecision === "allow";
  const denyPass = denyDecision === "deny" && Boolean(String(denyReason || "").trim());
  return {
    runtime, runtimeVersion: version(runtime), adapter: allowPass && denyPass ? "pass" : "fail",
    allow: runtime === "codex" ? "neutral" : allowDecision || "invalid",
    deny: denyDecision || "invalid", reasonPresent: Boolean(String(denyReason || "").trim()),
    errors: [allow.error, deny.error].filter(Boolean),
  };
});

const report = { schema: "hook-capabilities/1", generatedAt: new Date().toISOString(), results };
mkdirSync(path.join(home, "trace"), { recursive: true });
writeFileSync(path.join(home, "trace", "hook-capabilities.json"), JSON.stringify(report, null, 2) + "\n");
if (!quiet) process.stdout.write(JSON.stringify(report, null, 2) + "\n");
if (results.some((result) => result.adapter !== "pass")) process.exit(1);
