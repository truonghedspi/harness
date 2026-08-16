#!/usr/bin/env node
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
const here = path.dirname(fileURLToPath(import.meta.url));
const checker = path.resolve(here, "..", "scripts", "check-quality-strategy.mjs");
const root = mkdtempSync(path.join(tmpdir(), "quality-strategy-"));
const run = () => spawnSync(process.execPath, [checker], { cwd: root, encoding: "utf8" });
try {
  mkdirSync(path.join(root, "business-oracles"));
  writeFileSync(path.join(root, "business-oracles", "j.json"), JSON.stringify({ id: "JRN-ORDER-MATCH" }));
  const good = { schema: "test-risk/1", capabilities: [{ id: "CAP-ORDER-MATCH", componentIds: ["gateway", "matching"], risks: [{ id: "RISK-ORDER-CORRECTNESS", attribute: "correctness", consequence: "high", likelihood: "medium", detectability: "low", stakeholders: ["trading"], riskReason: "duplicate trades create financial loss", requiredScope: "journey", oracleIds: ["JRN-ORDER-MATCH"], answeredBy: "trading owner" }] }], verifications: [{ id: "JRN-ORDER-MATCH", scope: "journey", size: "large", hermetic: false, network: "cluster", maxSeconds: 300, isolation: "namespace", stage: "staging", owner: "trading-sit", cleanupEvidence: "business-environment.json" }] };
  writeFileSync(path.join(root, "test-risk.json"), JSON.stringify(good));
  if (run().status !== 0) throw new Error("valid risk portfolio was rejected");
  const uncovered = structuredClone(good); uncovered.capabilities[0].risks[0].oracleIds = [];
  writeFileSync(path.join(root, "test-risk.json"), JSON.stringify(uncovered));
  const r1 = run(); if (r1.status === 0 || !/high-risk-uncovered/.test(r1.stdout)) throw new Error("uncovered material risk escaped");
  const mislabeled = structuredClone(good); mislabeled.verifications[0].size = "small";
  writeFileSync(path.join(root, "test-risk.json"), JSON.stringify(mislabeled));
  const r2 = run(); if (r2.status === 0 || !/small-unsafe/.test(r2.stdout) || !/cluster-not-large/.test(r2.stdout)) throw new Error("mislabeled cluster test escaped");
  process.stdout.write("quality-strategy fixtures: valid accepts; uncovered risk and unsafe size reject\n");
} finally { rmSync(root, { recursive: true, force: true }); }
