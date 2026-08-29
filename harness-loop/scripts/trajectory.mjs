#!/usr/bin/env node
// trajectory.mjs — the loop's run as one compact chronological ledger (the CLI analogue of the
// deepseek-harness Trajectory tab).
//
// The harness already RECORDS a run across three append-only streams, but none of them can be read
// as the run actually happened: trace/trace.jsonl is the decision path, trace/tool-events.jsonl is
// redacted tool activity, loop/route-log.jsonl is marker-driven routing. loop-status answers "where
// is it now", timeline answers "how did feature_list.json get here", run-report aggregates a run
// into insight candidates. A trajectory is none of those — it is the ordered sequence of sessions,
// decisions and tool activity with timing, the same way the deepseek Trajectory ledger renders a
// conversation rather than summarizing it.
//
// This tool merges all three streams into one time-ordered ledger and renders it compactly. It is
// read-only and safe to run against a loop in progress.
//
// Usage:
//   node tools/trajectory.mjs                  most recent records, oldest-first (tail 50)
//   node tools/trajectory.mjs --all            the whole recorded run, oldest-first
//   node tools/trajectory.mjs --record 17      full JSON of record #17 (the inspector)
//   node tools/trajectory.mjs --actor maker    only one role's records
//   node tools/trajectory.mjs --feature feat-x only one feature's records
//   node tools/trajectory.mjs --since -6h      only records since six hours ago
//   node tools/trajectory.mjs --limit 30       at most 30 records
//   node tools/trajectory.mjs --summary        per-actor and per-event counts
//   node tools/trajectory.mjs --json           machine-readable merged stream
import { readFileSync, existsSync, writeSync } from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
const opt = (n, d = null) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const requestedTarget = path.resolve(opt("--target", "."));
const TARGET = existsSync(path.join(requestedTarget, "harness", "feature_list.json"))
  ? path.join(requestedTarget, "harness") : requestedTarget;

const read = (p) => { try { return readFileSync(p, "utf8"); } catch { return null; } };
const parse = (l) => { try { return JSON.parse(l); } catch { return null; } };
// stdout on a pipe is async: process.exit() drops whatever has not flushed, so a payload past the
// pipe buffer is silently truncated for a spawnSync caller. writeSync is the fix everywhere --json.
const out = (s) => writeSync(1, (s.endsWith("\n") ? s : s + "\n"));
const P = (...p) => path.join(TARGET, ...p);

const now = Date.now();
const since = (() => {
  const v = opt("--since");
  if (!v) return -Infinity;
  if (/^-\d+[smhd]$/.test(v)) {
    const n = Number(v.slice(1, -1));
    const unit = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 }[v.slice(-1)];
    return now - n * unit;
  }
  const t = Date.parse(v);
  return Number.isFinite(t) ? t : -Infinity;
})();
const ACTOR = opt("--actor");
const FEATURE = opt("--feature");
const LIMIT = Number(opt("--limit", 50)) || 0;
const ALL = args.includes("--all");
const RECORD = Number(opt("--record", 0)) || 0;
const JSON_OUT = args.includes("--json");
const SUMMARY = args.includes("--summary");

// A trajectory record is the least common shape of all three sources. `event` is the compact
// kind label; `detail` is the human-readable summary (never a raw payload — trace.mjs already
// truncates `raw`, and tool-events redacts inputs by hash). Machine fields stay separate so --json
// callers can project what they need without re-parsing prose.
function collect() {
  const records = [];

  // 1. Decision path — the loop's own narrative (trace.mjs writes this, not the agent's prints).
  for (const l of (read(P("trace", "trace.jsonl")) || "").split("\n")) {
    const j = parse(l);
    if (!j || !j.ts) continue;
    records.push({
      ts: j.ts, source: "trace", actor: String(j.actor || "unknown"),
      event: String(j.event || "unknown"), feature: j.feature || null,
      detail: j.detail ? String(j.detail).slice(0, 200) : null,
    });
  }

  // 2. Tool activity — redacted read/grep/glob/shell with duration and success.
  for (const l of (read(P("trace", "tool-events.jsonl")) || "").split("\n")) {
    const j = parse(l);
    if (!j || !j.ts) continue;
    records.push({
      ts: j.ts, source: "tool", actor: String(j.actor || "unknown"),
      event: String(j.tool || j.class || "tool"), feature: j.feature || null,
      detail: j.path ? `→ ${j.path}` : null,
      durationMs: Number.isFinite(j.durationMs) ? j.durationMs : null,
      success: typeof j.success === "boolean" ? j.success : null,
      sessionIdHash: j.sessionIdHash || null,
    });
  }

  // 3. Marker-driven routing — the router's own dispatch decisions.
  for (const l of (read(P("loop", "route-log.jsonl")) || "").split("\n")) {
    const j = parse(l);
    if (!j || (!j.at && !j.ts)) continue;
    records.push({
      ts: j.ts || j.at, source: "route", actor: String(j.node || "router"),
      event: "route", feature: j.feature || null, layer: j.layer || null,
      detail: j.hash || j.requestId
        ? `marker ${String(j.hash || j.requestId).slice(0, 12)}`
        : (j.why ? String(j.why).slice(0, 160) : null),
    });
  }

  records.sort((a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0));
  return records;
}

