#!/usr/bin/env node
// review-digest.mjs — turn "here is a huge diff" into "here are the N decisions to judge".
//
// The harness converts the human's job from generating to evaluating everywhere a DECISION is
// involved (questions arrive with a recommended answer, designs arrive with options and a
// recommendation). It did nothing for the largest thing an agent produces: code. A human facing
// four thousand generated lines is back to generating — reconstructing intent from source — which
// is exactly the expensive mode this harness exists to avoid.
//
// So: do not review the diff. Review the decisions embedded in it. Everything else has already
// been checked by something that does not get tired — the verification command ran, the evidence
// replayed, the gates passed. What no machine checked is whether the choices were right, and
// those are few.
//
// This ranks what is worth a human's eye, says why each item ranks there, and states plainly how
// much it is telling you to skip — so the unreviewed remainder is a decision, not an oversight.
//
// Usage:
//   node review-digest.mjs --target DIR [--since <git-ref>] [--mark] [--json]
//     --since   default: the watermark in .review-watermark, else the first commit
//     --mark    record HEAD as reviewed, so the next run shows only what came after
import { readFileSync, writeFileSync, existsSync , writeSync } from "node:fs";
import { execSync } from "node:child_process";
import path from "node:path";

// stdout on a pipe is async: process.exit() drops whatever has not flushed, so a payload
// past the pipe buffer (~8 KB on macOS) is silently truncated for any caller using
// spawnSync. Found when aeron-demo's report crossed that line and adoption-baseline
// started failing to parse its own input. writeSync is the fix everywhere --json exits.
const args = process.argv.slice(2);
const opt = (n, d = null) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const JSON_OUT = args.includes("--json");
const MARK = args.includes("--mark");
const requestedTarget = path.resolve(opt("--target", "."));
const TARGET = existsSync(path.join(requestedTarget, "harness", "feature_list.json")) ? path.join(requestedTarget, "harness") : requestedTarget;
const P = (...p) => path.join(TARGET, ...p);
const WATERMARK = P(".review-watermark");

const git = (cmd, fallback = "") => {
  try { return execSync(`git ${cmd}`, { cwd: TARGET, encoding: "utf8", maxBuffer: 32e6 }).trim(); }
  catch { return fallback; }
};
const readJSON = (p) => { try { return JSON.parse(readFileSync(p, "utf8")); } catch { return null; } };

const head = git("rev-parse HEAD");
let since = opt("--since");
if (!since && existsSync(WATERMARK)) since = readFileSync(WATERMARK, "utf8").trim();
if (!since) since = git("rev-list --max-parents=0 HEAD").split("\n")[0];
const range = since && since !== head ? `${since}..HEAD` : null;

// --- what changed ------------------------------------------------------------------------------
const numstat = range ? git(`diff --numstat ${range}`) : "";
const changed = numstat.split("\n").filter(Boolean).map((l) => {
  const [add, del, file] = l.split("\t");
  return { file, add: Number(add) || 0, del: Number(del) || 0 };
});
const totalAdded = changed.reduce((a, f) => a + f.add, 0);
const commits = range ? git(`log ${range} --pretty=format:"%h %s"`).split("\n").filter(Boolean) : [];

const isTest = (f) => /(^|\/)(test|tests|spec)s?\//i.test(f) || /(Test|IT|SIT|_test|\.spec)\.\w+$/.test(f);
const isCode = (f) => /\.(java|mjs|js|ts|py|go|kt|rb|cs|rs)$/.test(f) && !isTest(f);
const isDoc = (f) => f.endsWith(".md") || f.endsWith(".json");

