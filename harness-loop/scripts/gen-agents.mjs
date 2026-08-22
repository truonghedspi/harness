#!/usr/bin/env node
// gen-agents.mjs — one manifest, three runtimes.
//
// The harness targets kiro-cli, Claude Code and Codex CLI. Their agent configs express the same
// five things in different shapes, and hand-maintaining them guarantees drift — the kind that is
// invisible, because a misconfigured agent still runs, just not as the agent you configured
// (HI-005). So `agents.manifest.json` is the source and every format is generated from it.
//
//   concept        kiro                              Claude Code                  Codex CLI
//   -------------  --------------------------------  ---------------------------  ----------------------------
//   system prompt  prompt: file://../../<path>       the .md body (inlined)       developer_instructions (inlined)
//   auto-loaded    resources: [file://…]             SubagentStart -> additional  listed in the instructions;
//     context                                        Context (computed at spawn)  inlined by codex-dispatch.mjs
//   write limits   toolsSettings.write.allowedPaths  PreToolUse -> deny, declared PreToolUse in .codex/hooks.json,
//                                                    per-agent in frontmatter     PROJECT-wide + HARNESS_AGENT
//   lifecycle      hooks.agentSpawn / stop           hooks.SubagentStart / Stop   hooks.SessionStart / Stop
//   MCP            includeMcpJson (all or nothing)   mcpServers (per server)      [mcp_servers.x] in config.toml
//
// The Codex column is where the shapes genuinely stop matching, and all three differences were
// established by running codex 0.147.0, not by reading its documentation:
//
//   1. Agent TOML has NO hooks field, so per-agent write confinement cannot be expressed there.
//      Hooks are project-wide, so the hook must be told which role is running. Verified that env
//      vars propagate from the codex process into hook subprocesses, so HARNESS_AGENT carries it.
//   2. `codex exec` has NO --agent flag. The role is injected at dispatch instead
//      (tools/codex-dispatch.mjs), which is why the resource list is inlined rather than hooked.
//   3. Hooks require persisted trust, and WITHOUT it they are silently skipped — no error, no
//      warning, writes simply unguarded. Headless dispatch therefore passes
//      --dangerously-bypass-hook-trust; read runtimes.md before deciding that is acceptable to you.
//
// Claude Code has no per-agent path-permission field, and an `Edit(...)` rule in settings.json is
// session-wide, so the PreToolUse hook is the ONLY way to give one agent a narrower write surface
// than another. That matters here: the checker being unable to write source is what makes
// "the maker never grades itself" a property of the configuration rather than a line in a prompt.
//
// Usage: node gen-agents.mjs --target DIR [--runtime kiro|claude|codex|both|all|<a,b>] [--check]
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, rmSync } from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
const opt = (n, d = null) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const TARGET = path.resolve(opt("--target", "."));
const CONTAINED = existsSync(path.join(TARGET, "harness", "agents.manifest.json"));
const MANIFEST = opt("--manifest", CONTAINED ? "harness/agents.manifest.json" : "agents.manifest.json");
const RECEIPT = opt("--receipt", CONTAINED ? "harness/agents.generated.json" : "agents.generated.json");
const TOOL_ROOT = opt("--tool-root", CONTAINED ? "harness/tools" : "tools").replaceAll("\\", "/");
const RUNTIME = opt("--runtime", "both");
const CHECK = args.includes("--check");
const P = (...p) => path.join(TARGET, ...p);
const read = (p) => { try { return readFileSync(p, "utf8"); } catch { return null; } };
// docs/design/shared-memory-tier.md INV-RES-1: every agent reads memory/shared/*.md, computed
// here at generation time (not hand-listed in the manifest) — same reasoning as
// `subagentAllExceptSelf`'s roster: a hand-maintained list drifts the moment a fact is promoted
// or an entry is rotated out. Never appended to `writes`/`allowedPaths` anywhere in this file —
// that keeps INV-SHARED-2 (only memory-promote.mjs writes there) true by construction.
const MEMORY_SHARED_DIR = CONTAINED ? "harness/memory/shared" : "memory/shared";
const sharedMemoryResources = () => {
  try { return readdirSync(P(MEMORY_SHARED_DIR)).filter((f) => f.endsWith(".md")).sort().map((f) => `${MEMORY_SHARED_DIR}/${f}`); }
  catch { return []; }
};
const previousGenerated = (() => {
  try {
    const j = JSON.parse(read(P(RECEIPT)) || "{}");
    return new Set(Array.isArray(j.files) ? j.files : []);
  } catch { return new Set(); }
})();

