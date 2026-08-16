#!/usr/bin/env node
import { readFileSync } from "node:fs";
const file = process.argv[2];
if (!file) { console.error("usage: check-upgrade-plan.mjs <upgrade-plan.json>"); process.exit(2); }
let p; try { p = JSON.parse(readFileSync(file, "utf8")); } catch (e) { console.error(`invalid plan: ${e.message}`); process.exit(2); }
const findings = [], add = (id, message) => findings.push({ id, message });
if (p.schema !== "harness-upgrade-plan/1" || !p.target || !p.sourceReport) add("plan-incomplete", "schema, target and sourceReport are required");
for (const m of p.merge || []) if (!['merged','kept-target','approved-skip'].includes(m.status)) add("drift-unresolved", `${m.file} remains ${m.status}`);
for (const r of p.retire || []) {
  if (!r.replacement) add("retirement-unrouted", `${r.agent} has no documented replacement`);
  if (!['retired','kept-approved'].includes(r.status)) add("retirement-unresolved", `${r.agent} remains ${r.status}`);
  if (r.stateExists && !r.stateDisposition) add("retirement-state-unhandled", `${r.agent} has state but no disposition`);
}
if (!(p.verify || []).length) add("verification-missing", "an upgrade needs target and harness verification commands");
if (p.preexistingDirty === null || p.preexistingDirty === undefined) add("dirty-state-unrecorded", "record whether the target was dirty before upgrade");
process.stdout.write(JSON.stringify({ schema: "harness-upgrade-plan-check/1", green: findings.length === 0, findings }, null, 2) + "\n");
process.exit(findings.length ? 1 : 0);
