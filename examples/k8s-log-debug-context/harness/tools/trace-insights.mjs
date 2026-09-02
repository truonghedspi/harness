#!/usr/bin/env node
// trace-insights.mjs — mine the loop's recorded trace for harness/workflow/skill optimization
// options (the dynamic counterpart to verify-harness.mjs's static gates).
//
// verify-harness finds layer=harness defects by inspecting files; run-report.mjs aggregates a run
// into project-level insight candidates ("this feature is stuck"). Neither reads the loop's own
// behavior back as *what to change in the harness*. This does: it replays trace/trace.jsonl
// and loop/route-log.jsonl, detects recurring inefficiency patterns, and
// emits ranked optimization options — each with a layer (harness/workflow/skill), the trace
// evidence, and a concrete remedy naming what to change. It is read-only and writes nothing; the
// judgement about what to act on stays human, exactly like run-report and verify-harness.
//
// Usage:
//   node tools/trace-insights.mjs                    ranked optimization options
//   node tools/trace-insights.mjs --layer harness    only one layer
//   node tools/trace-insights.mjs --since -7d        only records since seven days ago
//   node tools/trace-insights.mjs --json             machine-readable options
import { readFileSync, existsSync, writeSync } from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
const opt = (n, d = null) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const requestedTarget = path.resolve(opt("--target", "."));
const TARGET = existsSync(path.join(requestedTarget, "harness", "feature_list.json"))
  ? path.join(requestedTarget, "harness") : requestedTarget;

const read = (p) => { try { return readFileSync(p, "utf8"); } catch { return null; } };
const parse = (l) => { try { return JSON.parse(l); } catch { return null; } };
const out = (s) => writeSync(1, (s.endsWith("\n") ? s : s + "\n"));
const P = (...p) => path.join(TARGET, ...p);

const LAYER = opt("--layer", "all");
const JSON_OUT = args.includes("--json");

const now = Date.now();
const since = (() => {
  const v = opt("--since");
  if (!v) return -Infinity;
  if (/^-\d+[smhd]$/.test(v)) {
    const n = Number(v.slice(1, -1));
    return now - n * { s: 1000, m: 60e3, h: 3600e3, d: 86400e3 }[v.slice(-1)];
  }
  const t = Date.parse(v);
  return Number.isFinite(t) ? t : -Infinity;
})();
const inWindow = (ts) => Date.parse(ts) >= since;

// --- sources --------------------------------------------------------------------------------
const events = (read(P("trace", "trace.jsonl")) || "").split("\n").filter(Boolean)
  .map(parse).filter(Boolean).filter((e) => e.ts && inWindow(e.ts));
const routes = (read(P("loop", "route-log.jsonl")) || "").split("\n").filter(Boolean)
  .map(parse).filter(Boolean).filter((e) => (e.ts || e.at) && inWindow(e.ts || e.at));
const features = (() => {
  const fl = JSON.parse(read(P("feature_list.json")) || '{"features":[]}');
  return fl.features || [];
})();

const findings = [];

// 1. Recurring checker rejections are the cheapest mechanical gate to add — a reason a checker
// writes down twice is a rule a script can enforce once (docs/testing-standards.md, Lesson 9).
const verdicts = events.filter((e) => e.event === "verdict");
const rejects = verdicts.filter((e) => /reject/i.test(e.detail || e.feature || ""));
if (rejects.length) {
  const rate = verdicts.length ? rejects.length / verdicts.length : 1;
  findings.push({
    id: "reject-promotion", layer: "workflow",
    title: `${rejects.length} checker rejection(s) across ${new Set(rejects.map((e) => e.feature).filter(Boolean)).size} feature(s)`,
    evidence: {
      rejects: rejects.length, verdicts: verdicts.length,
      rejectRate: Number(rate.toFixed(2)),
      features: [...new Set(rejects.map((e) => e.feature).filter(Boolean))].slice(0, 8),
      sample: rejects.slice(0, 2).map((e) => String(e.detail || "").slice(0, 140)),
    },
    remedy: "Recurring rejection reasons are promotion candidates — turn the top recurring one into a mechanical check in tools/review-contract.mjs or a verify-harness.mjs gate, so the checker stops re-typing it.",
    confidence: rate >= 0.25 || rejects.length >= 3 ? "high" : "medium",
    score: rejects.length * 10,
  });
}

