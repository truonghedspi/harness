#!/usr/bin/env node
// Run one named agent through the installed runtime. This is the implementation on every platform;
// dispatch.sh and dispatch.cmd are compatibility wrappers and contain no control logic.
import { spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
// A directory literally named "harness" is not proof of a contained layout (the harness-loop
// skill's own repo is named "harness" and is flat) — only the thin root AGENTS.md a contained
// scaffold writes is (HI-055). Require both.
const PROJECT_ROOT = path.basename(ROOT) === "harness" && existsSync(path.join(path.dirname(ROOT), "AGENTS.md"))
  ? path.dirname(ROOT) : ROOT;
const IS_WIN = process.platform === "win32";
const QUOTA = /monthly request limit reached|rate limit exceeded|quota exceeded|usage limit reached|temporarily unavailable/i;

function commandRuns(command, args = ["--version"]) {
  const result = spawnSync(command, args, { cwd: PROJECT_ROOT, stdio: "ignore", shell: IS_WIN });
  return !result.error && result.status === 0;
}

export function selectRuntime(forced = process.env.HARNESS_RUNTIME || "") {
  if (forced && !["kiro", "claude", "codex"].includes(forced)) {
    throw new Error(`unknown HARNESS_RUNTIME=${forced} (expected kiro, claude or codex)`);
  }
  if (forced) return forced;
  if (existsSync(path.join(PROJECT_ROOT, ".kiro", "agents")) && commandRuns("kiro-cli")) return "kiro";
  if (existsSync(path.join(PROJECT_ROOT, ".claude", "agents")) && commandRuns("claude")) return "claude";
  if (existsSync(path.join(PROJECT_ROOT, ".codex", "agents")) && commandRuns("codex")) return "codex";
  throw new Error("no runtime — install kiro-cli, claude or codex, with the matching agents directory");
}

function checkRuntime(runtime) {
  if (runtime === "kiro" && !process.env.KIRO_API_KEY && !commandRuns("kiro-cli", ["whoami"])) {
    throw new Error("no auth — set KIRO_API_KEY or log in first (kiro-cli login)");
  }
  if (runtime === "claude" && !existsSync(path.join(PROJECT_ROOT, ".claude", "agents"))) {
    throw new Error("runtime=claude but .claude/agents/ is missing");
  }
  if (runtime === "codex") {
    if (!existsSync(path.join(PROJECT_ROOT, ".codex", "hooks.json"))) {
      throw new Error("runtime=codex but .codex/hooks.json is missing — write restrictions would not be enforced");
    }
    if (!commandRuns("codex", ["login", "status"])) throw new Error("codex is not logged in (codex login)");
  }
}

function invocation(runtime, agent, message) {
  if (runtime === "kiro") return ["kiro-cli", ["chat", "--agent", agent, "--no-interactive", "--trust-all-tools", message]];
  if (runtime === "claude") return ["claude", ["-p", message, "--agent", agent, "--dangerously-skip-permissions"]];
  return [process.execPath, [path.join(ROOT, "tools", "codex-dispatch.mjs"), agent, message]];
}

export async function dispatch(agent, message, { runtime = selectRuntime() } = {}) {
  checkRuntime(runtime);
  const [command, args] = invocation(runtime, agent, message);
  return await new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: PROJECT_ROOT, env: { ...process.env, HARNESS_AGENT: agent }, shell: IS_WIN,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    for (const [stream, sink] of [[child.stdout, process.stdout], [child.stderr, process.stderr]]) {
      stream.on("data", (chunk) => { output += chunk; sink.write(chunk); });
    }
    child.on("error", reject);
    child.on("close", (code, signal) => {
      if (QUOTA.test(output)) {
        console.error("runtime refused the dispatch despite its process status; no agent work is accepted");
        return resolve(75);
      }
      resolve(code ?? (signal ? 1 : 0));
    });
  });
}

function agentExists(agent) {
  const manifest = JSON.parse(readFileSync(path.join(ROOT, "agents.manifest.json"), "utf8"));
  return (manifest.agents || []).some((item) => item.name === agent);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [agent, ...messageParts] = process.argv.slice(2);
  if (!agent || !messageParts.length) {
    console.error("usage: node loop/dispatch.mjs <agent> \"<message>\"");
    process.exit(2);
  }
  if (!agentExists(agent)) {
    console.error(`no agent "${agent}" in agents.manifest.json`);
    process.exit(2);
  }
  try {
    const runtime = selectRuntime();
    console.log(`runtime: ${runtime} — dispatching ${agent}`);
    process.exitCode = await dispatch(agent, messageParts.join(" "), { runtime });
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
