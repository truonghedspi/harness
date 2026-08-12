#!/usr/bin/env node
// setup-harness-loop.mjs — scaffold a full harness + maker-checker loop into any project,
// covering all 13 Learn-Harness-Engineering lessons. Node built-ins only.
//
// Usage:
//   node setup-harness-loop.mjs --target /path/to/project [options]
// Options:
//   --agent-file CLAUDE.md          router filename (default AGENTS.md)
//   --package-manager npm|pnpm|yarn|bun
//   --commands "cmd one,cmd two"    override the auto-detected verification block in init.sh
//   --name "Project X"              project name for templates
//   --purpose "one line"            one-line project purpose
//   --force                         overwrite existing files (requires explicit user OK)
import { readdirSync, statSync, readFileSync, writeFileSync, mkdirSync, chmodSync, utimesSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const args = process.argv.slice(2);
const opt = (name, def = null) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : def; };
const flag = (name) => args.includes(name);

const TARGET = opt("--target");
if (!TARGET) { console.error("error: --target /path/to/project is required"); process.exit(2); }
const targetRoot = path.resolve(TARGET);
const AGENT_FILE = opt("--agent-file", "AGENTS.md");
const FORCE = flag("--force");
const NAME = opt("--name", path.basename(targetRoot));
const PURPOSE = opt("--purpose", "One-line description of what this project does — replace me.");
const COMMANDS = opt("--commands", null);
const RUNTIME = opt("--runtime", "both");   // kiro | claude | both — which agent format(s) to emit

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.resolve(scriptDir, "..");
const treeRoot = path.join(skillRoot, "templates", "tree");

const exists = (p) => { try { statSync(p); return true; } catch { return false; } };

// --- package manager / verification detection ---------------------------------------------
function detectPM() {
  if (opt("--package-manager")) return opt("--package-manager");
  if (exists(path.join(targetRoot, "pnpm-lock.yaml"))) return "pnpm";
  if (exists(path.join(targetRoot, "yarn.lock"))) return "yarn";
  if (exists(path.join(targetRoot, "bun.lockb")) || exists(path.join(targetRoot, "bun.lock"))) return "bun";
  if (exists(path.join(targetRoot, "package.json"))) return "npm";
  return null;
}
const PM = detectPM();
const PRIMARY_CMD = "./init.sh    # full baseline gate (Lesson 6/9/12)";

// Custom verification block for init.sh, if --commands given.
function customVerificationBlock() {
  if (!COMMANDS) return null;
  const cmds = COMMANDS.split(",").map((c) => c.trim()).filter(Boolean);
  return [
    "# >>> VERIFICATION  (custom, provided at setup)",
    'echo "=== Custom verification ==="',
    ...cmds,
    "# <<< VERIFICATION",
  ].join("\n");
}

// --- substitution ---------------------------------------------------------------------------
function substitute(content, relPath) {
  let out = content
    .replaceAll("{{PROJECT_NAME}}", NAME)
    .replaceAll("{{PROJECT_PURPOSE}}", PURPOSE)
    .replaceAll("{{PRIMARY_VERIFICATION_COMMAND}}", PRIMARY_CMD)
    .replaceAll("{{DATE}}", new Date().toISOString().slice(0, 10));

  // Rename the router if a different agent file was requested, and fix in-text references.
  if (AGENT_FILE !== "AGENTS.md") out = out.replaceAll("AGENTS.md", AGENT_FILE);

  // Swap the init.sh verification block when custom commands were provided.
  if (relPath === "init.sh") {
    const custom = customVerificationBlock();
    if (custom) {
      out = out.replace(/# >>> VERIFICATION[\s\S]*?# <<< VERIFICATION/, custom);
    }
  }
  return out;
}

// Destination path for a template-relative path (handles agent-file rename).
function destOf(relPath) {
  if (relPath === "AGENTS.md" && AGENT_FILE !== "AGENTS.md") return path.join(targetRoot, AGENT_FILE);
  return path.join(targetRoot, relPath);
}

// --- walk + write ---------------------------------------------------------------------------
const written = [], skipped = [];
function walk(dir, rel = "") {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name);
    const childRel = rel ? path.join(rel, entry.name) : entry.name;
    if (entry.isDirectory()) { walk(abs, childRel); continue; }
    const dest = destOf(childRel);
    if (exists(dest) && !FORCE) { skipped.push(path.relative(targetRoot, dest)); continue; }
    mkdirSync(path.dirname(dest), { recursive: true });
    writeFileSync(dest, substitute(readFileSync(abs, "utf8"), childRel));
    if (/\.sh$/.test(dest)) chmodSync(dest, 0o755);
    written.push(path.relative(targetRoot, dest));
  }
}

