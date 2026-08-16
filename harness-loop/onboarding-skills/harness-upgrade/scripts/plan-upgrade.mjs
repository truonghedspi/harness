#!/usr/bin/env node
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
const args = process.argv.slice(2);
const opt = (n, d = null) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const reportFile = opt("--report"), target = path.resolve(opt("--target", ".")), output = opt("--output");
if (!reportFile) { console.error("usage: plan-upgrade.mjs --report dry-run.json --target DIR [--output FILE]"); process.exit(2); }
let report; try { report = JSON.parse(readFileSync(reportFile, "utf8")); } catch (e) { console.error(`invalid report: ${e.message}`); process.exit(2); }
if (report.schema !== "harness-upgrade/1") { console.error("unsupported upgrade report schema"); process.exit(2); }
const known = { "context-interviewer": "user-scope human-interview skill" };
const plan = {
  schema: "harness-upgrade-plan/1", target, sourceReport: path.resolve(reportFile),
  preexistingDirty: null,
  refresh: (report.changed || []).map((file) => ({ file, action: "refresh", status: "planned" })),
  add: (report.added || []).map((file) => ({ file, action: "add", status: "planned" })),
  merge: (report.drifted || []).map((file) => ({ file, action: "semantic-merge", status: "needs-review" })),
  retire: (report.retiredAgents || []).map((agent) => ({ agent, replacement: known[agent] || null,
    statePath: `memory/${agent}`, stateExists: existsSync(path.join(target, "memory", agent)), status: "needs-review" })),
  newAgents: (report.newAgents || []).map((agent) => ({ agent, status: "needs-review" })),
  decisions: [],
  verify: ["target baseline from AGENTS.md", "node tools/gen-agents.mjs --target . --runtime all --check",
    "node tools/verify-harness.mjs --target . --skip-baseline", "node loop/route.mjs --rules"],
};
const text = JSON.stringify(plan, null, 2) + "\n";
if (output) writeFileSync(output, text); else process.stdout.write(text);
