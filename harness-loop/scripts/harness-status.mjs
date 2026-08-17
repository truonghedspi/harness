#!/usr/bin/env node
// Compare an uncommitted contained harness with the exact bytes written at installation time.
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
const opt = (n, d = null) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const root = path.resolve(opt("--target", "."));
const home = existsSync(path.join(root, "harness", "installation.json")) ? path.join(root, "harness") : root;
const manifestPath = path.join(home, "installation.json");
if (!existsSync(manifestPath)) { console.error("no harness/installation.json — re-run setup or upgrade"); process.exit(2); }
const baseline = JSON.parse(readFileSync(manifestPath, "utf8"));
const digest = (p) => createHash("sha256").update(readFileSync(p)).digest("hex");
const files = [];
function walk(dir, prefix = "") {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const rel = prefix ? path.join(prefix, e.name) : e.name;
    if (rel === "installation.json" || rel.startsWith(`trace${path.sep}`) ||
        [path.join("loop", "current.json"), path.join("loop", "route-log.jsonl")].includes(rel)) continue;
    const abs = path.join(dir, e.name);
    if (e.isDirectory()) walk(abs, rel); else files.push(rel.split(path.sep).join("/"));
  }
}
walk(home);
const current = new Set(files);
const modified = [], missing = [], unmanaged = [];
for (const [rel, expected] of Object.entries(baseline.files || {})) {
  const abs = path.join(home, rel);
  if (!existsSync(abs)) missing.push(rel);
  else if (digest(abs) !== expected.sha256) modified.push(rel);
  current.delete(rel);
}
unmanaged.push(...current);
const result = { schema: "harness-status/1", green: !modified.length && !missing.length && !unmanaged.length,
  modified, missing, unmanaged, unchanged: Object.keys(baseline.files || {}).length - modified.length - missing.length };
if (args.includes("--json")) process.stdout.write(JSON.stringify(result, null, 2) + "\n");
else {
  for (const [label, rows] of [["MODIFIED", modified], ["MISSING", missing], ["UNMANAGED", unmanaged]]) {
    if (!rows.length) continue; console.log(`${label} (${rows.length})`); for (const row of rows) console.log(`  ${row}`);
  }
  if (result.green) console.log(`Harness unchanged (${result.unchanged} files).`);
}
process.exit(result.green ? 0 : 1);