if (!exists(treeRoot)) { console.error(`error: template tree not found at ${treeRoot}`); process.exit(1); }
mkdirSync(targetRoot, { recursive: true });
walk(treeRoot);

// Copy the coverage checker into the target root so the loop/setup agent can run it locally.
const checkerDest = path.join(targetRoot, "check-coverage.mjs");
if (!exists(checkerDest) || FORCE) {
  writeFileSync(checkerDest, readFileSync(path.join(scriptDir, "check-coverage.mjs"), "utf8"));
  written.push("check-coverage.mjs");
} else skipped.push("check-coverage.mjs");

// Knowledge the agents' prompts cite, and tools they invoke, must live IN the target — a prompt
// pointing at harness-loop/references/... resolves to nothing in a scaffolded repo (the Fresh
// Session Test, Lesson 3, applied to this skill's own output). Copied, not referenced.
const EXTRA_COPIES = [
  ["scripts/verify-harness.mjs", "tools/verify-harness.mjs"],
  ["scripts/memory-query.mjs", "tools/memory-query.mjs"],
  ["scripts/memory-consolidate.mjs", "tools/memory-consolidate.mjs"],
  ["scripts/run-report.mjs", "tools/run-report.mjs"],
  ["scripts/cross-cutting-audit.mjs", "tools/cross-cutting-audit.mjs"],
  ["scripts/feature-digest.mjs", "tools/feature-digest.mjs"],
  ["scripts/context-budget.mjs", "tools/context-budget.mjs"],
  ["scripts/review-digest.mjs", "tools/review-digest.mjs"],
  ["scripts/adoption-baseline.mjs", "tools/adoption-baseline.mjs"],
  ["scripts/gen-agents.mjs", "tools/gen-agents.mjs"],
  ["scripts/agent-context.mjs", "tools/agent-context.mjs"],
  ["scripts/guard-write.mjs", "tools/guard-write.mjs"],
  ["scripts/replay-parallel.mjs", "tools/replay-parallel.mjs"],
  ["scripts/collect-services.mjs", "tools/collect-services.mjs"],
  ["references/agent-memory.md", "docs/reference/agent-memory.md"],
  ["references/feature-decomposition.md", "docs/reference/feature-decomposition.md"],
  ["references/design-engineering.md", "docs/reference/design-engineering.md"],
  ["references/knowledge-layout.md", "docs/reference/knowledge-layout.md"],
  ["references/human-attention.md", "docs/reference/human-attention.md"],
  ["references/llm-failure-modes.md", "docs/reference/llm-failure-modes.md"],
  ["references/test-authoring.md", "docs/reference/test-authoring.md"],
  ["references/adopting-an-existing-project.md", "docs/reference/adopting-an-existing-project.md"],
  ["references/graph.md", "docs/reference/graph.md"],
  ["references/runtimes.md", "docs/reference/runtimes.md"],
  ["references/step-acceptance.md", "docs/reference/step-acceptance.md"],
  ["references/invariant-contract.md", "docs/reference/invariant-contract.md"],
  ["references/multi-service.md", "docs/reference/multi-service.md"],
];
// Whole directories copied verbatim. The test-design skill ships as a unit — SKILL.md is useless
// without the strategy matrix, property catalog and schemas it dispatches to.
const EXTRA_DIR_COPIES = [["templates/test-design", "skills/test-design"]];
for (const [src, destRel] of EXTRA_COPIES) {
  const dest = path.join(targetRoot, destRel);
  if (exists(dest) && !FORCE) { skipped.push(destRel); continue; }
  mkdirSync(path.dirname(dest), { recursive: true });
  writeFileSync(dest, readFileSync(path.join(skillRoot, src), "utf8"));
  written.push(destRel);
}
for (const [srcDir, destDir] of EXTRA_DIR_COPIES) {
  const walkDir = (rel) => {
    for (const name of readdirSync(path.join(skillRoot, srcDir, rel), { withFileTypes: true })) {
      const childRel = path.join(rel, name.name);
      if (name.isDirectory()) { walkDir(childRel); continue; }
      const destRel = path.join(destDir, childRel);
      const dest = path.join(targetRoot, destRel);
      if (exists(dest) && !FORCE) { skipped.push(destRel); continue; }
      mkdirSync(path.dirname(dest), { recursive: true });
      writeFileSync(dest, readFileSync(path.join(skillRoot, srcDir, childRel), "utf8"));
      written.push(destRel);
    }
  };
  walkDir(".");
}

