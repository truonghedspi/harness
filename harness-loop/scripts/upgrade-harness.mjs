#!/usr/bin/env node
// upgrade-harness.mjs — bring an existing target up to the current skill, without touching its work.
//
// `setup-harness-loop.mjs` never overwrites, so a target scaffolded months ago silently keeps the
// old machinery; `--force` overwrites everything, including the project's own content. Neither is
// an upgrade. So targets get hand-synced file by file, which is how aeron-demo ended up running a
// route.mjs from before three routing fixes, and with check-coverage.mjs at BOTH the repo root and
// tools/ — the stale root copy shadowing the newer one, two tools giving opposite answers.
//
// The split below is the whole design:
//
//   REFRESH  machinery the skill owns. Overwritten. If you edited one of these, your edit belongs
//            in the skill, not in one target — that is the same rule the generated agent files
//            follow, for the same reason.
//   REPORT   files seeded from a template and then legitimately customised per project: prompts,
//            the router doc, the manifest, init.mjs's verification block. Never overwritten; drift
//            is reported so a human can merge deliberately ("merge, don't overwrite",
//            adopting-an-existing-project.md).
//
// Usage:
//   node upgrade-harness.mjs --target DIR [--dry-run] [--json]
import { readFileSync, writeFileSync, existsSync, mkdirSync, chmodSync, readdirSync, statSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const args = process.argv.slice(2);
const opt = (n, d = null) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const TARGET = path.resolve(opt("--target", "."));
const DRY = args.includes("--dry-run");
const JSON_OUT = args.includes("--json");
const SKILL = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const read = (p) => { try { return readFileSync(p, "utf8"); } catch { return null; } };
const T = (...p) => path.join(TARGET, ...p);
const S = (...p) => path.join(SKILL, ...p);

if (!existsSync(T("feature_list.json"))) {
  console.error(`${TARGET} does not look like a harness target (no feature_list.json).`);
  console.error("To scaffold a new one: node scripts/setup-harness-loop.mjs --target DIR");
  process.exit(2);
}

// --- what the skill owns ---------------------------------------------------------------------
const refresh = [];
// Every tools/*.mjs the skill ships, taken from setup's own copy list so the two cannot disagree.
for (const m of (read(S("scripts", "setup-harness-loop.mjs")) || "")
  .matchAll(/\["(scripts\/[\w.-]+|references\/[\w.-]+)",\s*"([\w./-]+)"\]/g)) {
  refresh.push([m[1], m[2]]);
}
// Loop machinery. NOT the prompts beside them — those are customised per project.
for (const f of ["route.mjs", "run-loop.mjs", "run-loop.sh", "run-loop.cmd", "dispatch.mjs", "dispatch.sh", "dispatch.cmd", "approval-gate.mjs"]) {
  if (existsSync(S("templates", "tree", "loop", f))) refresh.push([`templates/tree/loop/${f}`, `loop/${f}`]);
}
// The init wrappers carry no logic by design, so they are safe to overwrite. init.mjs is NOT here:
// it holds the project's own verification block.
for (const f of ["init.sh", "init.cmd"]) {
  if (existsSync(S("templates", "tree", f))) refresh.push([`templates/tree/${f}`, f]);
}
refresh.push(["scripts/check-coverage.mjs", "check-coverage.mjs"]);   // the root copy setup writes

const report = [
  ["templates/tree/AGENTS.md", "AGENTS.md"],
  ["templates/tree/agents.manifest.json", "agents.manifest.json"],
  ["templates/tree/init.mjs", "init.mjs"],
  ...readdirSync(S("templates", "tree", "prompts")).filter((f) => f.endsWith(".md"))
    .map((f) => [`templates/tree/prompts/${f}`, `prompts/${f}`]),
  ...["maker-prompt.md", "checker-prompt.md", "goal.md"]
    .filter((f) => existsSync(S("templates", "tree", "loop", f)))
    .map((f) => [`templates/tree/loop/${f}`, `loop/${f}`]),
];

// --- do it ------------------------------------------------------------------------------------
const changed = [], added = [], same = [], drifted = [], missing = [];
for (const [src, dst] of refresh) {
  const from = read(S(src));
  if (from === null) continue;                       // skill does not ship it in this version
  const cur = read(T(dst));
  if (cur === from) { same.push(dst); continue; }
  (cur === null ? added : changed).push(dst);
  if (DRY) continue;
  mkdirSync(path.dirname(T(dst)), { recursive: true });
  writeFileSync(T(dst), from);
  if (/\.(sh|mjs)$/.test(dst)) { try { chmodSync(T(dst), 0o755); } catch { /* windows */ } }
}
// Setup substitutes {{PROJECT_NAME}} and friends, so a byte comparison marks every prompt on every
// target as drifted — including a scaffold created a minute ago. That is a report nobody reads.
// Compare placeholder-tolerantly instead: the template becomes a pattern in which each {{TOKEN}}
// may be anything, and only a difference OUTSIDE the substitutions counts as customisation.
const isPureSubstitution = (template, actual) => {
  const rx = new RegExp("^" + template
    .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    .replace(/\\\{\\\{[A-Z_]+\\\}\\\}/g, "[\\s\\S]*?") + "$");
  return rx.test(actual);
};
for (const [src, dst] of report) {
  const from = read(S(src)), cur = read(T(dst));
  if (from === null) continue;
  if (cur === null) { missing.push(dst); continue; }
  if (cur === from) continue;
  let pure = false;
  try { pure = isPureSubstitution(from, cur); } catch { pure = false; }   // pathological regex
  if (!pure) drifted.push(dst);
}

// Agents the skill now defines that this target's manifest never heard of — the orchestrator, when
// it was added, is exactly this case. Config, so reported rather than merged.
const skillManifest = (() => { try { return JSON.parse(read(S("templates", "tree", "agents.manifest.json"))); } catch { return null; } })();
const targetManifest = (() => { try { return JSON.parse(read(T("agents.manifest.json"))); } catch { return null; } })();
const newAgents = (skillManifest && targetManifest)
  ? skillManifest.agents.filter((a) => !targetManifest.agents.some((b) => b.name === a.name)).map((a) => a.name)
  : [];
const retiredAgents = (skillManifest && targetManifest)
  ? targetManifest.agents.filter((a) => !skillManifest.agents.some((b) => b.name === a.name)).map((a) => a.name)
  : [];

// Regenerate what is generated, so the refresh actually takes effect.
const ran = [];
if (!DRY) {
  for (const [tool, argv] of [["tools/gen-agents.mjs", ["--target", TARGET, "--runtime", "all"]],
                              ["tools/feature-digest.mjs", ["--target", TARGET]]]) {
    if (!existsSync(T(tool))) continue;
    const r = spawnSync(process.execPath, [T(tool), ...argv], { cwd: TARGET, encoding: "utf8" });
    ran.push(`${tool} → exit ${r.status}`);
  }
}

if (JSON_OUT) {
  process.stdout.write(JSON.stringify({ schema: "harness-upgrade/1", target: TARGET, dryRun: DRY,
    changed, added, same: same.length, drifted, missing, newAgents, retiredAgents, regenerated: ran }, null, 2) + "\n");
  process.exit(0);
}
const out = [];
out.push("");
out.push(`Upgrade ${path.basename(TARGET)} from ${path.basename(SKILL)}${DRY ? "   (dry run)" : ""}`);
out.push("");
out.push(`  refreshed   ${changed.length} changed, ${added.length} added, ${same.length} already current`);
for (const f of [...changed.map((f) => `~ ${f}`), ...added.map((f) => `+ ${f}`)].slice(0, 24)) out.push(`      ${f}`);
if (changed.length + added.length > 24) out.push(`      … and ${changed.length + added.length - 24} more`);
if (ran.length) { out.push(""); out.push(`  regenerated ${ran.join(", ")}`); }
if (drifted.length) {
  out.push("");
  out.push(`  DRIFTED — customised here, NOT overwritten. Review and merge what you want:`);
  for (const f of drifted) out.push(`      ${f}`);
  out.push(`      diff one with:  diff ${SKILL}/templates/tree/<file> ${TARGET}/<file>`);
}
if (missing.length) { out.push(""); out.push(`  absent here: ${missing.join(", ")}`); }
if (newAgents.length) {
  out.push("");
  out.push(`  NEW AGENTS the skill defines and this target's manifest lacks: ${newAgents.join(", ")}`);
  out.push(`      copy the entry from ${S("templates", "tree", "agents.manifest.json")},`);
  out.push(`      then: node tools/gen-agents.mjs --target . --runtime all`);
}
if (retiredAgents.length) {
  out.push("");
  out.push(`  RETIRED AGENTS still declared by this target: ${retiredAgents.join(", ")}`);
  out.push(`      remove those manifest entries after merging their replacement capability,`);
  out.push(`      then: node tools/gen-agents.mjs --target . --runtime all`);
}
out.push("");
out.push("  Next: run the baseline gate, then `node tools/verify-harness.mjs --target . --skip-baseline`.");
out.push("");
process.stdout.write(out.join("\n") + "\n");
