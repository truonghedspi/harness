#!/usr/bin/env node
// Phase 1 of integration-project init: collect cheap facts, then ask only consequential gaps.
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const args = process.argv.slice(2);
const opt = (n, d = null) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const target = opt("--target");
const roots = opt("--roots");
const journey = opt("--journey");
if (!target || !roots || !journey) {
  console.error("usage: init-integration-project.mjs --target DIR --roots DIR[,DIR...] --journey \"business outcome\"");
  process.exit(2);
}

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const targetRoot = path.resolve(target);
const collected = path.join(targetRoot, "inventory", "integration-context");
mkdirSync(collected, { recursive: true });
const manifestPath = path.join(collected, "services.discovered.json");
const run = spawnSync(process.execPath, [path.join(scriptDir, "collect-services.mjs"), "--roots", roots, "--out", manifestPath], { encoding: "utf8" });
if (run.status !== 0) { process.stderr.write(run.stderr || run.stdout); process.exit(run.status || 1); }
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const services = manifest.services.filter((s) => s.kind === "service");
if (!services.length) { console.error("error: collection found no deployable services"); process.exit(1); }

const evidence = (s, fields) => ({
  source: s.path,
  observed: Object.fromEntries(fields.map((f) => [f, s[f] ?? null])),
  rules: s.rules || [],
});
const q = [];
const add = (x) => q.push({ required: true, status: "unanswered", ...x });
for (const s of services) {
  if (!s.health) add({ id: `service.${s.id}.health`, context: "service-readiness", ownerHint: `owner of ${s.id}`,
    question: `Which executable check proves ${s.id} is serving this journey, beyond Pod Ready?`,
    why: "The harness must not begin the journey while the process is alive but its business endpoint/session is unusable.",
    evidence: evidence(s, ["chart", "evidence"]),
    answer: { type: "object", requiredFields: ["command", "successMeans"], example: { command: "curl -fsS http://service/ready", successMeans: "HTTP 200 after reference data is loaded" } },
    impact: "Blocks environment readiness and feat-registry." });
  if (s.dependsOn == null) add({ id: `service.${s.id}.dependsOn`, context: "deployment-topology", ownerHint: `owner of ${s.id} or platform owner`,
    question: `Which services must be ready before ${s.id}, specifically for “${journey}”?`,
    why: "Repository dependencies do not establish deployment order or journey scope; an explicit empty list is meaningful.",
    evidence: evidence(s, ["stack", "chart"]),
    answer: { type: "array", items: "service-id", allowedValues: services.map((x) => x.id), allowEmpty: true },
    impact: "Blocks dependency-ordered environment startup." });
}
add({ id: "journey.command", context: "public-input-seam", ownerHint: "business/API owner",
  question: `Through which public interface does a real client start “${journey}”, and how is this run correlated?`,
  why: "The test must drive supported behavior, not insert database state or invoke an internal class.",
  evidence: { journey, discoveredServices: services.map((s) => s.id) },
  answer: { type: "object", requiredFields: ["service", "protocol", "operation", "correlationField", "successAcknowledgement"], example: { service: services[0].id, protocol: "HTTP", operation: "POST /orders", correlationField: "clientOrderId", successAcknowledgement: "202 with orderId" } },
  impact: "Defines the driver contract; blocks business-oracle generation." });
add({ id: "journey.observations", context: "public-outcome-seams", ownerHint: "business/event owners",
  question: `Which public observations independently prove the complete outcome of “${journey}”?`,
  why: "A command acknowledgement proves acceptance, not the cross-service business outcome. Database queries are diagnostics only.",
  evidence: { journey, discoveredServices: services.map((s) => s.id) },
  answer: { type: "array", minItems: 1, itemRequiredFields: ["service", "protocol", "source", "correlationField", "expected"], example: [{ service: services.at(-1).id, protocol: "event", source: "trades", correlationField: "clientOrderId", expected: "one matched trade" }] },
  impact: "Defines convergence and exactly-once assertions; blocks the Level-4 oracle." });
add({ id: "journey.seed", context: "test-data", ownerHint: "business/data owner",
  question: `How can the test create the minimum preconditions for “${journey}” through an approved public boundary?`,
  why: "Hidden SQL fixtures couple the test to internals and usually fail under production-like permissions.",
  evidence: { journey }, answer: { type: "object", requiredFields: ["command", "publicBoundary", "createdResources", "cleanupCommand"] },
  impact: "Blocks repeatable setup and cleanup." });
add({ id: "journey.isolation", context: "parallel-safety", ownerHint: "platform/test owner",
  question: `Which identifiers and resources must be unique per run so two executions of “${journey}” cannot collide?`,
  why: "Namespaces isolate Kubernetes objects but not external accounts, topics, FIX sessions, consumer groups, or idempotency keys.",
  evidence: { default: "namespace-per-run", runIdEnv: "HARNESS_RUN_ID" },
  answer: { type: "object", requiredFields: ["mode", "derivedResources"], example: { mode: "namespace-per-run", derivedResources: ["account-${HARNESS_RUN_ID}", "consumer-${HARNESS_RUN_ID}"] } },
  impact: "Blocks parallel execution and reliable retries." });

const request = { schema: "integration-init-request/1", target: targetRoot, roots: roots.split(",").map((x) => path.resolve(x.trim())), journey };
const plan = { schema: "integration-collection-plan/1", strategy: "inventory-then-focused-human-review", materialized: [path.relative(targetRoot, manifestPath)], deferredUntilAnswers: ["contract-specific source materialization", "scaffold", "business oracle"] };
const questions = { schema: "integration-init-questions/1", requestDigest: createHash("sha256").update(JSON.stringify(request)).digest("hex"), generatedFrom: path.relative(targetRoot, manifestPath), questions: q };
writeFileSync(path.join(collected, "request.json"), JSON.stringify(request, null, 2) + "\n");
writeFileSync(path.join(collected, "collection-plan.json"), JSON.stringify(plan, null, 2) + "\n");
writeFileSync(path.join(collected, "questions.json"), JSON.stringify(questions, null, 2) + "\n");
const md = ["# Integration init — human review", "", `Journey: **${journey}**`, "", "Answer in `answers.json`. Each question explains why repository evidence is insufficient and what it blocks.", "", ...q.flatMap((x, i) => [
  `## ${i + 1}. ${x.question}`, "", `- ID: \`${x.id}\``, `- Context: ${x.context}`, `- Suggested owner: ${x.ownerHint}`, `- Why: ${x.why}`, `- Evidence: \`${JSON.stringify(x.evidence)}\``, `- Expected answer: \`${JSON.stringify(x.answer)}\``, `- If unanswered: ${x.impact}`, "",
])];
writeFileSync(path.join(targetRoot, "integration-init-review.md"), md.join("\n"));
if (!existsSync(path.join(targetRoot, "answers.json"))) writeFileSync(path.join(targetRoot, "answers.json"), JSON.stringify({ schema: "integration-init-answers/1", requestDigest: questions.requestDigest, answers: Object.fromEntries(q.map((x) => [x.id, { value: null, answeredBy: null, rationale: null }])) }, null, 2) + "\n");
console.log(`COLLECTION COMPLETE — HUMAN INPUT REQUIRED\n${q.length} contextual question(s): ${path.join(targetRoot, "integration-init-review.md")}\nFill ${path.join(targetRoot, "answers.json")}, then run finalize-integration-init.mjs.`);