// Agent configs are generated, not templated: agents.manifest.json is the source and both runtimes
// are emitted from it. Hand-maintaining two formats guarantees drift, and a drifted agent config
// does not error — it silently runs as a different agent (HI-005).
{
  const gen = spawnSync(process.execPath,
    [path.join(targetRoot, "tools", "gen-agents.mjs"), "--target", targetRoot, "--runtime", RUNTIME],
    { encoding: "utf8" });
  if (gen.status === 0) {
    for (const line of (gen.stdout || "").split("\n")) {
      const m = line.match(/^\s+\+ (.+)$/); if (m) written.push(m[1]);
    }
  } else console.error(`  ! could not generate agent configs: ${(gen.stderr || "").trim().slice(0, 300)}`);
}

// The graph ships describing exactly these agents, but generation writes them after the copy, so
// their mtimes would make a brand-new scaffold report graph-stale on its first verify. Restamp it.
{ const g = path.join(targetRoot, "docs", "reference", "graph.md");
  if (exists(g)) { const now = new Date(); try { utimesSync(g, now, now); } catch {} } }

// Generated, not templated: six agents load feature_list.digest.md as a resource — it is what
// keeps the full feature list out of every agent's context budget. Shipping those agents without
// generating it means each one starts missing a file kiro will not complain about
// (references/llm-failure-modes.md, and the agent-uri-broken gate that caught this).
const digestPath = path.join(targetRoot, "feature_list.digest.md");
if (!exists(digestPath) || FORCE) {
  const gen = spawnSync(process.execPath,
    [path.join(targetRoot, "tools", "feature-digest.mjs"), "--target", targetRoot],
    { encoding: "utf8" });
  if (gen.status === 0 && exists(digestPath)) written.push("feature_list.digest.md");
  else console.error(`  ! could not generate feature_list.digest.md — run: node tools/feature-digest.mjs --target ${targetRoot}`);
} else skipped.push("feature_list.digest.md");

// --- report ---------------------------------------------------------------------------------
console.log(`\nHarness loop scaffolded into: ${targetRoot}`);
console.log(`  agent file: ${AGENT_FILE}   package manager: ${PM || "n/a (edit init.sh)"}\n`);
console.log(`  Written (${written.length}):`);
for (const f of written) console.log(`    + ${f}`);
if (skipped.length) {
  console.log(`\n  Skipped (${skipped.length}, already exist — re-run with --force to overwrite):`);
  for (const f of skipped) console.log(`    · ${f}`);
}
console.log(`\nNext steps — you do not have to memorise the order:`);
console.log(`  0. cd ${TARGET}`);
console.log(`  1. Fill the placeholders. requirement*.md is yours to write; docs/architecture.md,`);
console.log(`     docs/constraints.md and docs/testing-standards.md must describe THIS project, and`);
console.log(`     loop/goal.md needs a real objective with a machine-checkable stopping condition.`);
console.log(`     verify-harness reports every placeholder left behind as a blocker, so nothing is`);
console.log(`     silently skipped.`);
console.log(`  2. ./init.sh                              # baseline green before any loop`);
console.log(`  3. node check-coverage.mjs                # 13/13 lessons`);
console.log(`  4. node tools/verify-harness.mjs --target . --run-features     # 0 blockers is the bar`);
console.log(`  5. node loop/route.mjs                    # asks the state which agent runs next, and why`);
console.log(`  6. loop/run-loop.sh 1                     # one supervised iteration, routed automatically`);
console.log(``);
console.log(`The router picks the node; you do not. It walks deeper-first — a fact only a human has`);
console.log(`(context-interviewer), then design, then decomposition, then the oracle, then the code.`);
console.log(`Run it whenever you are unsure what to do next.`);
console.log(``);
console.log(`Runtimes: agents were generated for ${RUNTIME === "both" ? "kiro-cli AND Claude Code" : RUNTIME}.`);
console.log(`Set HARNESS_RUNTIME=kiro|claude to force one; run-loop.sh otherwise detects it.`);
console.log(`Regenerate after editing agents.manifest.json: node tools/gen-agents.mjs --target .`);
console.log(``);
console.log(`Adopting a repo with history instead of starting fresh? Do NOT use this script directly —`);
console.log(`run scripts/install-onboarder.mjs against it, and read`);
console.log(`docs/reference/adopting-an-existing-project.md first. Existing code trips every gate at`);
console.log(`once, and the adoption baseline is what stops that being a wall you learn to ignore.`);
console.log("");
