#!/usr/bin/env node
// context-budget.mjs — how much every agent is actually made to read before it does anything.
//
// Nobody was measuring this. Rules and resources get added one justified item at a time, and the
// total is only ever discovered by an agent quietly following the top-N and dropping the rest
// (references/llm-failure-modes.md: instruction-load degradation, lost in the middle).
//
// Reports, per agent: total lines auto-loaded, the biggest contributors, how many rules it must
// actually remember (mechanically-enforced ones don't count — they cannot be violated silently),
// and whether the position-sensitive slots are used well: rules at the START, goal/memory at the
// END, bulk structured data in the middle where U-shaped recall costs least.
//
// Usage: node context-budget.mjs --target DIR [--json] [--budget N]
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
const opt = (n, d = null) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const JSON_OUT = args.includes("--json");
const TARGET = path.resolve(opt("--target", "."));
const BUDGET = Number(opt("--budget", 1200));   // lines auto-loaded before the agent starts work

const P = (...p) => path.join(TARGET, ...p);
const lines = (p) => { try { return readFileSync(p, "utf8").split("\n").length; } catch { return null; } };
const read = (p) => { try { return readFileSync(p, "utf8"); } catch { return ""; } };
const ENFORCED = /(verify-harness|check-coverage|init\.sh|gate\b|`[\w-]+\.mjs`|mechanically|enforced)/i;

const rulesRaw = read(P("docs", "constraints.md")).split("\n").filter((l) => /^\s*-\s+MUST\b/.test(l));
const mustRemember = rulesRaw.filter((l) => !ENFORCED.test(l));

const agentsDir = P(".kiro", "agents");
let files = [];
try { files = readdirSync(agentsDir).filter((f) => f.endsWith(".json")).sort(); } catch { files = []; }

const report = [];
for (const f of files) {
  let j; try { j = JSON.parse(read(path.join(agentsDir, f))); } catch { continue; }
  const rel = (u) => String(u).replace(/^file:\/\/(\.\.\/)*/, "");
  const parts = [];
  for (const r of j.resources || []) {
    const p = rel(r);
    const n = lines(P(p));
    if (n !== null) parts.push({ p, n });
  }
  const promptRel = rel(j.prompt || "");
  const promptLines = lines(P(promptRel)) || 0;
  const total = parts.reduce((a, b) => a + b.n, 0) + promptLines;

  // Position check: is the most instruction-dense material at the edges?
  const first2 = parts.slice(0, 3).map((x) => x.p);   // router + rules + the role's own contract
  const last2 = parts.slice(-2).map((x) => x.p);
  const rulesAtStart = first2.some((p) => /constraints\.md$/.test(p));
  const memoryAtEnd = last2.some((p) => /MEMORY\.md$/.test(p));
  // v1 of this flag said "the biggest file is prose", which became true for every agent the moment
  // the bulk JSON moved out — a check that fires on everything is noise, not signal. What is
  // actually actionable: a LARGE PROSE file parked in the middle third, where U-shaped recall is
  // worst. Rules, role contracts and memory belong at the edges; only skimmable data belongs here.
  const mid = parts.slice(3, Math.max(3, parts.length - 2));
  const buriedProse = mid.filter((x) => x.n > 200 && !/\.json$/.test(x.p));   // a wall of prose, not an ordinary doc
  const biggest = parts.slice().sort((a, b) => b.n - a.n)[0] || null;

  report.push({
    agent: j.name || f, total, promptLines,
    top: parts.slice().sort((a, b) => b.n - a.n).slice(0, 3),
    rulesAtStart, memoryAtEnd, biggest, buriedProse,
    overBudget: total > BUDGET,
  });
}

function buriedLabel(r) {
  return r.buriedProse.length
    ? `buried-prose: ${r.buriedProse.map((x) => `${x.p}(${x.n})`).join(" ")}`
    : "";
}

const out = {
  target: TARGET, budget: BUDGET,
  rules: { total: rulesRaw.length, mustRemember: mustRemember.length, enforced: rulesRaw.length - mustRemember.length },
  agents: report,
};
if (JSON_OUT) { console.log(JSON.stringify(out, null, 2)); process.exit(0); }

console.log(`Context budget — ${TARGET}   (budget ${BUDGET} lines auto-loaded per agent)\n`);
console.log(`Rules in docs/constraints.md: ${rulesRaw.length} total — ` +
  `${mustRemember.length} to remember, ${rulesRaw.length - mustRemember.length} mechanically enforced\n`);
for (const r of report) {
  const flags = [
    r.overBudget ? "OVER-BUDGET" : "",
    r.rulesAtStart ? "" : "rules-not-at-start",
    r.memoryAtEnd ? "" : "memory-not-at-end",
    buriedLabel(r),
  ].filter(Boolean);
  console.log(`${flags.length ? "!" : " "} ${r.agent.padEnd(23)} ${String(r.total).padStart(5)} lines` +
    (flags.length ? `   ${flags.join(", ")}` : ""));
  if (flags.length) {
    console.log(`      heaviest: ${r.top.map((t) => `${t.p} (${t.n})`).join(", ")}`);
  }
}
const worst = report.filter((r) => r.overBudget).length;
console.log(`\n${worst} agent(s) over budget. Remedies, in order of value: promote a rule to a gate ` +
  `(it stops counting), split an oversized doc, or drop a resource the role does not actually need.`);
