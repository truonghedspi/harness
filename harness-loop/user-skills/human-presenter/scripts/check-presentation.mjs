#!/usr/bin/env node
import { readFileSync } from "node:fs";
const file = process.argv[2];
if (!file) { console.error("usage: check-presentation.mjs <presentation-plan.json>"); process.exit(2); }
let p; try { p = JSON.parse(readFileSync(file, "utf8")); } catch (e) { console.error(`invalid JSON: ${e.message}`); process.exit(2); }
const findings = [];
const add = (id, message) => findings.push({ id, message });
if (!p.audience || !p.intent || !p.governingThought) add("plan-incomplete", "audience, intent and governingThought are required");
const ids = new Set((p.claims || []).map((c) => c.id));
for (const c of p.claims || []) {
  if (!c.id || !c.text || !c.kind) add("claim-incomplete", "each claim needs id, text and kind");
  if (c.kind === "source-fact" && !(c.sources || []).length) add("source-fact-unbound", `${c.id} has no source`);
  if (c.kind === "inference" && !(c.derivedFrom || []).length) add("inference-unbound", `${c.id} has no derivation`);
  for (const d of c.derivedFrom || []) if (!ids.has(d)) add("derivation-dangling", `${c.id} derives from unknown ${d}`);
}
const visual = p.representation || {};
if (!visual.type || !visual.reason) add("representation-unreasoned", "representation needs type and reason");
if (visual.type !== "prose" && (p.claims || []).length < 3) add("decorative-visual", `${visual.type} is selected for fewer than three claims`);
if (["recommendation", "proposal"].includes(p.intent) && !p.counterCase) add("countercase-missing", "recommendation/proposal needs a credible counter-case");
process.stdout.write(JSON.stringify({ schema: "presentation-check/1", green: findings.length === 0, findings }, null, 2) + "\n");
process.exit(findings.length ? 1 : 0);