// 2. Rediscovery: the same file read over and over is context that should be injected once
// (context packet mustRead) or remembered (memory/<agent>/), not re-read every session.
// NOTE: this finding requires external read-event data; without a telemetry source it cannot fire.
{
  const directReads = [];
  const counts = new Map();
  for (const e of directReads) if (e.path) counts.set(e.path, (counts.get(e.path) || 0) + 1);
  const repeated = [...counts.entries()].filter(([, n]) => n >= 3).sort((a, b) => b[1] - a[1]);
  if (repeated.length) {
    const unique = counts.size;
    findings.push({
      id: "rediscovery", layer: "skill",
      title: `${repeated.length} file(s) re-read across sessions`,
      evidence: {
        duplicateReadRate: Number((1 - unique / directReads.length).toFixed(2)),
        repeated: repeated.slice(0, 6).map(([p, n]) => ({ path: p, reads: n })),
      },
      remedy: "Add the repeatedly-read file to the active feature's context packet mustRead, or a memory/<agent>/ entry, so it is injected once instead of rediscovered each session.",
      confidence: "medium",
      score: repeated.reduce((a, [, n]) => a + n, 0),
    });
  }
}

// 4. Dispatch friction: attempts are full semantic review cycles that failed. A feature re-reviewed
// repeatedly without a recorded reason is a workflow signal, not an implementation detail.
const highAttempts = features.filter((f) => (f.attempts || 0) >= 2 && (f.status || f.state) !== "blocked");
if (highAttempts.length) {
  findings.push({
    id: "dispatch-friction", layer: "workflow",
    title: `${highAttempts.length} feature(s) needed 2+ semantic review attempts`,
    evidence: {
      features: highAttempts.map((f) => ({ id: f.id, attempts: f.attempts || 0, maxAttempts: f.maxAttempts })).slice(0, 8),
    },
    remedy: "Each attempt is a failed semantic review. Recurring causes belong in docs/constraints.md or a memory entry; if a feature reaches maxAttempts without a recorded reason, the loop is missing its bound.",
    confidence: "high",
    score: highAttempts.length * 5,
  });
}

// 5. Marker churn: a feature that re-enters the marker ladder means the node that answered it did
// not clear the marker it was handed — the router's ladder is being climbed more than it should.
const markers = routes.filter((e) => e.hash || e.requestId);
const byFeature = new Map();
for (const m of markers) {
  if (!m.feature) continue;
  const entry = byFeature.get(m.feature) || { feature: m.feature, nodes: new Set(), count: 0 };
  entry.nodes.add(m.node); entry.count += 1; byFeature.set(m.feature, entry);
}
const churned = [...byFeature.values()].filter((e) => e.count >= 2);
if (churned.length) {
  findings.push({
    id: "marker-churn", layer: "harness",
    title: `${churned.length} feature(s) re-entered the marker ladder`,
    evidence: { features: churned.map((e) => ({ feature: e.feature, count: e.count, nodes: [...e.nodes] })).slice(0, 8) },
    remedy: "The node that answers a marker must be able to clear it (route.mjs's ladder already routes a stuck marker to a human) — a feature re-entering the ladder repeatedly means an answer did not land.",
    confidence: "medium",
    score: churned.length * 3,
  });
}

findings.sort((a, b) => b.score - a.score);
const rows = LAYER === "all" ? findings : findings.filter((f) => f.layer === LAYER);

if (JSON_OUT) {
  out(JSON.stringify(rows, null, 2));
  process.exit(0);
}

out(`trace insights — ${rows.length} optimization option(s)${LAYER === "all" ? "" : ` (layer: ${LAYER})`}`);
if (!rows.length) {
  out("  no optimization options found in the recorded trace — the loop looks clean on the signals checked.");
  out(`  sources: trace/trace.jsonl, loop/route-log.jsonl (under ${TARGET})`);
  process.exit(0);
}
rows.forEach((f, i) => {
  out(`\n${String(i + 1).padStart(2)}. [${f.layer}] ${f.title}  (confidence: ${f.confidence})`);
  out(`     evidence: ${JSON.stringify(f.evidence)}`);
  out(`     remedy:   ${f.remedy}`);
});
