#!/usr/bin/env node
// iteration-recap.mjs — structured per-iteration outcome record.
//
// Two modes:
//   --snapshot         Save pre-iteration state (git SHA + feature status map).
//   (default)          Compute recap by diffing snapshot against current state.
//                      Appends to loop/iteration-log.jsonl, prints human-readable summary.
//
// The script computes facts from disk; the caller supplies the WHY via --reason.
//
// Usage:
//   node tools/iteration-recap.mjs --snapshot                  # before dispatch
//   node tools/iteration-recap.mjs [--reason "text"] [--json]  # after dispatch
import { readFileSync, writeFileSync, appendFileSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { writeSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
process.chdir(ROOT);

const args = process.argv.slice(2);
const opt = (n, d = null) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const flag = (n) => args.includes(n);
const read = (p) => { try { return readFileSync(p, "utf8"); } catch { return null; } };
const readJSON = (p) => { try { return JSON.parse(readFileSync(p, "utf8")); } catch { return null; } };
const git = (...a) => { const r = spawnSync("git", a, { encoding: "utf8", timeout: 10_000 }); return r.stdout?.trim() || ""; };

const SNAPSHOT_PATH = "loop/pre-iteration-snapshot.json";
const LOG_PATH = "loop/iteration-log.jsonl";

// --- snapshot mode ---------------------------------------------------------------

if (flag("--snapshot")) {
  const fl = readJSON("feature_list.json");
  const features = (fl && fl.features) || [];
  const snapshot = {
    at: new Date().toISOString(),
    gitSha: git("rev-parse", "HEAD"),
    features: features.map((f) => ({ id: f.id, status: f.status, readyForCheck: f.readyForCheck || false })),
  };
  writeFileSync(SNAPSHOT_PATH, JSON.stringify(snapshot, null, 2));
  process.exit(0);
}

// --- recap mode ------------------------------------------------------------------

const snapshot = readJSON(SNAPSHOT_PATH);
if (!snapshot) {
  console.error("iteration-recap: no snapshot found — run with --snapshot before the iteration");
  process.exit(2);
}

const fl = readJSON("feature_list.json");
const features = (fl && fl.features) || [];
const current = readJSON("loop/current.json");

// Feature status delta
const beforeMap = new Map((snapshot.features || []).map((f) => [f.id, f.status]));
const afterMap = new Map(features.map((f) => [f.id, f.status]));
const statusChanges = [];
for (const [id, after] of afterMap) {
  const before = beforeMap.get(id);
  if (before !== after) statusChanges.push({ id, from: before || null, to: after });
}
for (const [id, before] of beforeMap) {
  if (!afterMap.has(id)) statusChanges.push({ id, from: before, to: null });
}

const countByStatus = (list) => {
  const counts = {};
  for (const f of list) counts[f.status] = (counts[f.status] || 0) + 1;
  return counts;
};
const progressOf = (list) => {
  const done = list.filter((f) => f.status === "done").length;
  return { done, total: list.length, remaining: list.length - done };
};

// Git delta since snapshot
const oldSha = snapshot.gitSha || "HEAD";
const filesChanged = git("diff", "--stat", "--name-only", oldSha).split("\n").filter(Boolean);
const uncommitted = git("diff", "--name-only").split("\n").filter(Boolean);
const allChanged = [...new Set([...filesChanged, ...uncommitted])].sort();
const commits = git("log", "--oneline", `${oldSha}..HEAD`).split("\n").filter(Boolean);

// Router next
let next = null;
try {
  const r = spawnSync(process.execPath, ["loop/route.mjs", "--json"], { encoding: "utf8", timeout: 15_000 });
  if (r.stdout) next = JSON.parse(r.stdout);
} catch { /* router unavailable */ }

// Escalation markers
const markers = features
  .filter((f) => /^NEEDS (DESIGN|RE-PLAN|ORACLE FIX):/.test(String(f.checkerNotes || "").split("\n")[0]))
  .map((f) => ({ id: f.id, marker: String(f.checkerNotes || "").split("\n")[0].trim() }));

const entry = {
  schema: "iteration-recap/1",
  iteration: current?.iteration || null,
  at: new Date().toISOString(),
  agent: current?.node || null,
  feature: current?.feature || null,
  layer: next?.layer || null,
  durationMs: (current?.finishedAt && current?.startedAt) ? current.finishedAt - current.startedAt : null,
  delta: {
    statusChanges,
    progressBefore: progressOf(snapshot.features || []),
    progressAfter: progressOf(features),
  },
  filesChanged: allChanged,
  commits,
  next: next ? { node: next.node, layer: next.layer, why: next.why } : null,
  markers,
  reason: opt("--reason"),
};

appendFileSync(LOG_PATH, JSON.stringify(entry) + "\n");

if (flag("--json")) {
  writeSync(1, JSON.stringify(entry, null, 2) + "\n");
} else {
  const pb = entry.delta.progressBefore;
  const pa = entry.delta.progressAfter;
  const lines = [
    `Progress: ${pa.done}/${pa.total} done (${pa.total ? Math.round(100 * pa.done / pa.total) : 0}%), ${pa.remaining} remaining`,
  ];
  if (entry.agent) lines.push(`Agent: ${entry.agent}${entry.feature ? ` → ${entry.feature}` : ""}`);
  if (entry.durationMs != null) lines.push(`Duration: ${Math.round(entry.durationMs / 1000)}s`);
  if (statusChanges.length) {
    lines.push("Changes:");
    for (const c of statusChanges) lines.push(`  ${c.id}: ${c.from || "(new)"} → ${c.to || "(removed)"}`);
  } else {
    lines.push("Changes: none");
  }
  if (pb.done !== pa.done) lines.push(`Progress delta: ${pa.done - pb.done > 0 ? "+" : ""}${pa.done - pb.done} done`);
  if (allChanged.length) lines.push(`Files: ${allChanged.length} changed`);
  if (commits.length) lines.push(`Commits: ${commits.length}`);
  if (entry.next) lines.push(`Next: ${entry.next.node} [${entry.next.layer}]`);
  if (markers.length) lines.push(`Markers: ${markers.map((m) => `${m.id} ${m.marker}`).join("; ")}`);
  if (entry.reason) lines.push(`Reason: ${entry.reason}`);
  console.log(lines.join("\n"));
}
