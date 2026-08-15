#!/usr/bin/env node
// Deterministic half of feature-planning capability: structure, DAG, traceability and handoff.
// Semantic completeness remains an independent reviewer's job.
import { readFileSync, readdirSync, statSync, writeSync } from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
const opt = (n, d = null) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const flag = (n) => args.includes(n);
const target = path.resolve(opt("--target", "."));
const planPath = path.resolve(target, opt("--plan", "feature_list.json"));
const designDir = path.resolve(target, opt("--design-dir", "docs/design"));
const findings = [];
const add = (id, feature, message, severity = "error") => findings.push({ id, feature: feature || null, severity, message });
const read = (p) => { try { return readFileSync(p, "utf8"); } catch { return ""; } };
let plan;
try { plan = JSON.parse(readFileSync(planPath, "utf8")); }
catch (e) { console.error(`error: cannot read plan ${planPath}: ${e.message}`); process.exit(2); }
const features = Array.isArray(plan.features) ? plan.features : [];
if (!features.length) add("features-empty", null, "plan has no features");

const required = ["id", "name", "behavior", "verification", "falsifier", "dependencies", "status",
  "readyForCheck", "evidence", "checkerNotes", "attempts", "maxAttempts"];
const placeholder = /REPLACE|TODO|TBD|looks right|manually (?:check|inspect)|fill (?:this|me)/i;
const ids = new Map();
const statusAllowed = new Set(["not-started", "active", "blocked", "in-progress", "passing", "done"]);
const baseline = (f) => f.id === "feat-001" || /baseline/i.test(String(f.name || ""));

features.forEach((f, index) => {
  const id = String(f.id || `#${index}`);
  for (const key of required) if (!(key in f)) add("required-field", id, `missing ${key}`);
  if (ids.has(id)) add("id-duplicate", id, `duplicate id (first at index ${ids.get(id)})`);
  else ids.set(id, index);
  if (!baseline(f) && !["build", "prove"].includes(f.kind)) add("kind-missing", id, "non-baseline feature needs kind build|prove");
  if (!String(f.behavior || "").trim() || placeholder.test(String(f.behavior || ""))) add("behavior-unready", id, "behavior is empty or placeholder prose");
  if (!String(f.verification || "").trim() || placeholder.test(String(f.verification || ""))) add("verification-unready", id, "verification is not a runnable command");
  if (!String(f.falsifier || "").trim() || placeholder.test(String(f.falsifier || ""))) add("falsifier-missing", id, "falsifier is empty or placeholder prose");
  if (!Array.isArray(f.dependencies)) add("dependencies-invalid", id, "dependencies must be an array");
  if (!statusAllowed.has(f.status)) add("status-invalid", id, `unknown status ${String(f.status)}`);
  if (typeof f.readyForCheck !== "boolean") add("ready-invalid", id, "readyForCheck must be boolean");
  if (!Number.isInteger(f.attempts) || f.attempts < 0) add("attempts-invalid", id, "attempts must be a non-negative integer");
  if (!Number.isInteger(f.maxAttempts) || f.maxAttempts < 1) add("max-attempts-invalid", id, "maxAttempts must be a positive integer");
  if (!baseline(f)) {
    const touches = f.context && f.context.touches;
    if (!Array.isArray(touches) || touches.length < 1 || touches.length > 3 || touches.some((x) => !String(x).trim()))
      add("context-touches", id, "context.touches must name 1–3 paths");
    if (!f.context || !String(f.context.note || "").trim()) add("context-note", id, "context.note must preserve the implementation handoff");
  }
  for (const dep of Array.isArray(f.dependencies) ? f.dependencies : []) {
    const depIndex = features.findIndex((x) => x.id === dep);
    if (depIndex < 0) add("dependency-missing", id, `dependency ${dep} does not exist`);
    else if (depIndex >= index) add("dependency-order", id, `dependency ${dep} must appear earlier in the plan`);
  }
});

// Independent proof shape.
for (const f of features.filter((x) => x.kind === "build")) {
  const proves = features.filter((p) => p.kind === "prove" && Array.isArray(p.dependencies) && p.dependencies.includes(f.id));
  if (!proves.length) add("build-unproven", f.id, "no prove feature depends on this build feature");
}
for (const f of features.filter((x) => x.kind === "prove")) {
  const deps = (f.dependencies || []).map((id) => features.find((x) => x.id === id)).filter(Boolean);
  if (!deps.some((d) => d.kind === "build")) add("prove-without-build", f.id, "prove feature depends on no build feature");
}

// Cycle check remains useful even though dependency-order also fails forward references.
const graph = new Map(features.map((f) => [f.id, Array.isArray(f.dependencies) ? f.dependencies : []]));
const visiting = new Set(), visited = new Set();
const visit = (id, trail = []) => {
  if (visiting.has(id)) { add("dependency-cycle", id, `cycle: ${[...trail, id].join(" -> ")}`); return; }
  if (visited.has(id) || !graph.has(id)) return;
  visiting.add(id); for (const dep of graph.get(id)) visit(dep, [...trail, id]); visiting.delete(id); visited.add(id);
};
for (const id of graph.keys()) visit(id);

// Traceability becomes strict once the design declares its first invariant ID.
const designFiles = [];
const walk = (dir) => { try { for (const e of readdirSync(dir)) { const p = path.join(dir, e); statSync(p).isDirectory() ? walk(p) : designFiles.push(p); } } catch {} };
walk(designDir);
const invariantIds = new Set(designFiles.flatMap((p) => [...read(p).matchAll(/\bINV-[A-Z][A-Z0-9-]*-\d+\b/g)].map((m) => m[0])));
const cited = new Set();
if (invariantIds.size) {
  for (const f of features.filter((x) => !baseline(x))) {
    const refs = [...String(f.falsifier || "").matchAll(/\[(INV-[A-Z][A-Z0-9-]*-\d+)\]/g)].map((m) => m[1]);
    if (!refs.length) add("invariant-citation-missing", f.id, "design declares invariants but falsifier cites none");
    for (const ref of refs) { cited.add(ref); if (!invariantIds.has(ref)) add("falsifier-orphan", f.id, `${ref} is not declared by the design`); }
  }
  for (const inv of invariantIds) if (!cited.has(inv)) add("invariant-uncovered", null, `${inv} is cited by no feature falsifier`);
}

// Duplicate same-role proof means two paid dispatches claim the same evidence. Build/prove sharing
// is allowed because it is the intentional generator/evaluator split.
const commands = new Map();
for (const f of features.filter((x) => !baseline(x))) {
  const key = `${f.kind}:${String(f.verification || "").trim()}`;
  if (!key.endsWith(":")) {
    if (commands.has(key)) add("verification-duplicate", f.id, `same ${f.kind} verification as ${commands.get(key)}`);
    else commands.set(key, f.id);
  }
}

const result = { schema: "feature-planning-check/1", plan: planPath, green: findings.length === 0,
  counts: { features: features.length, errors: findings.filter((f) => f.severity === "error").length,
    warnings: findings.filter((f) => f.severity === "warn").length }, findings };
if (flag("--json")) writeSync(1, JSON.stringify(result, null, 2) + "\n");
else {
  console.log(`Feature plan check — ${planPath}`);
  for (const f of findings) console.log(`  ${f.severity.toUpperCase()} [${f.id}]${f.feature ? ` ${f.feature}` : ""}: ${f.message}`);
  console.log(`\n${result.green ? "PASS" : "FAIL"}: ${features.length} feature(s), ${findings.length} finding(s)`);
}
process.exit(result.green ? 0 : 1);
