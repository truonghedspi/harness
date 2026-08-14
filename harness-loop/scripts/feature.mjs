#!/usr/bin/env node
// feature.mjs — read ONE feature out of feature_list.json, without loading the whole file.
//
// The pair to feature_list.digest.md. The digest gives every feature in one line so an agent can
// see the shape cheaply; this gives one feature in full so it does not have to `cat` a thousand-line
// JSON to read a single entry. On a mature project that difference is most of an agent's context:
// aeron-demo's list is 1053 lines and a maker needs about 15 of them.
//
// Usage:
//   node tools/feature.mjs feat-sit-2              the entry, formatted
//   node tools/feature.mjs feat-sit-2 --json       the entry, raw
//   node tools/feature.mjs feat-sit-2 --field falsifier
//   node tools/feature.mjs --status not-started    ids + names only
//   node tools/feature.mjs --ready                 readyForCheck, i.e. waiting on the checker
//   node tools/feature.mjs --blocked-by feat-core  what is waiting on this one
//   node tools/feature.mjs --deps feat-sit-2       its dependencies, and whether each is done
//
// Exit 0 found · 1 no match (so `if node tools/feature.mjs X >/dev/null; then` works) · 2 usage.
import { readFileSync } from "node:fs";
import { writeSync } from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
const has = (f) => args.includes(f);
const opt = (n, d = null) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const TARGET = path.resolve(opt("--target", "."));
const JSON_OUT = has("--json");
const out = (s) => writeSync(1, s.endsWith("\n") ? s : s + "\n");

let list;
try { list = JSON.parse(readFileSync(path.join(TARGET, "feature_list.json"), "utf8")); }
catch (e) { process.stderr.write(`feature.mjs: cannot read feature_list.json — ${e.message}\n`); process.exit(2); }
const features = list.features || [];

const done = (f) => ["done", "passing"].includes(f.status);
const line = (f) => `${f.id}  [${f.status}${f.readyForCheck ? " · ready-for-check" : ""}]  ${f.name || ""}`;

// --- list modes -----------------------------------------------------------------------------
function emitList(sel, label) {
  if (JSON_OUT) { out(JSON.stringify(sel, null, 2)); return sel.length ? 0 : 1; }
  if (!sel.length) { out(`no features ${label}`); return 1; }
  out(`${sel.length} feature(s) ${label}\n`);
  for (const f of sel) out("  " + line(f));
  return 0;
}

if (has("--status")) {
  const want = opt("--status");
  process.exit(emitList(features.filter((f) => f.status === want), `with status=${want}`));
}
if (has("--ready")) {
  process.exit(emitList(features.filter((f) => f.readyForCheck), "waiting on the checker"));
}
if (has("--blocked-by")) {
  const id = opt("--blocked-by");
  process.exit(emitList(features.filter((f) => (f.dependencies || []).includes(id)), `depending on ${id}`));
}

// --- one feature ----------------------------------------------------------------------------
const id = args.find((a) => !a.startsWith("--") && args[args.indexOf(a) - 1] !== "--target"
  && args[args.indexOf(a) - 1] !== "--field" && args[args.indexOf(a) - 1] !== "--status"
  && args[args.indexOf(a) - 1] !== "--blocked-by" && args[args.indexOf(a) - 1] !== "--deps");
const wanted = has("--deps") ? opt("--deps") : id;

if (!wanted) {
  process.stderr.write("usage: feature.mjs <id> [--json] [--field F] | --status S | --ready | " +
    "--deps <id> | --blocked-by <id>\n");
  process.exit(2);
}

const f = features.find((x) => x.id === wanted);
if (!f) {
  // A near-miss is the common case (a typo, or a half-remembered id), so spend a line on it rather
  // than making the caller go read the file after all — which is the thing this exists to avoid.
  // Normalise separators before comparing: "feat-sit2" vs "feat-sit-2" is the typo people actually
  // make, and a plain substring test misses exactly that one.
  const norm = (x) => x.toLowerCase().replace(/[^a-z0-9]/g, "");
  const w = norm(wanted);
  const near = features.map((x) => x.id)
    .filter((x) => { const n = norm(x); return n.includes(w) || w.includes(n); }).slice(0, 5);
  process.stderr.write(`no feature "${wanted}"` + (near.length ? `. Did you mean: ${near.join(", ")}?` : "") + "\n");
  process.exit(1);
}

if (has("--deps")) {
  const deps = (f.dependencies || []).map((d) => {
    const dep = features.find((x) => x.id === d);
    return { id: d, status: dep ? dep.status : "MISSING FROM LIST", satisfied: !!dep && done(dep) };
  });
  if (JSON_OUT) { out(JSON.stringify(deps, null, 2)); process.exit(0); }
  if (!deps.length) { out(`${f.id} has no dependencies — it is eligible on its own`); process.exit(0); }
  out(`${f.id} depends on ${deps.length}:\n`);
  for (const d of deps) out(`  ${d.satisfied ? "ok  " : "WAIT"}  ${d.id.padEnd(28)} ${d.status}`);
  const blocking = deps.filter((d) => !d.satisfied);
  out("");
  out(blocking.length ? `not eligible: ${blocking.map((d) => d.id).join(", ")} not done yet`
    : "every dependency is done — this feature is eligible");
  process.exit(0);
}

if (has("--field")) {
  const k = opt("--field");
  if (!(k in f)) { process.stderr.write(`feature ${f.id} has no field "${k}"\n`); process.exit(1); }
  out(typeof f[k] === "string" ? f[k] : JSON.stringify(f[k], null, 2));
  process.exit(0);
}

if (JSON_OUT) { out(JSON.stringify(f, null, 2)); process.exit(0); }

const L = [];
L.push("");
L.push(`  ${f.id}   ${f.name || ""}`);
L.push(`  status ${f.status}${f.readyForCheck ? "  ·  READY FOR CHECK" : ""}` +
  `   kind ${f.kind || "—"}   attempts ${f.attempts || 0}/${f.maxAttempts || "?"}`);
L.push("");
if (f.behavior) L.push(`  behavior      ${f.behavior}`);
if (f.verification) L.push(`  verification  ${f.verification}`);
if (f.falsifier) L.push(`  falsifier     ${f.falsifier}`);
if ((f.dependencies || []).length) {
  const unmet = f.dependencies.filter((d) => { const x = features.find((y) => y.id === d); return !x || !done(x); });
  L.push(`  dependencies  ${f.dependencies.join(", ")}` + (unmet.length ? `   (waiting on ${unmet.join(", ")})` : "   (all done)"));
}
if (Array.isArray(f.evidence) && f.evidence.length) {
  L.push("  evidence");
  for (const r of f.evidence) {
    L.push(`      ${String(r.date || "?").padEnd(11)} ${String(r.run || "?").padEnd(6)} ${String(r.cmd || "").slice(0, 46)}`);
    if (r.result) L.push(`                  → ${String(r.result).slice(0, 70)}`);
  }
} else if (f.evidence) L.push(`  evidence      ${String(f.evidence).split("\n").join("\n                ")}`);
if (f.checkerNotes) L.push(`  notes         ${String(f.checkerNotes).split("\n").join("\n                ")}`);
L.push("");
out(L.join("\n"));
