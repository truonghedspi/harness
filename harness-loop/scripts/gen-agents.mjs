#!/usr/bin/env node
// gen-agents.mjs — one manifest, two runtimes.
//
// The harness targets kiro-cli and Claude Code. Their agent configs express the same five things
// in different shapes, and hand-maintaining both guarantees drift — the kind that is invisible,
// because a misconfigured agent still runs, just not as the agent you configured (HI-005).
// So `agents.manifest.json` is the source and both formats are generated from it.
//
//   concept          kiro                                  Claude Code
//   ---------------  ------------------------------------  ----------------------------------------
//   system prompt    prompt: file://../../<path>            the .md body (inlined at generation)
//   auto-loaded      resources: [file://…]                  SubagentStart hook -> additionalContext
//     context                                               (computed at spawn, so never stale)
//   write limits     toolsSettings.write.allowedPaths       PreToolUse hook -> permissionDecision:deny
//   lifecycle        hooks.agentSpawn / stop                hooks.SubagentStart / Stop (frontmatter,
//                                                           scoped to that subagent)
//   MCP              includeMcpJson (all or nothing)        mcpServers (per server) — left to settings
//
// Claude Code has no per-agent path-permission field, and an `Edit(...)` rule in settings.json is
// session-wide, so the PreToolUse hook is the ONLY way to give one agent a narrower write surface
// than another. That matters here: the checker being unable to write source is what makes
// "the maker never grades itself" a property of the configuration rather than a line in a prompt.
//
// Usage: node gen-agents.mjs --target DIR [--runtime kiro|claude|both] [--check]
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, rmSync } from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
const opt = (n, d = null) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const TARGET = path.resolve(opt("--target", "."));
const RUNTIME = opt("--runtime", "both");
const CHECK = args.includes("--check");
const P = (...p) => path.join(TARGET, ...p);
const read = (p) => { try { return readFileSync(p, "utf8"); } catch { return null; } };

const manifest = JSON.parse(readFileSync(P("agents.manifest.json"), "utf8"));
const agents = manifest.agents.filter((a) => !a.optional || existsSync(P(a.prompt)));

const GEN_HEADER = (src) =>
  `<!-- GENERATED from agents.manifest.json + ${src} by tools/gen-agents.mjs. Do not hand-edit:\n` +
  `     your change is lost on the next generation, and the two runtimes silently diverge. -->\n`;

// --- kiro ----------------------------------------------------------------------------------------
// file:// URIs resolve relative to .kiro/agents/, not the repo root. Getting this wrong does not
// error — the agent starts without its prompt, as the unrestricted default (HI-005).
function kiroAgent(a) {
  const uri = (p) => `file://../../${p}`;
  const j = {
    name: a.name, description: a.description, prompt: uri(a.prompt),
    tools: a.tools, allowedTools: ["read"], includeMcpJson: !!a.mcp,
  };
  // Executors run on the runtime default; evaluators get the strongest model the runtime offers,
  // because catching what a cheaper model got wrong is the entire job (Lesson 9/13). Note kiro has
  // no Opus on this account — `kiro-cli chat --list-models` tops out at claude-sonnet-4.5 — so the
  // manifest names that for kiro evaluators rather than pretending the runtimes are equal.
  if (a.model && a.model.kiro) j.model = a.model.kiro;
  if (a.writes) j.toolsSettings = { write: { allowedPaths: a.writes } };
  j.resources = a.resources.map(uri);
  const hooks = {};
  if (a.trace || a.spawnCommands) {
    hooks.agentSpawn = [
      ...(a.trace ? [{ command: `node tools/trace.mjs ${a.name} session-start` }] : []),
      ...(a.spawnCommands || []).map((command) => ({ command })),
    ];
  }
  if (a.traceToolUse && a.traceToolUse.length) {
    hooks.postToolUse = a.traceToolUse.map((matcher) => ({
      matcher,
      command: `node tools/trace.mjs ${a.name} tool-use ${matcher === "execute_bash" ? "shell" : "write"}`,
    }));
  }
  if (a.trace) hooks.stop = [{ command: `node tools/trace.mjs ${a.name} session-end` }];
  if (Object.keys(hooks).length) j.hooks = hooks;
  if (a.welcomeMessage) j.welcomeMessage = a.welcomeMessage;
  return JSON.stringify(j, null, 2) + "\n";
}

