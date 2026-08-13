#!/usr/bin/env node
// codex-dispatch.mjs — run one harness role headlessly on Codex CLI.
//
// kiro has `kiro-cli chat --agent <name>` and Claude Code has `claude -p ... --agent <name>`.
// `codex exec` has NO --agent flag (verified on codex 0.147.0: the flag does not exist), so a role
// cannot be selected — it has to be *assembled* at dispatch. That is what this script is.
//
// Three things it assembles, each closing a gap that would otherwise be silent:
//
//   1. The system prompt. `.codex/agents/<name>.toml` is generated for interactive use, but nothing
//      headless can load it, so the prompt body goes in on stdin. Instructions are read from stdin
//      when the prompt argument is `-`, which also avoids TOML-escaping a whole markdown file
//      through `-c developer_instructions=...` and avoids the argv length limit.
//   2. The role's context. Rather than reimplementing the resource list, this calls
//      tools/agent-context.mjs — the same script Claude Code's SubagentStart hook calls — so both
//      runtimes are guaranteed to load exactly the same files. Two implementations of "what does
//      this role get to see" is two things to drift.
//   3. The role's identity, as HARNESS_AGENT. Codex hooks are project-wide, so tools/guard-write.mjs
//      has no other way to know which agent's `writes` list to enforce. Verified that env vars
//      propagate from the codex process into hook subprocesses.
//
// Usage: node tools/codex-dispatch.mjs <agent-name> "<message>"
import { readFileSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";

const [name, message] = process.argv.slice(2);
if (!name || !message) {
  console.error("usage: codex-dispatch.mjs <agent-name> \"<message>\"");
  process.exit(2);
}
const root = process.cwd();
const P = (...p) => path.join(root, ...p);

if (!spawnSync("codex", ["--version"], { encoding: "utf8" }).stdout) {
  console.error("codex CLI not found on PATH. Install it, or set HARNESS_RUNTIME to kiro or claude.");
  process.exit(2);
}

let manifest;
try { manifest = JSON.parse(readFileSync(P("agents.manifest.json"), "utf8")); }
catch (e) { console.error(`cannot read agents.manifest.json: ${e.message}`); process.exit(2); }
const agent = (manifest.agents || []).find((a) => a.name === name);
if (!agent) { console.error(`no agent "${name}" in agents.manifest.json`); process.exit(2); }

const promptBody = existsSync(P(agent.prompt)) ? readFileSync(P(agent.prompt), "utf8") : null;
if (promptBody === null) {
  // The kiro equivalent of this failure is silent: a bad file:// URI just starts the unrestricted
  // default agent (HI-005). Here it is fatal, because a role without its prompt is not that role.
  console.error(`prompt file missing for "${name}": ${agent.prompt}`);
  process.exit(2);
}

// Same context Claude Code injects, from the same script.
let context = "";
const ctx = spawnSync(process.execPath, [P("tools", "agent-context.mjs"), name], { encoding: "utf8", input: "{}" });
try { context = JSON.parse(ctx.stdout).hookSpecificOutput.additionalContext || ""; }
catch { context = `[harness] tools/agent-context.mjs produced no context for "${name}" — this role is running without its resource list. Report it rather than working around it.`; }

const composed = [
  promptBody.trimEnd(),
  "",
  "---",
  "",
  context.trimEnd(),
  "",
  "---",
  "",
  message,
].join("\n");

const canWrite = agent.tools.includes("write") || agent.tools.includes("*");
const args = ["exec", "-", "--sandbox", canWrite ? "workspace-write" : "read-only"];
if (agent.model && agent.model.codex) args.push("-m", agent.model.codex);
if (agent.codexReasoningEffort) args.push("-c", `model_reasoning_effort="${agent.codexReasoningEffort}"`);

// Codex requires hooks to be trusted, and an UNTRUSTED hook is skipped silently — no error, no
// warning, writes simply unguarded (verified on 0.147.0). For a write-restricted role that means
// the confinement quietly disappears, which is worse than not having it, so the flag is passed by
// default. Set HARNESS_CODEX_HOOK_TRUSTED=1 once you have trusted the hooks interactively.
if (process.env.HARNESS_CODEX_HOOK_TRUSTED !== "1") args.push("--dangerously-bypass-hook-trust");

if (agent.writes && !existsSync(P(".codex", "hooks.json"))) {
  console.error(`WARNING: ${name} is write-restricted in agents.manifest.json but .codex/hooks.json is`);
  console.error(`missing, so nothing will enforce it. Run: node tools/gen-agents.mjs --target . --runtime codex`);
}

const r = spawnSync("codex", args, { input: composed, stdio: ["pipe", "inherit", "inherit"], env: { ...process.env, HARNESS_AGENT: name } });
process.exit(r.status === null ? 1 : r.status);