const manifest = JSON.parse(readFileSync(P(MANIFEST), "utf8"));
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
  // Computed, not a static list in the manifest: a hardcoded roster drifts the moment an agent is
  // added or renamed, silently under- or over-permissioning who this role may spawn. kiro's own
  // `subagent` tool is what "the runtime's native sub-agent facility" in prompts/orchestrator.md
  // means for kiro specifically (verified: kiro.dev/docs/custom-agents/subagents/), and
  // `toolsSettings.subagent.availableAgents` is the one field that turns "never spawn yourself"
  // from a prompt-only MUST NOT into something kiro itself refuses.
  if (a.subagentAllExceptSelf) {
    j.toolsSettings = { ...(j.toolsSettings || {}),
      subagent: { availableAgents: agents.filter((x) => x.name !== a.name).map((x) => x.name) } };
  }
  j.resources = [...a.resources, ...sharedMemoryResources()].map(uri);
  const hooks = {};
  if (a.trace || a.spawnCommands) {
    hooks.agentSpawn = [
      ...(a.trace ? [{ command: `node ${TOOL_ROOT}/trace.mjs ${a.name} session-start` }] : []),
      ...(a.spawnCommands || []).map((command) => ({ command })),
    ];
  }
  if (a.traceToolUse && a.traceToolUse.length) {
    hooks.postToolUse = a.traceToolUse.map((matcher) => ({
      matcher,
      command: `node ${TOOL_ROOT}/trace.mjs ${a.name} tool-use ${matcher === "execute_bash" ? "shell" : "write"}`,
    }));
  }
  hooks.postToolUse = [...(hooks.postToolUse || []), ...["fs_read", "read", "grep", "glob", "execute_bash"]
    .map((matcher) => ({ matcher,
      command: `node ${TOOL_ROOT}/telemetry.mjs --runtime kiro --actor ${a.name}` }))];
  if (a.trace) hooks.stop = [{ command: `node ${TOOL_ROOT}/trace.mjs ${a.name} session-end` }];
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
    hooks.push(`  SubagentStart:\n    - command: "node ${TOOL_ROOT}/agent-context.mjs ${a.name}"`);
  }
  // The only per-agent write restriction Claude Code can express.
  if (a.writes) {
    // Bash too, not only the edit tools. The matcher used to be Edit|Write|NotebookEdit, so a
    // write-restricted agent could still `cat > probe.mjs` — the confinement held for the tools it
    // named and was absent for the one every agent has. Shell inspection is best-effort by nature
    // (a script can always write through an API), so guard-write catches the common redirect shapes
    // and clean-state's stray-verification-script catches whatever gets through.
    hooks.push(`  PreToolUse:\n    - matcher: "Edit|Write|NotebookEdit|Bash"\n      command: "node ${TOOL_ROOT}/guard-write.mjs ${a.name}"`);
  }
  if (a.trace) {
    hooks.push(`  SubagentStop:\n    - command: "node ${TOOL_ROOT}/trace.mjs ${a.name} session-end"`);
  }
  hooks.push(`  PostToolUse:\n    - matcher: "Read|Grep|Glob|Bash"\n      command: "node ${TOOL_ROOT}/telemetry.mjs --runtime claude --actor ${a.name}"`);
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