// --- Claude Code ------------------------------------------------------------------------------
function claudeAgent(a) {
  const hooks = [];
  // Injects this agent's resources at spawn. The kiro equivalent is a static list; here it is
  // computed each run, which is strictly better — a stale resource list cannot happen.
  if (a.resources.length) {
    hooks.push(`  SubagentStart:\n    - command: "node tools/agent-context.mjs ${a.name}"`);
  }
  // The only per-agent write restriction Claude Code can express.
  if (a.writes) {
    hooks.push(`  PreToolUse:\n    - matcher: "Edit|Write|NotebookEdit"\n      command: "node tools/guard-write.mjs ${a.name}"`);
  }
  if (a.trace) {
    hooks.push(`  SubagentStop:\n    - command: "node tools/trace.mjs ${a.name} session-end"`);
  }
  const body = read(P(a.prompt));
  if (body === null) return null;
  // Claude Code has no welcomeMessage field. The text exists so a human knows what this role can
  // do before spending a turn on it, so it goes at the top of the system prompt instead of being
  // dropped — losing it would make the two runtimes behave differently for the same manifest.
  const welcome = a.welcomeMessage ? `> **What this role does:** ${a.welcomeMessage}\n\n` : "";
  const fm = [
    "---",
    `name: ${a.name}`,
    `description: ${JSON.stringify(a.description)}`,
    // kiro's tool names are lowercase and coarse; Claude's are capitalised tool names.
    `tools: ${a.tools.includes("*") || a.tools.includes("shell") ? "Read, Write, Edit, Bash, Grep, Glob, WebFetch" : "Read, Grep, Glob, Bash"}`,
    // Executors run cheap; evaluators get the strongest model available, because catching what a
    // cheaper model got wrong is the entire job (Lesson 9/13). Omitted = inherit the session model.
    a.model && a.model.claude ? `model: ${a.model.claude}` : null,
    hooks.length ? "hooks:\n" + hooks.join("\n") : null,
    "---",
  ].filter((l) => l !== null).join("\n");
  return `${fm}\n\n${GEN_HEADER(a.prompt)}\n${welcome}${body}`;
}

// --- emit ------------------------------------------------------------------------------------------
const wanted = new Map();
if (RUNTIME === "kiro" || RUNTIME === "both") {
  for (const a of agents) wanted.set(path.join(".kiro", "agents", `${a.name}.json`), kiroAgent(a));
}
if (RUNTIME === "claude" || RUNTIME === "both") {
  for (const a of agents) {
    const c = claudeAgent(a);
    if (c) wanted.set(path.join(".claude", "agents", `${a.name}.md`), c);
  }
}

if (CHECK) {
  const stale = [...wanted.entries()].filter(([rel, content]) => read(P(rel)) !== content);
  if (stale.length) {
    console.error(`${stale.length} generated agent file(s) differ from agents.manifest.json:`);
    for (const [rel] of stale) console.error(`  ${rel}`);
    console.error(`Regenerate: node tools/gen-agents.mjs --target . --runtime ${RUNTIME}`);
    process.exit(1);
  }
  console.log(`${wanted.size} generated agent file(s) match the manifest.`);
  process.exit(0);
}

// Remove generated files for agents the manifest no longer declares — an agent that keeps running
// after being deleted from the source is the same class of defect as one nobody routes to.
const declared = new Set(agents.map((a) => a.name));
for (const [dir, ext] of [[path.join(".kiro", "agents"), ".json"], [path.join(".claude", "agents"), ".md"]]) {
  if (!existsSync(P(dir))) continue;
  for (const f of readdirSync(P(dir))) {
    if (!f.endsWith(ext)) continue;
    const name = f.slice(0, -ext.length);
    // never touch an agent the manifest does not own (harness-onboarder, a user's own agents)
    if (!declared.has(name) || wanted.has(path.join(dir, f))) continue;
    rmSync(P(dir, f)); console.log(`  - ${path.join(dir, f)} (no longer in the manifest)`);
  }
}

// Idempotent: an unchanged file is not rewritten. Generation runs on every setup, and a scaffolder
// that reports writes it did not need breaks the "re-run changes nothing" contract the whole
// no-silent-overwrite guarantee rests on.
const written = [];
for (const [rel, content] of wanted) {
  if (read(P(rel)) === content) continue;
  mkdirSync(path.dirname(P(rel)), { recursive: true });
  writeFileSync(P(rel), content);
  written.push(rel);
}
if (written.length) {
  console.log(`Generated ${written.length} agent file(s) for runtime "${RUNTIME}" from agents.manifest.json`);
  for (const w of written) console.log(`  + ${w}`);
} else {
  console.log(`${wanted.size} agent file(s) already match agents.manifest.json — nothing rewritten.`);
}
