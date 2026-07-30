#!/usr/bin/env node
// coverage-check.mjs — the 100%-coverage gate.
// Fails (exit 1) when any inventory unit is unmapped, any exclusion lacks human approval,
// any done feature lacks evidence, or any covered unit's source has drifted since spec time.
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const readJson = (p) => JSON.parse(readFileSync(path.join(root, p), "utf8"));

const invPath = "inventory/inventory.json";
if (!existsSync(path.join(root, invPath))) {
  console.log("coverage-check: no inventory yet (feat-001 pending) — gate inactive.");
  process.exit(0);
}

const inventory = readJson(invPath);
const featureList = readJson("feature_list.json");
const exclusions = existsSync(path.join(root, "inventory/exclusions.json"))
  ? readJson("inventory/exclusions.json").exclusions ?? []
  : [];

const violations = [];
const warnings = [];

const unitById = new Map(inventory.units.map((u) => [u.unitId, u]));

// 1. Exclusions must reference real units and carry human approval.
const approvedExcluded = new Set();
for (const ex of exclusions) {
  if (!unitById.has(ex.unitId)) warnings.push(`exclusion for unknown unit: ${ex.unitId}`);
  if (!ex.reason) violations.push(`exclusion without reason: ${ex.unitId}`);
  if (!ex.approvedBy) violations.push(`exclusion NOT human-approved yet: ${ex.unitId}`);
  else approvedExcluded.add(ex.unitId);
}

// 2. Every unit must be mapped to a feature (or approved-excluded).
const coveredBy = new Map(); // unitId -> feature
for (const f of featureList.features) {
  for (const u of f.sourceUnits ?? []) {
    if (coveredBy.has(u)) violations.push(`unit mapped twice: ${u} (${coveredBy.get(u).id}, ${f.id})`);
    coveredBy.set(u, f);
    if (!unitById.has(u)) warnings.push(`${f.id} references unknown unit: ${u}`);
  }
}
const unmapped = inventory.units.filter(
  (u) => !coveredBy.has(u.unitId) && !approvedExcluded.has(u.unitId)
);
for (const u of unmapped) violations.push(`unmapped unit (no feature, no approved exclusion): ${u.unitId}`);

// 3. Done features need reproducible evidence; all mapped features need drift check.
let doneUnits = 0;
for (const f of featureList.features) {
  const units = f.sourceUnits ?? [];
  if (f.status === "done") {
    const ev = f.evidence;
    if (!ev || !ev.command || !ev.outputDigest || !ev.date) {
      violations.push(`${f.id} is done without complete evidence {command,outputDigest,date}`);
    }
    doneUnits += units.length;
  }
  for (const u of units) {
    const current = unitById.get(u);
    const recorded = f.sourceHashes?.[u];
    if (!current) continue;
    if (recorded && recorded !== current.sourceHash) {
      violations.push(`DRIFT: ${u} changed in TimesTen since spec (${f.id}) — reopen to specced`);
    }
    if (!recorded && ["specced", "golden-mastered", "implemented", "parity-verified", "done"].includes(f.pipeline ?? "")) {
      warnings.push(`${f.id}: no sourceHash recorded for ${u} — drift undetectable`);
    }
  }
}

// 4. Report.
const denom = inventory.units.length - approvedExcluded.size;
const pct = denom === 0 ? 100 : ((doneUnits / denom) * 100).toFixed(1);
console.log(`coverage: ${doneUnits}/${denom} units done (${pct}%), ` +
  `${approvedExcluded.size} approved exclusions, ${unmapped.length} unmapped`);
for (const w of warnings) console.log(`  WARN: ${w}`);
for (const v of violations) console.log(`  VIOLATION: ${v}`);
process.exit(violations.length ? 1 : 0);
