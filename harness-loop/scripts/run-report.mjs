#!/usr/bin/env node
// run-report.mjs — turn a run's tracking data into a report a human can extract insights from.
//
// The harness already RECORDS everything (trace/trace.jsonl via hooks + trace.mjs calls,
// feature_list.json state, trace/verify-report.json snapshots, git history, memory/ entries).
// What it lacked was the ANALYSIS layer: after a loop run or an interactive agent session,
// "what actually happened, where did the time/attempts go, and what should we change" required
// reading raw JSONL by eye. This aggregates all four sources and — where a signal is cheap and
// mechanical — surfaces insight CANDIDATES. The judgment about what to change stays human;
// same division of labor as verify-harness vs. the checker.
//
// Usage:
//   node tools/run-report.mjs --target DIR [--since ISO8601|-Nh] [--json]
//
// --since accepts an ISO timestamp or a relative "-6h" / "-30m" / "-2d". Default: everything.
import { existsSync, readFileSync, readdirSync, statSync , writeSync } from "node:fs";
import { execSync } from "node:child_process";
import path from "node:path";

// stdout on a pipe is async: process.exit() drops whatever has not flushed, so a payload
// past the pipe buffer (~8 KB on macOS) is silently truncated for any caller using
// spawnSync. Found when aeron-demo's report crossed that line and adoption-baseline
// started failing to parse its own input. writeSync is the fix everywhere --json exits.
const args = process.argv.slice(2);
const opt = (n, d = null) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const JSON_OUT = args.includes("--json");
const requestedTarget = path.resolve(opt("--target", "."));
const TARGET = existsSync(path.join(requestedTarget, "harness", "feature_list.json")) ? path.join(requestedTarget, "harness") : requestedTarget;

function parseSince(v) {
  if (!v) return null;
  const rel = /^-(\d+)([mhd])$/.exec(v);
  if (rel) {
    const ms = { m: 60e3, h: 3600e3, d: 86400e3 }[rel[2]] * Number(rel[1]);
    return new Date(Date.now() - ms);
  }
  const d = new Date(v);
  return isNaN(d) ? null : d;
}
const SINCE = parseSince(opt("--since"));

const P = (...p) => path.join(TARGET, ...p);
const exists = (p) => { try { statSync(p); return true; } catch { return false; } };
const readJSON = (p) => { try { return JSON.parse(readFileSync(p, "utf8")); } catch { return null; } };

// --- 1. trace events ------------------------------------------------------------------------
let events = [];
if (exists(P("trace", "trace.jsonl"))) {
  events = readFileSync(P("trace", "trace.jsonl"), "utf8").split("\n").filter(Boolean)
    .map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  if (SINCE) events = events.filter((e) => new Date(e.ts) >= SINCE);
}

// Sessions: pair session-start/session-end per actor, in order.
const sessions = [];
const openByActor = new Map();
for (const e of events) {
  if (e.event === "session-start") openByActor.set(e.actor, { actor: e.actor, start: e.ts, toolUses: 0 });
  else if (e.event === "tool-use" && openByActor.has(e.actor)) openByActor.get(e.actor).toolUses++;
  else if (e.event === "session-end" && openByActor.has(e.actor)) {
    const s = openByActor.get(e.actor);
    s.end = e.ts;
    s.minutes = +(((new Date(e.ts)) - new Date(s.start)) / 60e3).toFixed(1);
    sessions.push(s);
    openByActor.delete(e.actor);
  }
}
for (const s of openByActor.values()) sessions.push({ ...s, end: null, minutes: null }); // still open / crashed

const byEvent = {};
for (const e of events) byEvent[e.event] = (byEvent[e.event] || 0) + 1;
const verdicts = events.filter((e) => e.event === "verdict");
const rejects = verdicts.filter((e) => /reject/i.test(e.detail || e.feature || ""));
const blockedTraces = events.filter((e) => e.event === "blocked");

