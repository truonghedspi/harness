#!/usr/bin/env node
// services-check.mjs — is the service registry complete enough to stand the system up?
//
// This is a *verification command*, not a report: it exits non-zero while the registry still has
// holes, so a feature can name it and the loop cannot mark that feature done by talking about it.
// The holes it looks for are the ones collect-services.mjs deliberately refuses to guess
// (references/multi-service.md): a fabricated health check makes the environment report ready and
// the test fail somewhere less obvious, so the collector leaves them null and this gate keeps them
// visible until a human answers.
//
// Usage:
//   node tools/services-check.mjs [--manifest services.manifest.json] [--json]
//
// Exit codes: 0 complete · 1 incomplete (the normal red) · 2 the manifest itself is unusable.
import { readFileSync, existsSync } from "node:fs";
import { writeSync } from "node:fs";

const args = process.argv.slice(2);
const opt = (n, d = null) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const MANIFEST = opt("--manifest", "services.manifest.json");
const JSON_OUT = args.includes("--json");

if (!existsSync(MANIFEST)) {
  process.stderr.write(`services-check: no manifest at ${MANIFEST}\n` +
    `Run: node tools/collect-services.mjs --roots <dir>[,<dir>...] --out ${MANIFEST}\n`);
  process.exit(2);
}
let manifest;
try { manifest = JSON.parse(readFileSync(MANIFEST, "utf8")); }
catch (e) { process.stderr.write(`services-check: ${MANIFEST} is not valid JSON — ${e.message}\n`); process.exit(2); }

const services = Array.isArray(manifest.services) ? manifest.services : null;
if (!services) { process.stderr.write(`services-check: ${MANIFEST} has no services array\n`); process.exit(2); }

const deployable = services.filter((s) => s.kind === "service");
const gaps = [];
const push = (id, field, why, how) => gaps.push({ id, field, why, how });

for (const s of deployable) {
  if (!s.chart) {
    push(s.id, "chart", "no Helm chart, so this service cannot be deployed at all",
      "point `chart` at the chart directory, or write one");
  }
  if (!s.image) {
    push(s.id, "image", "no Dockerfile — a cluster cannot start what cannot be built into an image",
      "this is prerequisite engineering work, not a field to fill in. It is listed so it is scheduled, not discovered mid-run");
  }
  const health = typeof s.health === "string" ? s.health : (s.health && s.health.command);
  if (!health) {
    push(s.id, "health", "readiness is unverified — `helm --wait` only proves the pod is Running",
      "a command proving the service SERVES, with $NAMESPACE and $RELEASE available. If you cannot determine it from the chart, say so rather than writing a plausible one");
  }
  if (s.dependsOn === null || s.dependsOn === undefined) {
    push(s.id, "dependsOn", "install order is unstated, so it is being taken as 'no dependencies'",
      "[] if it genuinely has none — an explicit empty list is an answer, null is a blank");
  }
}

// Structural problems are not gaps in someone's knowledge; they make the manifest unusable.
const ids = new Set(services.map((s) => s.id));
const dangling = deployable.flatMap((s) => (s.dependsOn || []).filter((d) => !ids.has(d)).map((d) => `${s.id} -> ${d}`));
const incomplete = services.filter((s) => s.kind === "incomplete").map((s) => s.id);

const ok = gaps.length === 0 && dangling.length === 0;

if (JSON_OUT) {
  writeSync(1, JSON.stringify({ schema: "services-check/1", manifest: MANIFEST,
    services: services.length, deployable: deployable.length, ok, gaps, dangling, incomplete }, null, 2) + "\n");
  process.exit(ok ? 0 : 1);
}

const out = [];
out.push(`\nservices-check — ${MANIFEST}`);
out.push(`  ${deployable.length} deployable service(s) of ${services.length} entr(ies)\n`);
if (dangling.length) {
  out.push(`  BROKEN  dependsOn names ${dangling.length} service(s) not in the registry:`);
  for (const d of dangling) out.push(`          ${d}`);
  out.push("");
}
if (incomplete.length) {
  out.push(`  NOTE    ${incomplete.length} module(s) classified 'incomplete' — service-shaped dependencies, no entry point.`);
  out.push(`          Not counted as deployable: ${incomplete.join(", ")}\n`);
}
if (gaps.length) {
  const byId = new Map();
  for (const g of gaps) { if (!byId.has(g.id)) byId.set(g.id, []); byId.get(g.id).push(g); }
  for (const [id, list] of byId) {
    out.push(`  ${id}`);
    for (const g of list) { out.push(`    - ${g.field}: ${g.why}`); out.push(`      → ${g.how}`); }
  }
  out.push("");
  out.push(`  ${gaps.length} gap(s). These are the fields the collector will not guess. Until they are`);
  out.push(`  answered, a green cross-service test may have run against a service that was never up.`);
} else if (ok) {
  out.push("  complete — every deployable service has a chart, an image, a health command and a stated dependsOn.");
}
writeSync(1, out.join("\n") + "\n");
process.exit(ok ? 0 : 1);
