#!/usr/bin/env node
// harness-config.mjs — read/write the harness's local runtime config (env/local.json).
//
// env/local.json is the gitignored, machine-specific half of harness configuration: how THIS
// machine runs the harness, as opposed to scope (feature_list.json), decisions (DECISIONS.md) or
// shared facts (memory/). It currently holds one knob — the orchestrator's dispatch mode
// (`runMode`: native-spawn | script-dispatch) — and is deliberately schema'd so more env fields
// (Java/Maven home, Kubernetes context, redacted API-key presence) can land here without a new
// format. It is a runtime knob, not a rule and not a fact: a machine-level default the user sets,
// which the orchestrator reports and can change.
//
// Usage:
//   node tools/harness-config.mjs --json               print the whole config
//   node tools/harness-config.mjs get <key>            print one value (empty when unset)
//   node tools/harness-config.mjs set <key> <value>    set one value, write the file
import { readFileSync, writeFileSync, existsSync, mkdirSync, writeSync } from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
const cmd = args[0];
const requestedTarget = process.cwd();
const root = existsSync(path.join(requestedTarget, "harness", "feature_list.json"))
  ? path.join(requestedTarget, "harness") : requestedTarget;

const FILE = path.join(root, "env", "local.json");
// env/local.json is also written by tools/environment.mjs --capture (schema harness-environment/1,
// java/maven/kubernetes/utilities/apiKeys). This tool only reads/writes the runMode knob and must
// never clobber those fields, so `set` merges into the existing object instead of replacing it.
const SCHEMA = "harness-environment/1";
// The only knob today, with its closed set of values. Strict on purpose: a config the model can
// hand-edit freely becomes a place it can silently invent state, which is exactly what a schema'd,
// tool-mediated file exists to prevent.
const KEYS = { runMode: new Set(["native-spawn", "script-dispatch"]) };

const read = () => {
  try { return JSON.parse(readFileSync(FILE, "utf8")); }
  catch { return { schema: SCHEMA, runMode: "native-spawn" }; }
};
const out = (s) => writeSync(1, (s.endsWith("\n") ? s : s + "\n"));

if (cmd === "--json") {
  out(JSON.stringify(read(), null, 2));
  process.exit(0);
}

if (cmd === "get") {
  const key = args[1];
  const cfg = read();
  out(cfg[key] === undefined || cfg[key] === null ? "" : String(cfg[key]));
  process.exit(0);
}

if (cmd === "set") {
  const [key, value] = [args[1], args[2]];
  if (!key || value === undefined) { out("usage: node tools/harness-config.mjs set <key> <value>"); process.exit(2); }
  const allowed = KEYS[key];
  if (!allowed) { out(`unknown key "${key}" — known keys: ${Object.keys(KEYS).join(", ")}`); process.exit(2); }
  if (!allowed.has(value)) { out(`"${value}" is not a valid ${key} — expected one of: ${[...allowed].join(", ")}`); process.exit(2); }
  const cfg = read();
  cfg[key] = value;   // merge: preserve environment.mjs's java/maven/kubernetes/... fields
  mkdirSync(path.dirname(FILE), { recursive: true });
  writeFileSync(FILE, JSON.stringify(cfg, null, 2) + "\n");
  out(`set ${key}=${value}`);
  process.exit(0);
}

out("usage: node tools/harness-config.mjs --json | get <key> | set <key> <value>");
process.exit(2);
