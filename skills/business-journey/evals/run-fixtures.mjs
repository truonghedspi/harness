#!/usr/bin/env node
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const checker = path.resolve(here, "..", "scripts", "check-business-journey.mjs");
const root = mkdtempSync(path.join(tmpdir(), "business-journey-fixture-"));
const run = () => spawnSync(process.execPath, [checker, "--environment", path.join(root, "business-environment.json"), "--oracles", path.join(root, "business-oracles")], { encoding: "utf8" });
try {
  mkdirSync(path.join(root, "business-oracles"));
  writeFileSync(path.join(root, "business-environment.json"), JSON.stringify({ schema: "business-environment/1",
    isolation: { mode: "namespace-per-run", runIdEnv: "RUN_ID", derivedResources: ["sit-${RUN_ID}", "orders-${RUN_ID}", "consumer-${RUN_ID}"] },
    readiness: { serviceRegistry: "services.manifest.json", businessConditions: ["reference data loaded", "matching session open"] },
    seed: { command: "journey-driver seed", publicBoundary: true }, cleanup: { command: "journey-driver cleanup", idempotent: true },
    telemetry: { metrics: ["deploymentDuration", "readinessDuration", "scenarioDuration", "eventWaitDuration", "retryCount", "diagnosticsCollected"], payloads: "redacted" } }, null, 2));
  writeFileSync(path.join(root, "business-oracles", "match.json"), JSON.stringify({ schema: "journey-oracle/1", id: "JRN-ORDER-MATCH", requirement: "REQ-ORDER-001",
    publicInput: { protocol: "FIX", operation: "NewOrderSingle", correlationField: "ClOrdID" },
    observations: [{ boundary: "trade-event", operation: "TradePublished", correlationField: "ClOrdID" }, { boundary: "order-query-api", operation: "GET /orders/{id}", correlationField: "orderId" }],
    invariants: ["exactly one execution id", "filled plus remaining equals original quantity"], deadlineMs: 30000,
    diagnostics: ["namespace events", "correlated service logs"], faultProbe: { action: "restart matching pod", repeatCommand: true, recoveryInvariant: "same ClOrdID creates no second trade" } }, null, 2));
  const green = run(); if (green.status !== 0) throw new Error(`good fixture failed: ${green.stdout}`);
  const bad = JSON.parse(readFileSync(path.join(root, "business-oracles", "match.json"), "utf8"));
  bad.observations = [{ boundary: "orders database table", correlationField: "id" }]; bad.deadlineMs = 0; bad.faultProbe = { action: "restart" };
  bad.diagnostics = ["sleep 5 then inspect database"];
  writeFileSync(path.join(root, "business-oracles", "match.json"), JSON.stringify(bad));
  const red = run(); if (red.status === 0 || !/internal-oracle/.test(red.stdout) || !/deadline-missing/.test(red.stdout) || !/fault-proof-incomplete/.test(red.stdout)) throw new Error(`bad fixture escaped: ${red.stdout}`);
  process.stdout.write("business-journey fixtures: green accepts, broken distributed oracle rejects\n");
} finally { rmSync(root, { recursive: true, force: true }); }
