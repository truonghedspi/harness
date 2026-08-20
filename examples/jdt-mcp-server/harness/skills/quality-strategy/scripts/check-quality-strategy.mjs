#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
const opt = (n, d = null) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const riskPath = path.resolve(opt("--risk", "test-risk.json"));
const oracleDir = path.resolve(opt("--oracles", "business-oracles"));
const findings = [];
const add = (id, message, evidence = "") => findings.push({ id, message, evidence });
let model;
try { model = JSON.parse(readFileSync(riskPath, "utf8")); } catch (e) { add("risk-unreadable", "test-risk.json must be valid JSON", e.message); }
const caps = model?.capabilities || [], verifications = model?.verifications || [];
if (model && model.schema !== "test-risk/1") add("risk-schema", "expected schema test-risk/1");
if (!caps.length) add("capability-missing", "record at least one user-visible capability");
if (!verifications.length) add("verification-missing", "record at least one executable verification");
const verificationIds = new Set(verifications.map((v) => v.id));
const oracleIds = new Set();
if (existsSync(oracleDir)) {
  const { readdirSync } = await import("node:fs");
  for (const file of readdirSync(oracleDir).filter((f) => f.endsWith(".json"))) {
    try { const o = JSON.parse(readFileSync(path.join(oracleDir, file), "utf8")); if (o.id) oracleIds.add(o.id); } catch { /* oracle checker owns syntax */ }
  }
}
const cited = new Set();
for (const c of caps) {
  if (!c.id || !Array.isArray(c.componentIds) || !c.componentIds.length) add("capability-unmapped", "every capability needs an id and componentIds", c.id || "unknown");
  if (!Array.isArray(c.risks) || !c.risks.length) add("attribute-missing", "every capability needs at least one quality-attribute risk", c.id || "unknown");
  for (const r of c.risks || []) {
    const riskId = r.id || `${c.id}:unknown`;
    for (const field of ["attribute", "consequence", "likelihood", "detectability", "riskReason", "requiredScope", "answeredBy"])
      if (r[field] === null || r[field] === undefined || r[field] === "") add("risk-decision-incomplete", `${riskId}.${field} is required`, riskId);
    if (!Array.isArray(r.stakeholders) || !r.stakeholders.length) add("risk-decision-incomplete", `${riskId}.stakeholders is required`, riskId);
    const material = r.consequence === "high" || r.likelihood === "high" || r.detectability === "low";
    if (material && (!Array.isArray(r.oracleIds) || !r.oracleIds.length)) add("high-risk-uncovered", `${riskId} is material but has no oracle`, riskId);
    for (const id of r.oracleIds || []) {
      cited.add(id);
      if (!verificationIds.has(id)) add("oracle-verification-missing", `${riskId} cites ${id}, but no verification metadata exists`, id);
      if (r.requiredScope === "contract" || r.requiredScope === "journey") {
        const v = verifications.find((x) => x.id === id);
        if (v && !["contract", "journey"].includes(v.scope)) add("scope-too-narrow", `${id} is ${v.scope}, below required ${r.requiredScope}`, id);
      }
    }
  }
}
for (const v of verifications) {
  if (!cited.has(v.id)) add("verification-unjustified", `${v.id} does not trace to a capability risk`, v.id);
  if (oracleIds.size && !oracleIds.has(v.id)) add("oracle-artifact-missing", `${v.id} has metadata but no executable oracle artifact`, v.id);
  if (!["unit", "component", "contract", "journey"].includes(v.scope)) add("scope-invalid", `${v.id} has invalid scope`, v.scope);
  if (!["small", "medium", "large"].includes(v.size)) add("size-invalid", `${v.id} has invalid size`, v.size);
  if (v.size === "small" && (v.network !== "none" || v.isolation !== "process" || v.hermetic !== true)) add("small-unsafe", `${v.id}: small requires hermetic=true, network=none, isolation=process`, JSON.stringify(v));
  if (v.size === "medium" && !["none", "localhost"].includes(v.network)) add("medium-external-network", `${v.id}: medium cannot use cluster/external network`, v.network);
  if (v.network === "cluster" && v.size !== "large") add("cluster-not-large", `${v.id}: cluster execution must be large`, v.size);
  if (v.size === "large") {
    for (const field of ["owner", "maxSeconds", "isolation", "cleanupEvidence", "stage"])
      if (v[field] === null || v[field] === undefined || v[field] === "") add("large-unowned", `${v.id}.${field} is required for a large test`, v.id);
    if (!Number.isFinite(v.maxSeconds) || v.maxSeconds <= 0) add("large-unbounded", `${v.id} needs a positive maxSeconds`, String(v.maxSeconds));
    if (!["namespace", "tenant", "account-prefix"].includes(v.isolation)) add("large-shared-isolation", `${v.id} needs non-shared isolation`, v.isolation);
    if (!["postsubmit", "staging"].includes(v.stage)) add("large-wrong-stage", `${v.id} belongs in postsubmit or staging`, v.stage);
  }
}
process.stdout.write(JSON.stringify({ schema: "quality-strategy-check/1", green: findings.length === 0, capabilities: caps.length, verifications: verifications.length, findings }, null, 2) + "\n");
process.exit(findings.length ? 1 : 0);