const all = collect().filter((r) => {
  if (Date.parse(r.ts) < since) return false;
  if (ACTOR && r.actor !== ACTOR) return false;
  if (FEATURE && r.feature !== FEATURE) return false;
  return true;
});
// Keep the index stable across filters: the #N in the ledger is the Nth record in the filtered
// stream, which is what --record addresses. Default is the tail (what just happened); --all is the
// whole run.
const rows = ALL ? all : (LIMIT ? all.slice(-LIMIT) : all);

function fmtTime(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  const ss = String(d.getSeconds()).padStart(2, "0");
  return `${mm}-${dd} ${hh}:${mi}:${ss}`;
}

function fmtDuration(ms) {
  if (ms == null) return "";
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`;
}

function fmtRecord(r, i) {
  const time = fmtTime(r.ts);
  const actor = r.actor.padEnd(18).slice(0, 18);
  const kind = (r.source === "tool" ? `⊢ ${r.event}` : r.event).padEnd(15).slice(0, 15);
  const feature = r.feature ? ` ${r.feature}` : "";
  const status = r.success === false ? " ✗" : r.success === true ? " ✓" : "";
  const dur = r.durationMs != null ? ` ${fmtDuration(r.durationMs)}` : "";
  const detail = r.detail ? `  ${r.detail}` : "";
  return `${String(i + 1).padStart(4)}  ${time}  ${actor} ${kind}${feature}${status}${dur}${detail}`;
}

if (RECORD) {
  const r = rows[RECORD - 1];
  if (!r) { out(`no record #${RECORD} (ledger has ${rows.length} record(s) in the current filter)`); process.exit(1); }
  out(JSON.stringify(r, null, 2));
  process.exit(0);
}

if (JSON_OUT) {
  out(JSON.stringify(rows, null, 2));
  process.exit(0);
}

if (SUMMARY) {
  const byActor = new Map();
  const byEvent = new Map();
  for (const r of all) {
    byActor.set(r.actor, (byActor.get(r.actor) || 0) + 1);
    byEvent.set(`${r.actor}/${r.event}`, (byEvent.get(`${r.actor}/${r.event}`) || 0) + 1);
  }
  out(`trajectory summary — ${all.length} record(s)${rows.length < all.length ? ` (showing ${rows.length})` : ""}`);
  out("\nby actor");
  for (const [k, v] of [...byActor.entries()].sort((a, b) => b[1] - a[1])) out(`  ${String(v).padStart(4)}  ${k}`);
  out("\nby event");
  for (const [k, v] of [...byEvent.entries()].sort((a, b) => b[1] - a[1])) out(`  ${String(v).padStart(4)}  ${k}`);
  process.exit(0);
}

// Default ledger. Oldest first so a run reads top-to-bottom as it happened.
if (!rows.length) {
  out("no trajectory records — the loop has not recorded anything yet, or the filter matches nothing.");
  out(`  sources: trace/trace.jsonl, trace/tool-events.jsonl, loop/route-log.jsonl (under ${TARGET})`);
  process.exit(0);
}
out(`trajectory — ${rows.length} record(s)${ALL ? " (full run)" : ` (tail ${LIMIT})`}`);
out("  ⊢ tool activity · ✓/✗ tool success · #N is the --record index");
for (let i = 0; i < rows.length; i++) {
  const r = rows[i];
  if (r.event === "session-start" && i > 0) out("  ── next session ──");
  out(fmtRecord(r, i));
}