// Tool telemetry is deliberately separate from trace.jsonl: hook responses may contain source
// text, while this stream contains redacted metadata only.
let toolEvents = [];
if (exists(P("trace", "tool-events.jsonl"))) {
  toolEvents = readFileSync(P("trace", "tool-events.jsonl"), "utf8").split("\n").filter(Boolean)
    .map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  if (SINCE) toolEvents = toolEvents.filter((e) => new Date(e.ts) >= SINCE);
}
const directReads = toolEvents.filter((e) => e.class === "file-read" && e.observation === "direct" && e.success);
const uniqueReadPaths = new Set(directReads.map((e) => e.path).filter(Boolean));
const searches = toolEvents.filter((e) => e.class === "search" || e.class === "glob");
const queryCounts = new Map();
for (const e of searches) if (e.queryHash) queryCounts.set(e.queryHash, (queryCounts.get(e.queryHash) || 0) + 1);
const coverage = [...new Set(toolEvents.map((e) => `${e.runtime}:${e.coverage}`).filter(Boolean))];
const telemetry = { events: toolEvents.length, directReads: directReads.length,
  uniquePaths: uniqueReadPaths.size,
  duplicateReadRate: directReads.length ? +(1 - uniqueReadPaths.size / directReads.length).toFixed(3) : null,
  searches: searches.length, repeatedQueryHashes: [...queryCounts.values()].filter((n) => n > 1).length,
  unobservedShellReads: toolEvents.filter((e) => e.class === "shell").length, coverage };

// --- 2. feature state -----------------------------------------------------------------------
const fl = readJSON(P("feature_list.json"));
const features = fl?.features || [];
const statusCounts = {};
for (const f of features) statusCounts[f.status || f.state] = (statusCounts[f.status || f.state] || 0) + 1;
const promoted = features.filter((f) => /mechanically promoted/.test(f.checkerNotes || ""));
const highAttempts = features.filter((f) => (f.attempts || 0) >= 2);
const needsReplan = features.filter((f) => /^NEEDS RE-PLAN:/.test((f.checkerNotes || "").trim()));
const blockedFeatures = features.filter((f) => (f.status || f.state) === "blocked");
const currentFeatureId = readJSON(P("loop", "current.json"))?.feature || null;
const currentFeature = features.find((f) => f.id === currentFeatureId);
const packetRel = currentFeature?.context?.packet;
const packet = packetRel ? readJSON(P(packetRel)) : null;
if (packet) {
  const normalized = (p) => path.relative(TARGET, path.resolve(TARGET, p));
  const mustRead = new Set((packet.mustRead || []).map(normalized));
  const sourceInputs = new Set((packet.sourceInputs || []).map((i) => normalized(i.path)));
  const observed = new Set([...uniqueReadPaths]);
  telemetry.packetMustReadCoverage = mustRead.size ?
    +([...mustRead].filter((p) => observed.has(p)).length / mustRead.size).toFixed(3) : null;
  telemetry.rediscoveryReads = directReads.filter((e) => sourceInputs.has(e.path) && !mustRead.has(e.path)).length;
}

// --- 3. latest verify snapshot ---------------------------------------------------------------
const verify = readJSON(P("trace", "verify-report.json"));
const scopeSmells = (verify?.findings || []).filter((f) => f.id?.startsWith("scope-smell"));

// --- 4. git + memory -------------------------------------------------------------------------
let commits = [];
try {
  const range = SINCE ? `--since="${SINCE.toISOString()}"` : "-n 15";
  commits = execSync(`git log ${range} --pretty=format:"%h %ad %s" --date=format:"%m-%d %H:%M"`,
    { cwd: TARGET, encoding: "utf8" }).split("\n").filter(Boolean);
} catch { /* not a repo */ }