// --- Codex CLI --------------------------------------------------------------------------------
// TOML multi-line LITERAL strings take no escapes at all, which is exactly what a markdown prompt
// full of backslashes and quotes needs. The only sequence they cannot hold is their own delimiter,
// so that one case falls back to a basic string with the escapes TOML requires.
const L = "'".repeat(3), B = '"'.repeat(3);
function tomlBlock(text) {
  if (!text.includes(L)) return `${L}\n${text}\n${L}`;
  const esc = text.replace(/\\/g, "\\\\").replace(new RegExp(B, "g"), '\\"\\"\\"');
  return `${B}\n${esc}\n${B}`;
}
function codexAgent(a) {
  const body = read(P(a.prompt));
  if (body === null) return null;
  // Codex exposes no `resources` mechanism to an agent file, so the list becomes an instruction.
  // tools/codex-dispatch.mjs inlines the same files for headless runs; together that is what makes
  // an interactively-spawned Codex agent load the same context as the other two runtimes.
  const allResources = [...a.resources, ...sharedMemoryResources()];
  const resources = allResources.length
    ? "\n\n## Read these before you do anything else\n\n" +
      allResources.map((r) => `- \`${r}\``).join("\n") +
      "\n\nThese are your context. Skipping them is how a role does confident work on stale facts.\n"
    : "";
  const welcome = a.welcomeMessage ? `> **What this role does:** ${a.welcomeMessage}\n\n` : "";
  const instructions = `${GEN_HEADER(a.prompt)}\n${welcome}${body}${resources}`;
  const lines = [
    "# GENERATED from agents.manifest.json by tools/gen-agents.mjs. Do not hand-edit.",
    `name = ${JSON.stringify(a.name)}`,
    `description = ${JSON.stringify(a.description)}`,
  ];
  if (a.model && a.model.codex) lines.push(`model = ${JSON.stringify(a.model.codex)}`);
  if (a.codexReasoningEffort) lines.push(`model_reasoning_effort = ${JSON.stringify(a.codexReasoningEffort)}`);
  // A role that never writes gets Codex's OWN sandbox rather than a hook — enforcement by the
  // runtime beats enforcement by a script we ship. Roles with a `writes` list need write access to
  // part of the tree, and Codex's sandbox is directory-granular while `writes` is glob-granular, so
  // those still depend on the PreToolUse hook below.
  const canWrite = a.tools.includes("write") || a.tools.includes("*");
  lines.push(`sandbox_mode = ${JSON.stringify(canWrite ? "workspace-write" : "read-only")}`);
  lines.push(`developer_instructions = ${tomlBlock(instructions)}`);
  return lines.join("\n") + "\n";
}

// One project-level hook file, because Codex agent TOML cannot carry hooks. Every role shares it and
// guard-write.mjs resolves which one is running from HARNESS_AGENT.
function codexHooks(list) {
  // `description` and `hooks` are the ONLY fields Codex accepts here. A `$comment` key — harmless in
  // every other config this harness writes — makes Codex reject the whole file with a one-line
  // warning on stderr and run with NO hooks at all. Found by running it: the agent still refused the
  // out-of-lane write, because its prompt told it to, so the run looked like proof of enforcement
  // while nothing was enforcing anything.
  return JSON.stringify({
    description: "GENERATED by tools/gen-agents.mjs from agents.manifest.json. Codex hooks are " +
      "project-wide (agent TOML has no hooks field), so the guard identifies the running role from " +
      "the HARNESS_AGENT environment variable that tools/codex-dispatch.mjs sets. Hooks require " +
      "persisted trust: without it Codex SKIPS them silently and every write goes unguarded.",
    hooks: {
      PreToolUse: [{
        matcher: ".*",
        hooks: [{ type: "command", command: `node ${TOOL_ROOT}/guard-write.mjs --runtime codex --from-env` }],
      }],
      PostToolUse: [{
        matcher: ".*",
        hooks: [{ type: "command", command: `node ${TOOL_ROOT}/telemetry.mjs --runtime codex --actor \${HARNESS_AGENT:-unknown}` }],
      }],
    },
  }, null, 2) + "\n";
}

// --- emit ------------------------------------------------------------------------------------------
// `both` predates Codex and still means kiro+claude, so existing targets keep generating exactly
// what they generated before. `all` is every runtime; a comma list is exactly what it says.
// An unrecognised value used to fall through to an EMPTY wanted-set, and the cleanup pass below then
// deleted every generated agent file in the repo. A typo must not be a way to disarm the harness.
const RUNTIMES = RUNTIME === "both" ? ["kiro", "claude"]
  : RUNTIME === "all" ? ["kiro", "claude", "codex"]
  : RUNTIME.split(",").map((r) => r.trim()).filter(Boolean);
const UNKNOWN = RUNTIMES.filter((r) => !["kiro", "claude", "codex"].includes(r));
if (!RUNTIMES.length || UNKNOWN.length) {
  console.error(`unknown runtime: ${UNKNOWN.join(", ") || "(empty)"} — expected kiro, claude, codex, both, all, or a comma list`);
  process.exit(2);
}

const wanted = new Map();
if (RUNTIMES.includes("kiro")) {
  for (const a of agents) wanted.set(path.join(".kiro", "agents", `${a.name}.json`), kiroAgent(a));
}
if (RUNTIMES.includes("claude")) {
  for (const a of agents) {
    const c = claudeAgent(a);
    if (c) wanted.set(path.join(".claude", "agents", `${a.name}.md`), c);
  }
}
if (RUNTIMES.includes("codex")) {
  for (const a of agents) {
    const c = codexAgent(a);
    if (c) wanted.set(path.join(".codex", "agents", `${a.name}.toml`), c);
  }
  const h = codexHooks(agents);
  if (h) wanted.set(path.join(".codex", "hooks.json"), h);
}

