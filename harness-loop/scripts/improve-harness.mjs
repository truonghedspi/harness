#!/usr/bin/env node
// improve-harness.mjs — the IMPROVE step: turn recorded harness defects into a ranked work plan,
// and prove a fix actually landed.
//
// The loop this closes: use the harness -> verify finds a layer=harness defect -> harness-issue.mjs
// records it -> this script ranks it and points at the template that must change -> someone (agent
// or human) fixes the skill -> --reverify re-runs verify on every affected target and auto-resolves
// the issues that stopped reproducing. Nothing gets marked fixed on a claim; only on a re-run.
//
// Usage:
//   node improve-harness.mjs [--top N] [--json] [--out PATH]
//   node improve-harness.mjs --reverify [--target DIR] [--auto-resolve] [--skip-baseline]
//   node improve-harness.mjs --prompt              # agent-ready instructions for the top issue
import { readFileSync, writeFileSync, statSync, mkdtempSync , writeSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

// stdout on a pipe is async: process.exit() drops whatever has not flushed, so a payload
// past the pipe buffer (~8 KB on macOS) is silently truncated for any caller using
// spawnSync. Found when aeron-demo's report crossed that line and adoption-baseline
// started failing to parse its own input. writeSync is the fix everywhere --json exits.
const args = process.argv.slice(2);
const opt = (n, d = null) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const flag = (n) => args.includes(n);

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.resolve(scriptDir, "..");
const ISSUE_TOOL = path.join(scriptDir, "harness-issue.mjs");
const VERIFY_TOOL = path.join(scriptDir, "verify-harness.mjs");
const OUT = path.resolve(opt("--out", path.join(skillRoot, "harness-improvements.md")));
const TOP = Number(opt("--top", 10));

const exists = (p) => { try { statSync(p); return true; } catch { return false; } };

function openIssues() {
  const r = spawnSync(process.execPath, [ISSUE_TOOL, "list", "--status", "open", "--json"],
    { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
  try { return JSON.parse(r.stdout); } catch { return []; }
}

// Where a defect of each kind most likely has to be fixed. This is the routing table that turns
// "something is wrong" into "edit this file" — the same job AGENTS.md does for a project.
const ROUTES = [
  [/^structure\//, "templates/tree/ (missing artifact) or scripts/setup-harness-loop.mjs (not written)"],
  [/^placeholders\/.*\{\{|unsubstituted/, "scripts/setup-harness-loop.mjs → substitute()"],
  [/^placeholders\//, "templates/tree/<file> — make the placeholder impossible to miss, or ask for the value at setup"],
  [/^baseline\//, "templates/tree/init.sh → VERIFICATION block (stack detection)"],
  [/^features\//, "templates/tree/feature_list.json + loop/checker-prompt.md (evidence contract)"],
  [/^loop\/agent-json/, "templates/tree/.kiro/agents/*.json"],
  [/^loop\//, "templates/tree/loop/ (goal / maker / checker prompts)"],
  [/^clean-state\//, "templates/tree/AGENTS.md → End-of-Session checklist"],
];
const routeFor = (sig) => (ROUTES.find(([re]) => re.test(sig)) || [null, "harness-loop/ — locate by signature"])[1];

const SEVERITY_WEIGHT = { blocker: 3, warn: 1 };
const score = (i) =>
  i.occurrences * (SEVERITY_WEIGHT[i.severity] || 1) * Math.max(1, i.targets.length) * (i.regressed ? 2 : 1);

// ---------------------------------------------------------------------------------------------
// --reverify: the only way an issue becomes "resolved"
// ---------------------------------------------------------------------------------------------
if (flag("--reverify")) {
  const issues = openIssues();
  const explicit = opt("--target");
  const targets = explicit
    ? [path.resolve(explicit)]
    : [...new Set(issues.flatMap((i) => i.targets))].filter(exists);

  if (!targets.length) {
    console.error("no targets to re-verify — pass --target DIR, or record issues from a real run first");
    process.exit(2);
  }

  const stillSeen = new Set();
  for (const t of targets) {
    const reportPath = path.join(mkdtempSync(path.join(tmpdir(), "harness-verify-")), "report.json");
    const a = [VERIFY_TOOL, "--target", t, "--quiet", "--report", reportPath];
    if (flag("--skip-baseline")) a.push("--skip-baseline");
    spawnSync(process.execPath, a, { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
    let report = null;
    try { report = JSON.parse(readFileSync(reportPath, "utf8")); } catch { /* below */ }
    if (!report) { console.error(`  ${t}: verify produced no report — skipped`); continue; }
    for (const f of report.findings) stillSeen.add(`${f.gate}/${f.id}`);
    console.log(`  re-verified ${t}: ${report.counts.blockers} blocker(s), ${report.counts.harnessLayer} harness-layer`);
  }

  const fixed = issues.filter((i) => !stillSeen.has(i.signature));
  const remaining = issues.filter((i) => stillSeen.has(i.signature));
  console.log(`\n  ${fixed.length} open issue(s) no longer reproduce, ${remaining.length} still do.`);
  for (const i of fixed) {
    console.log(`    ${i.id}  [${i.gate}] ${i.symptom}`);
    if (flag("--auto-resolve")) {
      spawnSync(process.execPath, [ISSUE_TOOL, "resolve", "--id", i.id,
        "--fix", `no longer reproduces on re-verify (${new Date().toISOString().slice(0, 10)})`],
        { encoding: "utf8" });
    }
  }
  if (fixed.length && !flag("--auto-resolve")) {
    console.log(`\n  Close them: node harness-issue.mjs resolve --id <ID> --fix "<what changed>"`);
    console.log(`  Or re-run with --auto-resolve.`);
  }
  process.exit(remaining.length ? 1 : 0);
}

// ---------------------------------------------------------------------------------------------
// Default: rank the open issues and write the plan
// ---------------------------------------------------------------------------------------------
const ranked = openIssues()
  .map((i) => ({ ...i, score: score(i), route: routeFor(i.signature) }))
  .sort((a, b) => b.score - a.score);

if (flag("--prompt")) {
  const top = ranked[0];
  if (!top) { console.log("No open harness issues — nothing to improve."); process.exit(0); }
  console.log(`Fix harness issue ${top.id} in the harness-loop skill.

Symptom (seen ${top.occurrences}x${top.targets.length > 1 ? ` across ${top.targets.length} projects` : ""}): ${top.symptom}
Suggested remedy: ${top.remedy || "(none recorded — diagnose from the symptom)"}
Most likely location: ${top.route}
${top.evidence ? `Evidence:\n${top.evidence}\n` : ""}
Rules:
- Fix the TEMPLATE or the SCRIPT, never just the one target repo — a per-target patch leaves the
  defect in place for the next project.
- Do not widen scope: one issue per iteration.
- Prove it: node scripts/improve-harness.mjs --reverify --auto-resolve
  The issue closes only when it stops reproducing on a real target.
- If the fix would break existing scaffolded projects, say so instead of shipping it.`);
  process.exit(0);
}

if (flag("--json")) { writeSync(1, JSON.stringify(ranked.slice(0, TOP), null, 2) + "\n"); process.exit(0); }

const lines = [];
lines.push("# Harness improvement plan");
lines.push("");
lines.push(`Generated ${new Date().toISOString().slice(0, 19).replace("T", " ")} from \`harness-issues.jsonl\`.`);
lines.push("Ranked by `occurrences × severity × distinct targets` (regressions doubled) — fix top-down,");
lines.push("one per iteration, and close each with `--reverify`.");
lines.push("");
if (!ranked.length) {
  lines.push("No open issues. The harness has not failed anyone yet — or nobody ran `verify-harness.mjs`.");
} else {
  lines.push("| # | id | score | seen | gate | symptom | fix where |");
  lines.push("|---|----|-------|------|------|---------|-----------|");
  ranked.slice(0, TOP).forEach((i, n) => {
    const cell = (s) => String(s || "").replace(/\|/g, "\\|").replace(/\n/g, " ");
    lines.push(`| ${n + 1} | ${i.id} | ${i.score} | ${i.occurrences}x in ${i.targets.length} proj | ${cell(i.gate)} | ${cell(i.symptom)} | ${cell(i.route)} |`);
  });
  lines.push("");
  for (const i of ranked.slice(0, TOP)) {
    lines.push(`## ${i.id} — ${i.symptom}`);
    lines.push("");
    lines.push(`- **Gate:** \`${i.gate}\`  **Severity:** ${i.severity}  **Score:** ${i.score}${i.regressed ? "  **REGRESSED**" : ""}`);
    lines.push(`- **Seen:** ${i.occurrences}x, first ${String(i.firstSeen).slice(0, 10)}, last ${String(i.lastSeen).slice(0, 10)}`);
    if (i.targets.length) lines.push(`- **Targets:** ${i.targets.join(", ")}`);
    lines.push(`- **Remedy:** ${i.remedy || "_diagnose from the symptom_"}`);
    lines.push(`- **Fix where:** ${i.route}`);
    if (i.evidence) { lines.push("", "```", String(i.evidence).slice(0, 1200), "```"); }
    lines.push("");
  }
}
writeFileSync(OUT, lines.join("\n") + "\n");

console.log(`\nHarness improvement plan → ${OUT}`);
if (!ranked.length) { console.log("  No open issues.\n"); process.exit(0); }
console.log("");
ranked.slice(0, TOP).forEach((i, n) => {
  console.log(`  ${String(n + 1).padStart(2)}. ${i.id}  score ${String(i.score).padStart(3)}  [${i.gate}] ${i.symptom}`);
  console.log(`      fix in: ${i.route}`);
});
console.log(`\n  Work the top item:  node ${path.relative(process.cwd(), scriptDir)}/improve-harness.mjs --prompt`);
console.log(`  Then prove it:      node ${path.relative(process.cwd(), scriptDir)}/improve-harness.mjs --reverify --auto-resolve\n`);