const memoryDelta = [];
if (exists(P("memory"))) {
  for (const agent of readdirSync(P("memory"))) {
    const dir = P("memory", agent);
    try { if (!statSync(dir).isDirectory()) continue; } catch { continue; }
    for (const f of readdirSync(dir).filter((f) => f.endsWith(".md") && f !== "MEMORY.md")) {
      const st = statSync(path.join(dir, f));
      if (!SINCE || st.mtime >= SINCE) memoryDelta.push({ agent, file: f, mtime: st.mtime.toISOString() });
    }
  }
}

// --- human-attention ledger: the one resource that does not renew ---------------------------
function readIf(rel) { try { return readFileSync(P(rel), "utf8"); } catch { return ""; } }
const needsHuman = readIf("docs/assumptions.md").split("\n")
  .filter((l) => l.trim().startsWith("|") && /needs-human/i.test(l))
  .map((l) => l.split("|").slice(1, 3).map((c) => c.trim()).join(" — "));
const openPolicy = readIf("docs/cross-cutting.md").split("\n")
  .filter((l) => /^\|\s*X-\d/.test(l.trim()) && /not yet decided|needs decision|\|\s*—\s*\|/i.test(l))
  .map((l) => l.split("|").slice(1, 3).map((c) => c.trim()).join(" — "));
const blockedNow = features.filter((f) => (f.status || f.state) === "blocked").map((f) => f.id);
const humanQueue = { needsHuman, openPolicy, blocked: blockedNow,
  total: needsHuman.length + openPolicy.length + blockedNow.length };

// --- insight candidates (mechanical heuristics; judgment stays human) ------------------------
const insights = [];
if (promoted.length || verdicts.length) {
  const manual = verdicts.length;
  insights.push(`Mechanical vs manual verification: ${promoted.length} feature(s) promoted by script, ` +
    `${manual} checker verdict(s) traced. Every promoted feature is a checker session's re-typing saved — ` +
    `if the promoted share is low despite passing features, the promote pass isn't running (check run-loop.sh).`);
}
for (const f of highAttempts) {
  insights.push(`Friction hotspot: ${f.id} used ${f.attempts}/${f.maxAttempts} attempts — read its ` +
    `checkerNotes/evidence trail; recurring causes belong in docs/constraints.md or a memory entry, ` +
    `not in the next maker's rediscovery.`);
}
if (rejects.length) {
  insights.push(`${rejects.length} checker rejection(s) in window — recurring rejection reasons are ` +
    `promotion candidates: turn them into a mechanical check (Review Feedback Promotion, docs/testing-standards.md).`);
}
if (needsReplan.length) {
  insights.push(`Re-plan queue: ${needsReplan.map((f) => f.id).join(", ")} — run the feature-planner ` +
    `agent before any maker touches these.`);
}
if (blockedFeatures.length) {
  insights.push(`Human decision queue: ${blockedFeatures.map((f) => f.id).join(", ")} — the loop cannot ` +
    `move these; every loop run spent re-reading them is waste until a human decides.`);
}
if (scopeSmells.length) {
  insights.push(`${scopeSmells.length} scope-smell warning(s) in the last verify — oversized behavior ` +
    `sentences; cosmetic on done features, but a live one predicts a maker burning its attempts budget.`);
}
const longSessions = sessions.filter((s) => s.minutes !== null && s.minutes > 20);
for (const s of longSessions) {
  insights.push(`Cost hotspot: ${s.actor} session ran ${s.minutes} min (${s.toolUses} traced tool uses) — ` +
    `check the trace for repeated failing commands; a bounded-timeout or memory entry may be missing.`);
}
if (humanQueue.total) {
  insights.push(`Human-attention queue: ${humanQueue.total} item(s) waiting on a person ` +
    `(${needsHuman.length} unverified assumption(s), ${openPolicy.length} undecided policy, ` +
    `${blockedNow.length} blocked feature(s)). Each one stalls everything downstream of it — and ` +
    `before asking, confirm the exhaustion ladder was climbed (references/human-attention.md): a ` +
    `third of this project's historical escalations turned out to be reducible by a two-minute spike.`);
}
if (!events.length) {
  insights.push("No trace events in window — either nothing ran, or agents ran without their hooks " +
    "(interactive sessions outside kiro-cli won't auto-trace; call tools/trace.mjs manually at decision points).");
}
if (!toolEvents.length) insights.push("No redacted tool telemetry in window — read/search cost is unknown, not zero; run tools/telemetry-calibrate.mjs and confirm runtime hooks fired.");