// --- decisions recorded in the range -------------------------------------------------------------
const decisionDiff = range ? git(`diff ${range} -- DECISIONS.md DECISIONS/`) : "";
const newDecisions = decisionDiff.split("\n").filter((l) => /^\+## /.test(l)).map((l) => l.slice(4).trim());
const assumptionDiff = range ? git(`diff ${range} -- docs/assumptions.md`) : "";
// Rows inside an HTML comment (e.g. the "delete this comment once the table has real content"
// example) are documentation, not live assumptions — skip them so a stale example can't be ranked
// as a needs-human row. Track comment state across diff lines rather than per-line.
const newAssumptions = [];
{
  let inComment = false;
  for (const l of assumptionDiff.split("\n")) {
    const body = l.startsWith("+") ? l.slice(1) : l;
    if (/<!--/.test(body)) inComment = true;
    if (/-->/.test(body)) { inComment = false; continue; }
    if (inComment) continue;
    if (l.startsWith("+|") && !/^\+\|\s*id\s*\|/.test(l) && !/^\+\|[\s|:-]+\|$/.test(l)) {
      newAssumptions.push(l.slice(1).split("|").slice(1, 4).map((c) => c.trim()));
    }
  }
}
const policyDiff = range ? git(`diff ${range} -- docs/cross-cutting.md`) : "";
const newPolicies = policyDiff.split("\n")
  .filter((l) => /^\+\|\s*X-\d/.test(l))
  .map((l) => l.slice(1).split("|").slice(1, 4).map((c) => c.trim()));
const ruleDiff = range ? git(`diff ${range} -- docs/constraints.md`) : "";
const newRules = ruleDiff.split("\n").filter((l) => /^\+-\s+MUST/.test(l)).map((l) => l.slice(1).trim());

// --- rank what deserves a human's eye -------------------------------------------------------------
const fl = readJSON(P("feature_list.json"));
const features = fl?.features || [];
const items = [];
const push = (weight, kind, what, why, ask) => items.push({ weight, kind, what, why, ask });
const promotedFeatures = [];

for (const f of features) {
  const notes = String(f.checkerNotes || "");
  const promoted = /mechanically promoted/.test(notes);
  const status = String(f.status || f.state);
  if (!["done", "passing", "blocked"].includes(status)) continue;

  if (promoted) promotedFeatures.push(f);
  if ((f.attempts || 0) > 1) {
    push(4, "struggled", f.id,
      `took ${f.attempts}/${f.maxAttempts} attempts — repeated failure usually means a judgement call was made under pressure`,
      "Read its evidence trail: what was changed to make it pass, and was that the right change?");
  }
  if (/^REJECT\b/.test(notes.trim())) {
    push(4, "contested", f.id,
      "a checker rejected it at least once before it landed",
      "The disagreement was resolved by an agent — do you agree with how?");
  }
  if (status === "blocked") {
    push(5, "blocked", f.id, "blocked — the loop cannot move it without you",
      "Is this genuinely irreducible, or is there an experiment nobody ran?");
  }
}
for (const p of newPolicies) {
  const undecided = /not yet decided|needs decision|^—?$/i.test(p[2] || "");
  push(undecided ? 5 : 2, "policy", p[0] || "X-?",
    undecided ? `a cross-cutting policy is OPEN: ${p[1] || ""}` : `a cross-cutting policy was decided: ${p[1] || ""}`,
    undecided ? "Every feature inherits this. Nobody has chosen yet — you are the only one who can."
              : `Mechanism: ${p[2]} — you already chose this; confirm it still reads right.`);
}
for (const a of newAssumptions) {
  const st = (a[2] || "").toLowerCase();
  // A verified assumption already passed through a human; an unverified one has not.
  const w = st.startsWith("verified") ? 1 : st.includes("needs-human") ? 5 : 3;
  push(w, "assumption", a[0] || "A-?", `assumption added (${a[2] || "status?"}): ${a[1] || ""}`,
    st.startsWith("verified") ? "Already verified — skim only if the wording drifted."
      : "If this is false, what breaks — and is it actually true?");
}
// Mechanically promoted features all carry the SAME gap (command passed, nobody judged the
// claim), and there are usually many. Seventeen identical entries is the wall this tool exists to
// remove — so group them, and nominate the few worth spot-checking: the longest behaviour
// sentences, because a long claim is a claim with more places to be subtly wrong.
if (promotedFeatures.length) {
  const worst = promotedFeatures
    .slice().sort((a, b) => String(b.behavior || "").length - String(a.behavior || "").length)
    .slice(0, 3);
  push(3, "unreviewed-claims", `${promotedFeatures.length} feature(s) promoted with no semantic review`,
    "their commands exited 0, which proves the test passes — not that the behaviour claimed is the behaviour you wanted",
    `Spot-check these three first (longest claims, most room to be subtly wrong): ` +
      worst.map((f) => f.id).join(", "));
}

// Rules and decisions are numerous and individually small: group them rather than listing each.
if (newRules.length) {
  push(3, "new-rules", `${newRules.length} new MUST/MUST NOT rule(s)`,
    "every agent now obeys these forever, and they spend the instruction budget the load-bearing rules need",
    `Read them together in docs/constraints.md — are all ${newRules.length} worth carrying?`);
}
if (newDecisions.length) {
  push(2, "decisions", `${newDecisions.length} decision(s) recorded`,
    "each carries its rejected alternatives, which is where disagreement usually lives",
    "Skim the rejected options in DECISIONS.md — would you have chosen differently anywhere?");
}
// Code that changed with no test alongside it, in the same range.
const codeFiles = changed.filter((c) => isCode(c.file));
const testTouched = changed.some((c) => isTest(c.file));
for (const c of codeFiles.filter((c) => c.add > 120)) {
  push(2, "bulk", `${c.file} (+${c.add})`,
    "a large single-file addition — bulk is where an unreviewed assumption hides easiest",
    "Skim its public surface only: are the names and boundaries ones you would have chosen?");
}
if (codeFiles.length && !testTouched) {
  push(4, "untested-change", `${codeFiles.length} code file(s)`,
    "production code changed in this range with no test file touched",
    "What proves this works? If the answer is 'the existing tests', is that enough?");
}

items.sort((a, b) => b.weight - a.weight);

const skipped = Math.max(0, totalAdded - items.filter((i) => i.kind === "bulk")
  .reduce((a, i) => a + (Number((i.what.match(/\+(\d+)/) || [])[1]) || 0), 0));

const out = {
  target: TARGET, range: range || "(nothing new)", head, since,
  volume: { commits: commits.length, filesChanged: changed.length, linesAdded: totalAdded },
  items,
};

if (MARK) { writeFileSync(WATERMARK, head + "\n"); }
if (JSON_OUT) { writeSync(1, JSON.stringify(out, null, 2) + "\n"); process.exit(0); }

console.log(`Review digest — ${TARGET}`);
console.log(`Range: ${range || "(nothing since the last mark)"}\n`);
if (!range) { console.log("Nothing new since the last review. Run with --since <ref> to look further back."); process.exit(0); }
console.log(`The machine already checked: every feature's verification command ran, evidence replayed,`);
console.log(`and the gates passed. ${commits.length} commit(s), ${changed.length} file(s), ${totalAdded} lines added.\n`);

if (!items.length) {
  console.log("Nothing here needs your judgement: no policy, assumption, rule, contested claim or");
  console.log("struggled feature in this range. The code is mechanically verified — skip it.");
} else {
  const DETAIL = 10;
  const shown = items.slice(0, DETAIL), rest = items.slice(DETAIL);
  console.log(`${items.length} item(s) need your judgement. The ${shown.length} most consequential, in full:\n`);
  for (const [i, it] of shown.entries()) {
    console.log(`${String(i + 1).padStart(2)}. [${it.kind}] ${it.what}`);
    console.log(`    why here: ${it.why}`);
    console.log(`    → ${it.ask}\n`);
  }
  if (rest.length) {
    const byKind = {};
    for (const it of rest) byKind[it.kind] = (byKind[it.kind] || 0) + 1;
    console.log(`Plus ${rest.length} lower-consequence item(s), grouped: ` +
      Object.entries(byKind).map(([k, v]) => `${k} ×${v}`).join(", "));
    console.log(`Run with --json for the full list — but if you only have an hour, the ${DETAIL} above`);
    console.log(`are where a wrong call costs the most.\n`);
  }
  console.log(`Everything else in these ${totalAdded} added lines is deliberately not on this list:`);
  console.log(`it is mechanically verified, and re-reading it would spend your attention on the part`);
  console.log(`a machine already covered. Run with --mark once you are done to move the watermark.`);
}
