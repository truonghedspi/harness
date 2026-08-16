#!/usr/bin/env node
// Validate paired capability experiments before their results are trusted.
import { readFileSync } from "node:fs";
const p = process.argv[2];
if (!p) { console.error("usage: check-capability-eval.mjs <contract.json>"); process.exit(2); }
let c; try { c = JSON.parse(readFileSync(p, "utf8")); } catch (e) { console.error(e.message); process.exit(2); }
const errors = [];
const arms = Array.isArray(c.arms) ? c.arms : [];
if (arms.length < 2) errors.push("arms: paired evaluation needs at least two arms");
if (c.resourceOwning) {
  const mode = c.isolation?.mode;
  if (!["serialized", "per-run-port", "namespace-per-run"].includes(mode)) errors.push("isolation-mode: resource-owning arms must serialize or allocate per-run resources");
  if (!String(c.isolation?.key || "").trim()) errors.push("isolation-key: record the port/namespace/resource key");
}
for (const [i, claim] of (c.claims || []).entries()) {
  if (!claim.boundary || !claim.verificationBoundary) errors.push(`claim-${i}: boundary and verificationBoundary are required`);
  else if (claim.boundary !== claim.verificationBoundary) errors.push(`claim-${i}: ${claim.verificationBoundary} proof cannot establish ${claim.boundary} behavior`);
  if (claim.boundary === "publication" && !(claim.productionTouchpoints || []).length) errors.push(`claim-${i}: publication proof must name a production publisher touchpoint`);
}
if (errors.length) { for (const e of errors) console.error(`FAIL ${e}`); process.exit(1); }
console.log(`PASS ${arms.length} arms; isolation=${c.isolation?.mode || "none"}; ${(c.claims || []).length} claim(s)`);
