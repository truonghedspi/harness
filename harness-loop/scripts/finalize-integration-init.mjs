#!/usr/bin/env node
// Phase 2: accept typed human decisions, reject incomplete answers, then scaffold.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const args = process.argv.slice(2);
const opt = (n, d = null) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const target = path.resolve(opt("--target", "."));
const answersPath = path.resolve(opt("--answers", path.join(target, "answers.json")));
const base = path.join(target, "inventory", "integration-context");
const read = (p) => JSON.parse(readFileSync(p, "utf8"));
let questions, answers, manifest, request;
try { questions = read(path.join(base, "questions.json")); answers = read(answersPath); manifest = read(path.join(base, "services.discovered.json")); request = read(path.join(base, "request.json")); }
catch (e) { console.error(`error: init artifacts unreadable — ${e.message}`); process.exit(2); }
const errors = [];
if (answers.schema !== "integration-init-answers/1") errors.push("answers.schema must be integration-init-answers/1");
if (answers.requestDigest !== questions.requestDigest) errors.push("answers were created for a different/stale collection request");
const present = (v) => v !== null && v !== undefined && v !== "";
for (const q of questions.questions) {
  const a = answers.answers?.[q.id];
  if (!a || !present(a.value)) { errors.push(`${q.id}: answer value is required — ${q.impact}`); continue; }
  if (!present(a.answeredBy)) errors.push(`${q.id}: answeredBy is required for decision provenance`);
  if (q.answer.type === "object") for (const f of q.answer.requiredFields || []) if (!present(a.value?.[f])) errors.push(`${q.id}: value.${f} is required`);
  if (q.answer.type === "array" && !Array.isArray(a.value)) errors.push(`${q.id}: value must be an array`);
  if (Array.isArray(a.value) && q.answer.minItems && a.value.length < q.answer.minItems) errors.push(`${q.id}: at least ${q.answer.minItems} item(s) required`);
  if (Array.isArray(a.value) && q.answer.allowedValues) for (const v of a.value) if (!q.answer.allowedValues.includes(v)) errors.push(`${q.id}: unknown value ${v}; choose a discovered service ID`);
  if (Array.isArray(a.value) && q.answer.itemRequiredFields) for (const [i, item] of a.value.entries()) for (const f of q.answer.itemRequiredFields) if (!present(item?.[f])) errors.push(`${q.id}: value[${i}].${f} is required`);
}
if (answers.answers?.["journey.seed"]?.value?.publicBoundary !== true) errors.push("journey.seed: value.publicBoundary must be true; internal setup is diagnostics, not a supported test seam");
if (errors.length) { console.error(`HUMAN INPUT INCOMPLETE (${errors.length})\n- ${errors.join("\n- ")}`); process.exit(3); }
const value = (id) => answers.answers[id].value;
for (const s of manifest.services.filter((x) => x.kind === "service")) {
  s.health = answers.answers?.[`service.${s.id}.health`] ? value(`service.${s.id}.health`) : s.health;
  s.dependsOn = answers.answers?.[`service.${s.id}.dependsOn`] ? value(`service.${s.id}.dependsOn`) : s.dependsOn;
}
manifest.collectedAt = new Date().toISOString();
manifest.humanDecisions = { schema: answers.schema, requestDigest: answers.requestDigest, source: path.relative(target, answersPath) };
const finalManifest = path.join(base, "services.resolved.json");
writeFileSync(finalManifest, JSON.stringify(manifest, null, 2) + "\n");
const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const setup = spawnSync(process.execPath, [path.join(scriptDir, "setup-harness-loop.mjs"), "--target", target, "--name", path.basename(target), "--purpose", `Integration proof for ${request.journey}`, "--integration", finalManifest], { encoding: "utf8" });
if (setup.status !== 0) { process.stderr.write(setup.stderr || setup.stdout); process.exit(setup.status || 1); }
writeFileSync(path.join(target, "services.manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
const isolation = value("journey.isolation");
const seed = value("journey.seed");
writeFileSync(path.join(target, "business-environment.json"), JSON.stringify({ schema: "business-environment/1", isolation: { ...isolation, runIdEnv: "HARNESS_RUN_ID" }, readiness: { serviceRegistry: "services.manifest.json", businessConditions: manifest.services.filter((s) => s.kind === "service").map((s) => `${s.id}: ${s.health.successMeans}`) }, seed, cleanup: { command: seed.cleanupCommand, idempotent: true }, telemetry: { metrics: ["deploymentDuration", "readinessDuration", "scenarioDuration", "eventWaitDuration", "retryCount", "diagnosticsCollected"], payloads: "redacted" } }, null, 2) + "\n");
mkdirSync(path.join(target, "business-oracles"), { recursive: true });
const command = value("journey.command");
const observations = value("journey.observations").map((o) => ({ boundary: o.source, operation: o.expected, correlationField: o.correlationField, service: o.service, protocol: o.protocol }));
writeFileSync(path.join(target, "business-oracles", "initial-journey.json"), JSON.stringify({ schema: "journey-oracle/1", id: "JRN-INITIAL-JOURNEY", requirement: request.journey, publicInput: { protocol: command.protocol, operation: command.operation, correlationField: command.correlationField, service: command.service, successAcknowledgement: command.successAcknowledgement }, observations, invariants: ["all observations correlate to the command", "the business outcome appears exactly once"], deadlineMs: 30000, diagnostics: ["correlated pod logs", "namespace events", "internal state for diagnosis only"] }, null, 2) + "\n");
writeFileSync(path.join(base, "answer-receipt.json"), JSON.stringify({ schema: "integration-init-receipt/1", requestDigest: questions.requestDigest, acceptedQuestionIds: questions.questions.map((q) => q.id), finalizedAt: new Date().toISOString() }, null, 2) + "\n");
console.log(`INTEGRATION PROJECT INITIALIZED\nTarget: ${target}\nHuman decisions accepted: ${questions.questions.length}\nNext: review the generated oracle, then run node tools/services-check.mjs.`);
