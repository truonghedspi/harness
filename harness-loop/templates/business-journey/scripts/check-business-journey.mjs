#!/usr/bin/env node
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
const opt = (n, d = null) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const environmentPath = path.resolve(opt("--environment", "business-environment.json"));
const oraclePath = path.resolve(opt("--oracles", "business-oracles"));
const read = (p) => { try { return JSON.parse(readFileSync(p, "utf8")); } catch { return null; } };
const findings = [];
const add = (id, file, message) => findings.push({ id, file, message });
const environment = read(environmentPath);

if (!environment) add("environment-unreadable", environmentPath, "business environment must be valid JSON");
else {
  if (environment.schema !== "business-environment/1") add("environment-schema", environmentPath, "expected schema business-environment/1");
  const iso = environment.isolation || {};
  if (!["namespace-per-run", "tenant-per-run", "account-prefix-per-run"].includes(iso.mode)) add("isolation-mode", environmentPath, "choose an explicit per-run isolation mode");
  if (!iso.runIdEnv || !Array.isArray(iso.derivedResources) || iso.derivedResources.length < 2) add("isolation-unbound", environmentPath, "runIdEnv must derive at least two resources such as namespace, account, topic or consumer group");
  if ((iso.derivedResources || []).some((x) => !String(x).includes(`\${${iso.runIdEnv}}`))) add("fixed-resource", environmentPath, "every derived resource must contain the run ID variable");
  if (environment.readiness?.serviceRegistry !== "services.manifest.json" || !Array.isArray(environment.readiness?.businessConditions) || !environment.readiness.businessConditions.length || environment.readiness.businessConditions.some((x) => /needs human/i.test(x))) add("readiness-incomplete", environmentPath, "readiness needs the service registry plus a real business condition such as reference data/session state/consumer join");
  if (!environment.seed?.command || /needs human/i.test(environment.seed.command) || environment.seed.publicBoundary !== true) add("seed-side-door", environmentPath, "seed through a public setup API/fixture service");
  if (!environment.cleanup?.command || environment.cleanup.idempotent !== true) add("cleanup-not-idempotent", environmentPath, "cleanup must be explicit and idempotent");
  const metrics = environment.telemetry?.metrics || [];
  for (const metric of ["deploymentDuration", "readinessDuration", "scenarioDuration", "eventWaitDuration"])
    if (!metrics.includes(metric)) add("telemetry-missing", environmentPath, `missing ${metric}`);
  if (environment.telemetry?.payloads !== "redacted") add("telemetry-payload", environmentPath, "business payload telemetry must be redacted");
}

const files = existsSync(oraclePath) ? (readdirSync(oraclePath).filter((f) => f.endsWith(".json"))
  .map((f) => path.join(oraclePath, f))) : [];
if (!files.length) add("oracle-missing", oraclePath, "at least one journey oracle is required");
for (const file of files) {
  const oracle = read(file);
  if (!oracle) { add("oracle-unreadable", file, "oracle must be valid JSON"); continue; }
  if (oracle.schema !== "journey-oracle/1" || !/^JRN-[A-Z0-9-]+$/.test(oracle.id || "")) add("oracle-schema", file, "expected journey-oracle/1 and JRN-* id");
  const input = oracle.publicInput || {};
  if (!input.protocol || !input.operation || !input.correlationField) add("public-input-missing", file, "name public protocol, operation and correlation field");
  const observations = Array.isArray(oracle.observations) ? oracle.observations : [];
  if (!observations.length || observations.some((o) => !o.boundary || !o.correlationField)) add("public-observation-missing", file, "each observation needs a public boundary and correlation field");
  if (observations.some((o) => /sql|database|repository|table/i.test(`${o.boundary} ${o.operation || ""}`))) add("internal-oracle", file, "database/repository is diagnostics, not a passing oracle");
  if (!Number.isInteger(oracle.deadlineMs) || oracle.deadlineMs < 1 || oracle.deadlineMs > 300000) add("deadline-missing", file, "eventual assertions need a bounded deadline <=300000ms");
  if (/\bsleep\b/i.test(JSON.stringify(oracle))) add("fixed-sleep", file, "await correlated outcomes; do not synchronize with sleep");
  if (!Array.isArray(oracle.invariants) || !oracle.invariants.length) add("invariant-missing", file, "state at least one independently observable business invariant");
  if (!Array.isArray(oracle.diagnostics) || !oracle.diagnostics.length) add("diagnostics-missing", file, "name diagnostics collected on timeout");
  if (oracle.faultProbe && (!oracle.faultProbe.action || !oracle.faultProbe.recoveryInvariant || !oracle.faultProbe.repeatCommand)) add("fault-proof-incomplete", file, "fault probe needs action, repeated command, and recovery invariant");
}

const report = { schema: "business-journey-check/1", green: findings.length === 0, environment: environmentPath, oracles: files.length, findings };
process.stdout.write(JSON.stringify(report, null, 2) + "\n");
process.exit(findings.length ? 1 : 0);
