#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const checker = path.resolve(here, "../scripts/check-plan.mjs");
const cases = [
  { name: "valid", code: 0, includes: [] },
  { name: "orphan-build", code: 1, includes: ["build-unproven"] },
  { name: "invented-invariant", code: 1, includes: ["falsifier-orphan"] }
];
let failed = 0;
for (const c of cases) {
  const target = path.join(here, "fixtures", c.name);
  const r = spawnSync(process.execPath, [checker, "--target", target, "--json"], { encoding: "utf8" });
  let report = null; try { report = JSON.parse(r.stdout); } catch {}
  const ids = new Set((report && report.findings || []).map((f) => f.id));
  const ok = r.status === c.code && c.includes.every((id) => ids.has(id));
  console.log(`${ok ? "PASS" : "FAIL"} ${c.name}${report ? ` — ${report.findings.length} finding(s)` : " — no JSON report"}`);
  if (!ok) failed++;
}
process.exit(failed ? 1 : 0);
