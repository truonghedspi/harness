#!/usr/bin/env node
// adoption-baseline.mjs — make an existing codebase adoptable without lying about it.
//
// The gates in this harness assume a project that grew up with them. Point them at a repo with
// five years of history and they fire all at once: every test written before the traceability
// rule, every feature whose evidence predates the red-green rule, every verification with no
// falsifier. Hundreds of warnings on day one.
//
// That is the worst possible outcome. It is not a stricter harness — it is a harness the user
// learns to ignore in the first hour, and an ignored gate is weaker than no gate, because it
// photographs as coverage. (Same failure review-digest was built to prevent: 66 items is the wall,
// not the review.)
//
// So: snapshot the debt at adoption, then report only the DELTA, and refuse to let it grow.
//
//   record  — freeze today's warning counts as the accepted starting debt
//   check   — re-run the gates and compare. NEW debt fails; pre-existing debt is listed, not failed
//   ratchet — after paying some debt down, lower the baseline so it can never come back
//
// The invariant is one sentence: **you may leave the old debt alone, but you may not add to it.**
//
// Usage:
//   node adoption-baseline.mjs --target DIR --record   [--note "..."]
//   node adoption-baseline.mjs --target DIR [--check]  [--json]
//   node adoption-baseline.mjs --target DIR --ratchet
import { readFileSync, writeFileSync, existsSync, mkdirSync , writeSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

// stdout on a pipe is async: process.exit() drops whatever has not flushed, so a payload
// past the pipe buffer (~8 KB on macOS) is silently truncated for any caller using
// spawnSync. Found when aeron-demo's report crossed that line and adoption-baseline
// started failing to parse its own input. writeSync is the fix everywhere --json exits.
const args = process.argv.slice(2);
const opt = (n, d = null) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const TARGET = path.resolve(opt("--target", "."));
const JSON_OUT = args.includes("--json");
const MODE = args.includes("--record") ? "record" : args.includes("--ratchet") ? "ratchet" : "check";
const BASELINE = path.join(TARGET, "trace", "adoption-baseline.json");
const scriptDir = path.dirname(fileURLToPath(import.meta.url));

// Only warnings are debt. A BLOCKER is never grandfathered — an unfilled placeholder or a feature
// with no runnable verification is broken today, not inherited, and adopting the harness is not a
// reason to accept it.
function measure() {
  const local = path.join(TARGET, "tools", "verify-harness.mjs");
  const script = existsSync(local) ? local : path.join(scriptDir, "verify-harness.mjs");
  const r = spawnSync(process.execPath, [script, "--target", TARGET, "--skip-baseline", "--json"],
    { encoding: "utf8", maxBuffer: 64e6 });
  let report = null;
  try { report = JSON.parse(r.stdout); } catch {
    console.error("could not read verify-harness --json output:\n" + (r.stderr || r.stdout || "").slice(0, 800));
    process.exit(2);
  }
  const findings = report.findings || [];
  const debt = {};
  for (const f of findings.filter((x) => x.severity === "warn")) {
    // Per-item ids (scope-smell:feat-x) collapse to their family, so renaming a feature is not
    // "new debt" and splitting one is not "debt paid". The family is what you ratchet on.
    const family = String(f.id).split(":")[0];
    debt[family] = (debt[family] || 0) + (Number(f.count) || 1);
  }
  let featureKinds = false;
  try {
    const fl = JSON.parse(readFileSync(path.join(TARGET, "feature_list.json"), "utf8"));
    featureKinds = (fl.features || []).some((f) => f.kind === "build" || f.kind === "prove");
  } catch { /* verify owns missing/invalid feature-list reporting */ }
  return { debt, blockers: findings.filter((x) => x.severity === "blocker").length, findings,
    dormant: featureKinds ? [] : ["build-unproven"] };
}

const load = () => { try { return JSON.parse(readFileSync(BASELINE, "utf8")); } catch { return null; } };
const save = (o) => { mkdirSync(path.dirname(BASELINE), { recursive: true }); writeFileSync(BASELINE, JSON.stringify(o, null, 2) + "\n"); };
const today = () => new Date().toISOString().slice(0, 10);

const { debt, blockers, findings, dormant } = measure();
const total = Object.values(debt).reduce((a, b) => a + b, 0);

if (MODE === "record") {
  if (load() && !args.includes("--force")) {
    console.error(`a baseline already exists at ${path.relative(TARGET, BASELINE)} — re-recording would forgive debt added since.\nUse --ratchet to lower it, or --record --force if you really mean to reset.`);
    process.exit(2);
  }
  save({ recordedAt: today(), note: opt("--note", ""), debt, dormant, totalAtAdoption: total });
  console.log(`Adoption baseline recorded — ${total} pre-existing warning(s) across ${Object.keys(debt).length} famil(ies).`);
  for (const [k, v] of Object.entries(debt).sort((a, b) => b[1] - a[1])) console.log(`  ${String(v).padStart(4)}  ${k}`);
  console.log(`\nThese are now ACCEPTED DEBT, not failures. From here the rule is: the count may not go up.`);
  console.log(`Every new feature is held to the full standard; the back catalogue is paid down when you choose to.`);
  if (blockers) console.log(`\nNOTE: ${blockers} BLOCKER(s) are NOT grandfathered — those are broken now, not inherited. Fix them.`);
  process.exit(0);
}

const base = load();
if (!base) {
  console.error(`no adoption baseline at ${path.relative(TARGET, BASELINE)}.\nRun with --record first (docs/reference/adopting-an-existing-project.md).`);
  process.exit(2);
}

const families = [...new Set([...Object.keys(base.debt), ...Object.keys(debt)])].sort();
const rows = families.map((k) => ({ family: k, was: base.debt[k] || 0, now: debt[k] || 0 }))
  .map((r) => ({ ...r, delta: r.now - r.was }));
const newlyMeasured = rows.filter((r) => r.delta > 0 && (base.dormant || []).includes(r.family));
const grown = rows.filter((r) => r.delta > 0 && !(base.dormant || []).includes(r.family));
const paid = rows.filter((r) => r.delta < 0);

if (MODE === "ratchet") {
  const lowered = {};
  for (const r of rows) if (r.now > 0) lowered[r.family] = Math.min(r.was, r.now);
  save({ ...base, ratchetedAt: today(), debt: lowered });
  const saved = rows.reduce((a, r) => a + Math.max(0, r.was - r.now), 0);
  console.log(`Ratcheted: ${saved} warning(s) of debt paid down are now locked out — they cannot come back.`);
  for (const r of paid) console.log(`  ${r.family}: ${r.was} → ${r.now}`);
  if (grown.length) console.log(`\nNOT lowered for ${grown.length} famil(ies) that GREW — fix those first, they are new debt.`);
  process.exit(grown.length ? 1 : 0);
}

const out = { baseline: base.recordedAt, totalNow: total, totalAtAdoption: base.totalAtAdoption, rows, grown, newlyMeasured, blockers };
if (JSON_OUT) { writeSync(1, JSON.stringify(out, null, 2) + "\n"); process.exit(grown.length || blockers ? 1 : 0); }

console.log(`Adoption ratchet — baseline recorded ${base.recordedAt}${base.note ? ` (${base.note})` : ""}\n`);
if (blockers) console.log(`${blockers} BLOCKER(s) — never grandfathered, fix regardless of the baseline.\n`);
if (grown.length) {
  console.log(`NEW DEBT — ${grown.length} famil(ies) grew since adoption. This is the part that fails:`);
  for (const r of grown) console.log(`  ${r.family}: ${r.was} → ${r.now}  (+${r.delta})`);
  console.log(`\nThese came from work done AFTER adoption, so they are held to the full standard.`);
  console.log(`Read them in trace/verify-report.json.\n`);
} else {
  console.log(`No new debt. Everything below predates adoption.\n`);
}
if (paid.length) {
  console.log(`PAID DOWN since adoption:`);
  for (const r of paid) console.log(`  ${r.family}: ${r.was} → ${r.now}  (${r.delta})`);
  console.log(`  Run --ratchet to lock these in so they cannot return.\n`);
}
const carried = rows.filter((r) => r.now > 0 && r.delta === 0);
if (carried.length) {
  console.log(`CARRIED (accepted at adoption, unchanged — not a failure):`);
  for (const r of carried) console.log(`  ${r.family}: ${r.now}`);
}
process.exit(grown.length || blockers ? 1 : 0);
