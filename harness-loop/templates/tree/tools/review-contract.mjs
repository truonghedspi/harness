#!/usr/bin/env node
// Admission contract between maker and checker. This validates only the public handoff; the
// checker keeps its private probes and remains the sole semantic evaluator.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

const args = process.argv.slice(2);
const featureId = args.find((arg) => !arg.startsWith("--"));
const readyOnly = args.includes("--ready");
const asJson = args.includes("--json");

let list;
try { list = JSON.parse(readFileSync("feature_list.json", "utf8")); }
catch (error) { console.error(`review contract: cannot read feature_list.json: ${error.message}`); process.exit(2); }

const features = (list.features || []).filter((feature) =>
  (!featureId || feature.id === featureId) && (!readyOnly || feature.readyForCheck === true));
if (featureId && !features.length) {
  console.error(`review contract: unknown feature ${featureId}`);
  process.exit(2);
}

export function contractDigest(feature) {
  const input = {
    id: feature.id,
    behavior: feature.behavior || "",
    verification: feature.verification || feature.verify || "",
    falsifier: feature.falsifier || "",
    dependencies: feature.dependencies || [],
    context: feature.context || null,
  };
  return createHash("sha256").update(JSON.stringify(input)).digest("hex");
}

function validate(feature) {
  const packet = feature.reviewPacket;
  const errors = [];
  if (!packet || typeof packet !== "object" || Array.isArray(packet)) {
    return [`${feature.id}: reviewPacket is missing`];
  }
  const digest = contractDigest(feature);
  if (packet.contractDigest !== digest) errors.push(`${feature.id}: contractDigest is stale; expected ${digest}`);
  if (!Array.isArray(packet.claimRefs) || !packet.claimRefs.length || packet.claimRefs.some((v) => !String(v).trim())) {
    errors.push(`${feature.id}: claimRefs must be a non-empty string list`);
  }
  if (!Array.isArray(packet.changedPaths) || !packet.changedPaths.length || packet.changedPaths.some((v) => !String(v).trim())) {
    errors.push(`${feature.id}: changedPaths must be a non-empty string list`);
  }
  if (!Array.isArray(packet.runs) || !packet.runs.length || packet.runs.some((run) =>
    !run || !String(run.cmd || "").trim() || !Number.isInteger(run.exit) || !String(run.result || "").trim())) {
    errors.push(`${feature.id}: runs must contain {cmd, exit, result}`);
  } else if (!packet.runs.some((run) => run.exit === 0 && run.cmd === (feature.verification || feature.verify))) {
    errors.push(`${feature.id}: runs must include the exact feature verification with exit=0`);
  }
  const checks = packet.adversarialChecks;
  for (const key of ["scope", "cleanup", "errorPath", "concurrency", "realBoundary"]) {
    const value = checks && String(checks[key] || "").trim();
    if (!value || (value !== "covered" && !value.startsWith("not-applicable:"))) {
      errors.push(`${feature.id}: adversarialChecks.${key} must be covered or not-applicable: <reason>`);
    }
  }
  if (!Array.isArray(packet.residualUnknowns)) errors.push(`${feature.id}: residualUnknowns must be a list`);
  return errors;
}

const report = features.map((feature) => ({
  id: feature.id,
  contractDigest: contractDigest(feature),
  errors: validate(feature),
}));
if (asJson) process.stdout.write(JSON.stringify(report, null, 2) + "\n");
else for (const row of report) {
  if (row.errors.length) row.errors.forEach((error) => console.error(`SUBMISSION_INCOMPLETE: ${error}`));
  else console.log(`ADMITTED: ${row.id} (${row.contractDigest.slice(0, 12)})`);
}
process.exit(report.some((row) => row.errors.length) ? 1 : 0);