if (CHECK) {
  const stale = [...wanted.entries()].filter(([rel, content]) => read(P(rel)) !== content);
  const extra = [];
  for (const [runtime, dir, ext] of [["kiro", path.join(".kiro", "agents"), ".json"],
                                    ["claude", path.join(".claude", "agents"), ".md"],
                                    ["codex", path.join(".codex", "agents"), ".toml"]]) {
    if (!RUNTIMES.includes(runtime) || !existsSync(P(dir))) continue;
    for (const f of readdirSync(P(dir))) {
      if (!f.endsWith(ext)) continue;
      const rel = path.join(dir, f), old = read(P(rel)) || "";
      if (!wanted.has(rel) && (previousGenerated.has(rel) || old.includes("GENERATED from agents.manifest.json"))) extra.push(rel);
    }
  }
  if (stale.length || extra.length) {
    console.error(`${stale.length + extra.length} generated agent file(s) differ from agents.manifest.json:`);
    for (const [rel] of stale) console.error(`  ${rel}`);
    for (const rel of extra) console.error(`  ${rel} (retired)`);
    console.error(`Regenerate: node tools/gen-agents.mjs --target . --runtime ${RUNTIME}`);
    process.exit(1);
  }
  console.log(`${wanted.size} generated agent file(s) match the manifest.`);
  process.exit(0);
}

// Remove generated files for agents the manifest no longer declares — an agent that keeps running
// after being deleted from the source is the same class of defect as one nobody routes to.
// ONLY the runtimes being generated. Sweeping all of them meant `--runtime kiro` deleted every
// Claude agent and `--runtime both` deleted every Codex one: they are declared in the manifest but
// absent from `wanted`, which is the same test as "no longer declared". Latent since the second
// runtime existed; it surfaced the moment a third made `both` a partial selection.
const CLEAN_DIRS = [["kiro", path.join(".kiro", "agents"), ".json"],
                    ["claude", path.join(".claude", "agents"), ".md"],
                    ["codex", path.join(".codex", "agents"), ".toml"]]
  .filter(([r]) => RUNTIMES.includes(r)).map(([, dir, ext]) => [dir, ext]);
for (const [dir, ext] of CLEAN_DIRS) {
  if (!existsSync(P(dir))) continue;
  for (const f of readdirSync(P(dir))) {
    if (!f.endsWith(ext)) continue;
    const rel = path.join(dir, f);
    if (wanted.has(rel)) continue;
    // Ownership comes from the generator marker, not the CURRENT manifest. A retired agent is by
    // definition absent from that manifest, so checking declared.has(name) skipped the exact file
    // this cleanup exists to remove. Unmanaged user/onboarder agents carry no marker and survive.
    const old = read(P(rel)) || "";
    // Claude/Codex carry an inline marker. Kiro JSON cannot safely accept unknown marker keys, so
    // its ownership is carried by agents.generated.json from the previous generation.
    if (!old.includes("GENERATED from agents.manifest.json") && !previousGenerated.has(rel)) continue;
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

// Persist generator ownership so the NEXT version can remove retired Kiro JSON without guessing
// that an unmanaged user agent belongs to us. Preserve receipt entries for runtimes not selected.
const selectedDirs = new Set(CLEAN_DIRS.map(([dir]) => dir));
const receiptFiles = new Set([...previousGenerated].filter((rel) =>
  ![...selectedDirs].some((dir) => rel === dir || rel.startsWith(dir + path.sep))));
for (const rel of wanted.keys()) receiptFiles.add(rel);
const receiptText = JSON.stringify({ schema: "generated-agents/1", files: [...receiptFiles].sort() }, null, 2) + "\n";
if (read(P(RECEIPT)) !== receiptText) writeFileSync(P(RECEIPT), receiptText);
if (written.length) {
  console.log(`Generated ${written.length} agent file(s) for runtime "${RUNTIME}" from agents.manifest.json`);
  for (const w of written) console.log(`  + ${w}`);
} else {
  console.log(`${wanted.size} agent file(s) already match agents.manifest.json — nothing rewritten.`);
}