// --- output ----------------------------------------------------------------------------------
const report = {
  target: TARGET,
  window: SINCE ? { since: SINCE.toISOString() } : "all history",
  events: { total: events.length, byEvent },
  telemetry,
  sessions,
  features: { total: features.length, statusCounts, promoted: promoted.map((f) => f.id),
    highAttempts: highAttempts.map((f) => ({ id: f.id, attempts: f.attempts, max: f.maxAttempts })),
    needsReplan: needsReplan.map((f) => f.id), blocked: blockedFeatures.map((f) => f.id) },
  lastVerify: verify ? { green: verify.green, blockers: verify.counts?.blockers, warnings: verify.counts?.warnings, timestamp: verify.timestamp } : null,
  commits,
  memoryEntriesInWindow: memoryDelta,
  humanAttentionQueue: humanQueue,
  insightCandidates: insights,
};

if (JSON_OUT) { writeSync(1, JSON.stringify(report, null, 2) + "\n"); process.exit(0); }

console.log(`Run report — ${TARGET}`);
console.log(`Window: ${SINCE ? `since ${SINCE.toISOString()}` : "all history"}\n`);
console.log(`Trace events: ${events.length} (${Object.entries(byEvent).map(([k, v]) => `${k}:${v}`).join(", ") || "none"})`);
console.log(`Tool telemetry: ${telemetry.events} events; direct reads:${telemetry.directReads}; ` +
  `unique paths:${telemetry.uniquePaths}; duplicate rate:${telemetry.duplicateReadRate ?? "unknown"}; ` +
  `searches:${telemetry.searches}; shell-inferred:${telemetry.unobservedShellReads}; coverage:${coverage.join(",") || "none"}`);
console.log(`\nSessions:`);
for (const s of sessions) console.log(`  ${s.actor.padEnd(24)} ${s.start} → ${s.end || "(no end — crashed or still open)"}${s.minutes !== null ? `  ${s.minutes} min` : ""}  tools:${s.toolUses}`);
if (!sessions.length) console.log("  (none in window)");
console.log(`\nFeatures: ${features.length} total — ${Object.entries(statusCounts).map(([k, v]) => `${k}:${v}`).join(", ")}`);
if (promoted.length) console.log(`  mechanically promoted: ${promoted.map((f) => f.id).join(", ")}`);
if (verify) console.log(`\nLast verify: ${verify.green ? "GREEN" : "RED"} (${verify.counts?.blockers ?? "?"} blockers, ${verify.counts?.warnings ?? "?"} warnings) at ${verify.timestamp}`);
if (commits.length) { console.log(`\nCommits in window:`); for (const c of commits.slice(0, 10)) console.log(`  ${c}`); }
if (memoryDelta.length) { console.log(`\nMemory entries written in window:`); for (const m of memoryDelta) console.log(`  ${m.agent}/${m.file}  (${m.mtime})`); }
if (humanQueue.total) {
  console.log(`\nHuman-attention queue (${humanQueue.total} waiting on a person):`);
  for (const a of needsHuman) console.log(`  assumption   ${a}`);
  for (const p of openPolicy) console.log(`  policy       ${p}`);
  for (const b of blockedNow) console.log(`  blocked      ${b}`);
}
console.log(`\nInsight candidates (mechanical heuristics — the judgment is yours):`);
for (const i of insights) console.log(`  • ${i}`);
if (!insights.length) console.log("  (none surfaced)");
