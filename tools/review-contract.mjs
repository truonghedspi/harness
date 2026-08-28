#!/usr/bin/env node
// Admission contract between maker and checker. This validates only the public handoff; the
// checker keeps its private probes and remains the sole semantic evaluator.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const args = process.argv.slice(2);
const featureId = args.find((arg) => !arg.startsWith("--"));
const readyOnly = args.includes("--ready");
const asJson = args.includes("--json");

// Located from this file, not from cwd. On a contained layout the maker is told to run
// `node harness/tools/review-contract.mjs <id>` from the project root, where "feature_list.json"
// does not exist — so the admission seam the maker needs to set readyForCheck failed with a
// file-not-found instead of reporting anything (HI-065). run-loop.mjs never saw it because it
// spawns with cwd already set to the harness home.
const HOME = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

let list;
try { list = JSON.parse(readFileSync(path.join(HOME, "feature_list.json"), "utf8")); }
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
  // The sixth check is deliberately NOT an enum. The five above ask "did you consider X", which a
  // tick answers. This one asks the question that a green run cannot answer for itself — what a
  // wrong implementation could still do and pass — and a tick is exactly the wrong shape for it: on
  // examples/jdt-mcp-server about twenty-five checker and maker memory entries are all this one
  // lesson (count the mechanisms before you trust the mutant; the positive anchor must itself be
  // mutated; a surviving mutant is equivalent only after you rebuild it; a returned closure needs a
  // case that calls it; a superlative needs two candidates). Every one was caught downstream, by
  // the checker, after the claim was made. Making the maker write the sentence moves it upstream.
  const discrimination = checks && String(checks.discrimination || "").trim();
  if (!discrimination) {
    errors.push(`${feature.id}: adversarialChecks.discrimination is missing — name one wrong ` +
      `implementation your recorded runs would still pass, or state why none exists`);
  } else if (discrimination === "covered" || discrimination.startsWith("not-applicable:") || discrimination.length < 30) {
    errors.push(`${feature.id}: adversarialChecks.discrimination must be a concrete sentence, not a ` +
      `verdict — "${discrimination.slice(0, 40)}" answers nothing. Say what a wrong implementation ` +
      `could do and still pass this verification, or why the runs leave no such gap`);
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
