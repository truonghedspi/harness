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
//   node improve-harness.mjs --reverify [--id HI-NNN] [--target DIR] [--auto-resolve] [--skip-baseline]
//   node improve-harness.mjs --route    [--id HI-NNN] [--into feature_list.json] [--all] [--min-score N]
//   node improve-harness.mjs --prompt [--id HI-NNN] # top issue, or one immutable repair objective
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
  [/^baseline\//, "templates/tree/init.mjs → VERIFICATION block (stack detection); init.sh/init.cmd are wrappers and carry no logic"],
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
  const requestedId = opt("--id");
  let issues = openIssues();
  const explicit = opt("--target");
  if (requestedId) {
    issues = issues.filter((i) => i.id === requestedId);
    if (!issues.length) { console.error(`open harness issue ${requestedId} was not found`); process.exit(2); }
  }
  if (explicit && !requestedId) {
    const resolvedTarget = path.resolve(explicit);
    issues = issues.filter((i) => i.targets.map((t) => path.resolve(t)).includes(resolvedTarget));
    if (!issues.length) {
      console.error(`no open issues were recorded against ${resolvedTarget} — refusing provenance-free resolution`);
      process.exit(2);
    }
  }
  const targets = explicit
    ? [path.resolve(explicit)]
    : [...new Set(issues.flatMap((i) => i.targets))].filter(exists);

  if (!targets.length) {
    console.error("no targets to re-verify — pass --target DIR, or record issues from a real run first");
    process.exit(2);
  }

  const stillSeen = new Set();
  let trackerFailed = false;
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

    // The backlog has two producers, so re-verification has to run BOTH detectors. Running only
    // the static gates would make every trace-sourced issue look fixed the moment it was imported —
    // absence from a detector that never emits it is not evidence of anything.
    const insightsPath = path.join(path.dirname(reportPath), "insights.json");
    const ti = path.join(t, "tools", "trace-insights.mjs");
    const tiTool = exists(ti) ? ti : path.join(scriptDir, "trace-insights.mjs");
    spawnSync(process.execPath, [tiTool, "--target", t, "--report", insightsPath],
      { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
    try {
      const insights = JSON.parse(readFileSync(insightsPath, "utf8"));
      for (const o of insights.options || []) stillSeen.add(o.signature || `trace/${o.id}`);
      console.log(`  re-mined  ${t}: ${(insights.options || []).length} trace option(s)`);
    } catch { console.error(`  ${t}: trace-insights produced no report — trace-sourced issues left open`); trackerFailed = true; }
  }

  // A human-reported issue has no detector to fall silent, so nothing here can retire it. Letting
  // the absence of a signature resolve it would mean the loop closes the human's complaint by not
  // being able to see it — which is precisely the failure the human was reporting.
  const humanReported = issues.filter((i) => i.gate === "human");
  if (humanReported.length) {
    console.log(`  ${humanReported.length} human-reported issue(s) skipped: only a person can close what only a person saw.`);
  }
  const fixed = issues.filter((i) => i.gate !== "human" && !trackerFailed && !stillSeen.has(i.signature));
  const remaining = issues.filter((i) => !fixed.includes(i));
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

// ---------------------------------------------------------------------------------------------
// --route: the backlog becomes work the loop can actually pick up
//
// Ranking told a human what to fix next; it still needed a human to carry it into the loop. This
// writes the top-ranked issue into a feature_list.json as an ordinary feature, so the same
// maker/checker machinery that builds product work also repairs the harness.
//
// The safety is in the VERIFICATION, not in the creation. The feature's verification command is
// the detector that opened the issue, re-run: `--reverify --id HI-NNN` exits 1 while the signature
// still reproduces and 0 when it is gone. So the loop may create its own work, but it cannot
// declare that work done — the same generator/evaluator split the maker and checker already have,
// applied to the harness repairing itself. A human-reported issue is never routed this way: it has
// no detector, so nothing could ever close it, and an uncloseable feature is a livelock.
// ---------------------------------------------------------------------------------------------
if (flag("--route")) {
  const defaultInto = path.resolve(scriptDir, "..", "..", "feature_list.json");
  const intoPath = path.resolve(opt("--into", defaultInto));
  if (!exists(intoPath)) {
    console.error(`no feature_list.json at ${intoPath} — pass --into PATH`);
    process.exit(2);
  }
  const minScore = Number(opt("--min-score", 0));
  const requestedId = opt("--id");
  const routable = ranked.filter((i) => i.gate !== "human" && i.score >= minScore &&
    (!requestedId || i.id === requestedId));
  if (requestedId && !routable.length) {
    console.error(`${requestedId} is not an open, routable issue (human-reported issues are never routed)`);
    process.exit(2);
  }
  // One per run by default: the ranking exists so the next fix is the highest-value one, and a
  // backlog dumped wholesale into a feature list is a plan nobody cut.
  const chosen = flag("--all") ? routable : routable.slice(0, 1);
  if (!chosen.length) { console.log("No routable open issues — nothing to route."); process.exit(0); }

  const list = JSON.parse(readFileSync(intoPath, "utf8"));
  list.features = list.features || [];
  const existing = new Set(list.features.map((f) => f.id));
  const toolPath = path.relative(path.dirname(intoPath), path.join(scriptDir, "improve-harness.mjs"));
  let added = 0;
  for (const issue of chosen) {
    const id = `feat-${issue.id.toLowerCase()}`;
    if (existing.has(id)) { console.log(`  ${id} already exists — left untouched`); continue; }
    const target = (issue.targets || []).find(exists);
    list.features.push({
      id, kind: "build", status: "not-started", readyForCheck: false,
      behavior: `The harness no longer reproduces ${issue.id}: ${issue.symptom}`,
      verification: `node ${toolPath} --reverify --id ${issue.id}${target ? ` --target ${path.relative(path.dirname(intoPath), target)}` : ""} --skip-baseline`,
      falsifier: "a repair made in the affected target instead of templates/tree/** or scripts/*.mjs — the signature returns on the next scaffold, which is exactly what --reverify re-runs",
      dependencies: [], attempts: 0, maxAttempts: 3, evidence: [],
      checkerNotes: `Routed from harness issue ${issue.id} (${issue.signature}), score ${issue.score}, seen ${issue.occurrences}x.`,
      context: { note: `Remedy on record: ${issue.remedy || "(none)"}\nEvidence: ${String(issue.evidence || "").slice(0, 400)}` },
    });
    existing.add(id);
    added++;
    console.log(`  routed ${issue.id} → ${id}  [score ${issue.score}]`);
  }
  if (added) writeFileSync(intoPath, JSON.stringify(list, null, 2) + "\n");
  console.log(`\n${added} issue(s) routed into ${intoPath}.`);
  console.log(`Each closes only when its verification exits 0 — the detector that opened it, re-run.`);
  process.exit(0);
}

if (flag("--prompt")) {
  const requestedId = opt("--id");
  const top = requestedId ? ranked.find((i) => i.id === requestedId) : ranked[0];
  if (requestedId && !top) {
    console.error(`error: open harness issue ${requestedId} was not found`);
    process.exit(2);
  }
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
