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
import { readdirSync, statSync, readFileSync, writeFileSync, mkdirSync, chmodSync } from "node:fs";
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
  ["references/agent-memory.md", "docs/reference/agent-memory.md"],
  ["references/feature-decomposition.md", "docs/reference/feature-decomposition.md"],
  ["references/design-engineering.md", "docs/reference/design-engineering.md"],
  ["references/knowledge-layout.md", "docs/reference/knowledge-layout.md"],
  ["references/human-attention.md", "docs/reference/human-attention.md"],
  ["references/llm-failure-modes.md", "docs/reference/llm-failure-modes.md"],
];
for (const [src, destRel] of EXTRA_COPIES) {
  const dest = path.join(targetRoot, destRel);
  if (exists(dest) && !FORCE) { skipped.push(destRel); continue; }
  mkdirSync(path.dirname(dest), { recursive: true });
  writeFileSync(dest, readFileSync(path.join(skillRoot, src), "utf8"));
  written.push(destRel);
}

// --- report ---------------------------------------------------------------------------------
console.log(`\nHarness loop scaffolded into: ${targetRoot}`);
console.log(`  agent file: ${AGENT_FILE}   package manager: ${PM || "n/a (edit init.sh)"}\n`);
console.log(`  Written (${written.length}):`);
for (const f of written) console.log(`    + ${f}`);
if (skipped.length) {
  console.log(`\n  Skipped (${skipped.length}, already exist — re-run with --force to overwrite):`);
  for (const f of skipped) console.log(`    · ${f}`);
}
console.log(`\nNext steps:`);
console.log(`  1. Missing context? kiro-cli chat --agent context-interviewer — it asks only what can't be grepped, one question at a time, and persists every answer to a file.`);
console.log(`  2. Design from the requirement: kiro-cli chat --agent designer (then --agent design-reviewer) — components, cited claims, and docs/assumptions.md. It stops only on assumptions only you can answer.`);
console.log(`  3. Decompose the requirement: kiro-cli chat --agent feature-planner (or follow prompts/feature-planner.md) — it replaces feature_list.json's placeholders with a right-sized DAG.`);
console.log(`  4. Fill loop/goal.md with the real objective + stopping condition, and docs/*.md with real content.`);
console.log(`  5. cd ${TARGET} && ./init.sh      # get the baseline green before looping`);
console.log(`  6. node check-coverage.mjs        # prove all 13 lessons are covered (must be 13/13)`);
console.log(`  7. kiro-cli chat --agent maker    # Level 1 loop; then --agent checker; or loop/run-loop.sh N`);
console.log("");
