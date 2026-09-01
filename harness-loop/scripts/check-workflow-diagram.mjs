#!/usr/bin/env node
// check-workflow-diagram.mjs — the mechanical half of "the diagrams are current".
//
// A diagram that lags the code is worse than no diagram: it is read as authoritative, and the
// reader has no way to tell. The existing `graph-stale` gate compares mtimes, which is a proxy —
// it fires after any git checkout rewrites both files in the same second, and stays silent when
// someone edits a rule and the diagram in one commit without touching the workflow.
//
// This reads CONTENT instead, and asks three questions the diagrams must be able to answer:
//
//   1. every agent in agents.manifest.json appears in some diagram
//        — an agent nobody drew is a node the picture forgot
//   2. every node loop/route.mjs can return appears in some diagram
//        — the router is the control flow; a destination it can reach and the picture cannot is
//          exactly the "implicit edge" class that produced a livelock (graph-closed-edges.md)
//   3. every layer loop/route.mjs can return appears in some diagram
//        — layers are the vocabulary of rollback. A new layer is a new kind of return edge, and it
//          is the change most likely to land without anyone opening a diagram
//
// What it deliberately does NOT check: whether an arrow is still right. No script can read a
// picture's meaning, and pretending otherwise would make a green run mean less than it does.
//
// Usage:
//   node scripts/check-workflow-diagram.mjs [--dir references] [--json]
//   exit 0 = every required name appears somewhere; 1 = something is missing; 2 = cannot check
import { readFileSync, readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const args = process.argv.slice(2);
const opt = (n, d = null) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const JSON_OUT = args.includes("--json");
const skillRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DIR = path.resolve(opt("--dir", path.join(skillRoot, "references")));

const read = (p) => { try { return readFileSync(p, "utf8"); } catch { return null; } };

// Only files whose name says they are a workflow picture. A name mentioned in prose elsewhere in
// the skill is not the same as a name drawn in the workflow, and counting prose would make this
// gate pass on a repo where the diagrams were deleted.
const files = readdirSync(DIR).filter((f) => /^workflow[-.]/.test(f) && f.endsWith(".md"));
if (!files.length) {
  console.error(`no workflow-*.md under ${DIR} — nothing to check`);
  process.exit(2);
}
// Only what is inside a ```mermaid fence counts as DRAWN. Prose mentioning an agent is not the
// same as the picture containing it, and a substring match over whole files is worse than loose —
// it is silently wrong: "diagnosis" matches the path `loop/diagnosis/README.md` in a sentence, so
// removing the diagnosis node from every diagram left this gate green when it was first written.
const drawn = files.map((f) => read(path.join(DIR, f)) || "")
  .flatMap((text) => [...text.matchAll(/```mermaid\n([\s\S]*?)```/g)].map((m) => m[1]))
  .join("\n");
// Whole-token match, so `maker` is not satisfied by `marker-churn`.
const mentions = (name) => new RegExp(`(^|[^A-Za-z0-9-])${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^A-Za-z0-9-]|$)`).test(drawn);
// Layers are matched only through the `LAYER: x` convention the diagrams already use. A bare word
// like `design` appears inside `design-facilitator` and would make every layer trivially present.
const layersDrawn = new Set([...drawn.matchAll(/LAYER:\s*([a-z][a-z-]*)/g)].map((m) => m[1]));

const findings = [];

// --- 1. agents ---------------------------------------------------------------------------------
const manifestPath = path.join(skillRoot, "templates", "tree", "agents.manifest.json");
const manifest = (() => { try { return JSON.parse(read(manifestPath)); } catch { return null; } })();
if (!manifest) {
  console.error(`could not read ${manifestPath}`);
  process.exit(2);
}
for (const agent of manifest.agents || []) {
  if (agent.name && !mentions(agent.name)) {
    findings.push({ kind: "agent", name: agent.name,
      why: "an agent the manifest ships but no workflow diagram draws" });
  }
}

// --- 2 & 3. router nodes and layers --------------------------------------------------------------
// `--rules` prints the table without evaluating any match, so this needs no target state.
const routePath = path.join(skillRoot, "templates", "tree", "loop", "route.mjs");
const rules = spawnSync(process.execPath, [routePath, "--rules", "--json"],
  { encoding: "utf8", maxBuffer: 8 * 1024 * 1024 });
if (rules.status !== 0) {
  console.error(`could not read the routing table from ${routePath}: ${rules.stderr || "no output"}`);
  process.exit(2);
}
let table = [];
try { table = JSON.parse(rules.stdout); } catch {
  console.error("the routing table did not parse as JSON");
  process.exit(2);
}
// `human` and `exit` are terminal states drawn as outcomes, not as named nodes; a diagram showing
// "stop — needs human" satisfies the intent without containing the literal token.
const SKIP_NODES = new Set(["human", "exit"]);
for (const node of [...new Set(table.map((r) => r.node))]) {
  if (SKIP_NODES.has(node) || mentions(node)) continue;
  findings.push({ kind: "node", name: node,
    why: "a destination loop/route.mjs can return that no workflow diagram draws" });
}
for (const layer of [...new Set(table.map((r) => r.layer))]) {
  if (!layer || layer === "-" || layersDrawn.has(layer)) continue;
  findings.push({ kind: "layer", name: layer,
    why: "a rollback layer the router can return that no workflow diagram names" });
}

// --- report -------------------------------------------------------------------------------------
if (JSON_OUT) {
  process.stdout.write(JSON.stringify({
    schema: "workflow-diagram-check/1", dir: DIR, files, green: findings.length === 0, findings,
  }, null, 2) + "\n");
  process.exit(findings.length ? 1 : 0);
}
if (!findings.length) {
  console.log(`workflow diagrams current: ${files.length} file(s) cover every agent, router node and layer.`);
  process.exit(0);
}
console.log(`workflow diagrams are behind the code — ${findings.length} name(s) missing from ${files.join(", ")}:\n`);
for (const f of findings) console.log(`  [${f.kind}] ${f.name}\n      ${f.why}`);
console.log(`\nAdd each to the diagram it belongs in — inside a mermaid fence, since prose mentioning a name`);
console.log(`is not the same as the picture drawing it. Layers are matched through the "LAYER: x" convention.`);
process.exit(1);
