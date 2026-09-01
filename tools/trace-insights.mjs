#!/usr/bin/env node
// trace-insights.mjs — mine the loop's recorded trace for harness/workflow/skill optimization
// options (the dynamic counterpart to verify-harness.mjs's static gates).
//
// verify-harness finds layer=harness defects by inspecting files; run-report.mjs aggregates a run
// into project-level insight candidates ("this feature is stuck"). Neither reads the loop's own
// behavior back as *what to change in the harness*. This does: it replays trace/trace.jsonl,
// trace/tool-events.jsonl and loop/route-log.jsonl, detects recurring inefficiency patterns, and
// emits ranked optimization options — each with a layer (harness/workflow/skill), the trace
// evidence, and a concrete remedy naming what to change. It is read-only and writes nothing; the
// judgement about what to act on stays human, exactly like run-report and verify-harness.
//
// Usage:
//   node tools/trace-insights.mjs                    ranked optimization options
//   node tools/trace-insights.mjs --layer harness    only one layer
//   node tools/trace-insights.mjs --since -7d        only records since seven days ago
//   node tools/trace-insights.mjs --json             machine-readable options (bare array)
//   node tools/trace-insights.mjs --report PATH      write a schema-tagged report the skill's
//                                                    backlog can import (harness-issue.mjs import)
import { readFileSync, existsSync, writeFileSync, writeSync } from "node:fs";
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
const toolEvents = (read(P("trace", "tool-events.jsonl")) || "").split("\n").filter(Boolean)
  .map(parse).filter(Boolean).filter((e) => e.ts && inWindow(e.ts));
const routes = (read(P("loop", "route-log.jsonl")) || "").split("\n").filter(Boolean)
  .map(parse).filter(Boolean).filter((e) => (e.ts || e.at) && inWindow(e.ts || e.at));
const features = (() => {
  const fl = JSON.parse(read(P("feature_list.json")) || '{"features":[]}');
  return fl.features || [];
})();
const approvals = (read(P("loop", "approval-log.jsonl")) || "").split("\n").filter(Boolean)
  .map(parse).filter(Boolean).filter((e) => !e.at || inWindow(e.at));
const assumptions = read(P("docs", "assumptions.md")) || "";

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

// 2. Read/search telemetry that observes only shell means every read-cost signal is blind: the
// duplicate-read and rediscovery options below cannot fire, so optimization is guesswork.
const shell = toolEvents.filter((e) => e.class === "shell").length;
const directReads = toolEvents.filter((e) => e.class === "file-read" && e.success);
const searches = toolEvents.filter((e) => e.class === "search" || e.class === "glob").length;
const coverage = [...new Set(toolEvents.map((e) => `${e.runtime}:${e.coverage}`).filter(Boolean))];
if (toolEvents.length && directReads.length === 0 && searches === 0) {
  findings.push({
    id: "telemetry-coverage", layer: "harness",
    title: `read/search telemetry is blind — ${shell} shell event(s) and no observed file reads`,
    evidence: { shell, directReads: 0, searches: 0, coverage },
    remedy: "Run tools/telemetry-calibrate.mjs and confirm the runtime hooks observe read/search; without direct-read events, duplicate-read and rediscovery cost cannot be measured.",
    confidence: "high", score: 100,
  });
}

// 3. Rediscovery: the same file read over and over is context that should be injected once
// (context packet mustRead) or remembered (memory/<agent>/), not re-read every session.
if (directReads.length) {
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

// --- where a human had to step in -------------------------------------------------------------
//
// The three detectors above read what the LOOP did. These read what the loop made a PERSON do, and
// that is the signal nothing was capturing: human attention is the one input this harness cannot
// renew (references/human-attention.md). Every escalation, rejection and unanswered question is
// already written down — by route.mjs, by the approval gate — and until now all of it evaporated
// when the session ended.

// 6. The router escalating to `human` means open work that no rule could route. Once is a
// judgement call the graph correctly refused to make. Repeatedly is a missing edge.
const escalations = routes.filter((r) => r.node === "human");
if (escalations.length) {
  findings.push({
    id: "router-escalation", layer: "harness",
    title: `${escalations.length} router escalation(s) to a human`,
    evidence: { count: escalations.length, requests: [...new Set(escalations.map((r) => r.requestId || r.feature || "unnamed"))].slice(0, 8) },
    remedy: "Each escalation is open work the graph could not route. Read loop/route-log.jsonl for the requestIds, then either add the missing rule to loop/route.mjs or record why this decision is deliberately a human's (docs/reference/graph-closed-edges.md).",
    confidence: escalations.length > 1 ? "high" : "low",
    score: escalations.length * 3,
  });
}

// 7. A rejected approval is a human saying the loop got it wrong, with a reason attached. The same
// reason twice is a rule a script could have enforced before the human was ever asked.
const rejectedApprovals = approvals.filter((a) => a.verdict === "rejected" && a.source !== "timeout");
if (rejectedApprovals.length) {
  findings.push({
    id: "approval-rejected", layer: "workflow",
    title: `${rejectedApprovals.length} approval(s) rejected by a human`,
    evidence: { count: rejectedApprovals.length, reasons: rejectedApprovals.map((a) => String(a.reason || "").slice(0, 120)).slice(0, 5) },
    remedy: "A reason a human writes twice is a mechanical check waiting to be written once. Turn the recurring reason into a tools/review-contract.mjs admission rule or a verify-harness.mjs gate, so the gate stops spending judgement on it.",
    confidence: "high",
    score: rejectedApprovals.length * 3,
  });
}

// 8. A timed-out approval is worse than a rejected one: the gate asked for judgement and got
// silence, so the auto-reject spent an iteration to learn nothing.
const unanswered = approvals.filter((a) => a.source === "timeout");
if (unanswered.length) {
  findings.push({
    id: "approval-unanswered", layer: "workflow",
    title: `${unanswered.length} approval request(s) timed out unanswered`,
    evidence: { count: unanswered.length, items: unanswered.map((a) => a.items ?? null).slice(0, 5) },
    remedy: "The gate is asking for judgement nobody is there to give. Either narrow what it escalates so each question is worth a person's time, or run headless with a scripted --verdict and record the policy — an auto-reject nobody reads costs an iteration and teaches nothing (references/human-attention.md).",
    confidence: "high",
    score: unanswered.length * 2,
  });
}

// --- what the project does not know yet --------------------------------------------------------
//
// 9. Unverified assumptions and residual unknowns are facts the loop is proceeding WITHOUT. They
// are layer `project` on purpose: the remedy is a spike or a citation in the target, never an edit
// to the skill. The point of surfacing them here is that an unknown nobody counts is an unknown
// nobody closes — a confident sentence and a verified one read identically six weeks later
// (references/llm-failure-modes.md, Confabulation).
const unverified = assumptions.split("\n")
  .filter((l) => l.trim().startsWith("|") && /\b(unverified|assumed|needs-human|open)\b/i.test(l))
  .map((l) => (l.match(/\|\s*(A-\d+)\s*\|/) || [])[1]).filter(Boolean);
const residual = features.flatMap((f) => {
  const list = f.reviewPacket && f.reviewPacket.residualUnknowns;
  return Array.isArray(list) && list.length ? [{ feature: f.id, count: list.length }] : [];
});
if (unverified.length || residual.length) {
  findings.push({
    id: "open-unknowns", layer: "project",
    title: `${unverified.length} unverified assumption(s) and ${residual.length} feature(s) carrying residual unknowns`,
    evidence: { assumptions: unverified.slice(0, 10), residual: residual.slice(0, 8) },
    remedy: "Each one is a fact the loop is building on without proof. Close it the cheap way first: a `path:line` citation in a real checkout, or a throwaway spike under spikes/ that runs and settles it (docs/reference/design-engineering.md). Only what neither can answer is a design question for a human.",
    confidence: "medium",
    score: (unverified.length + residual.length) * 2,
  });
}

// Every option gets the same shape of identity the static gates have. Without a stable signature
// an option cannot be the SAME option across runs, so it can only ever be read and forgotten —
// which is what this file did before: it found real inefficiency and wrote nothing down.
// `severity` is always `warn`: an optimization option is a cost, never a broken gate, and calling
// one a blocker would let it outrank a real defect in the backlog's ranking.
for (const f of findings) { f.signature = `trace/${f.id}`; f.severity = "warn"; }

findings.sort((a, b) => b.score - a.score);
const rows = LAYER === "all" ? findings : findings.filter((f) => f.layer === LAYER);

// The report is the import artifact, deliberately shaped like trace/verify-report.json: one file
// per run, schema-tagged, so the backlog has exactly one import path for both sources.
const REPORT = opt("--report");
if (REPORT !== null) {
  const file = REPORT && !String(REPORT).startsWith("--") ? REPORT : P("trace", "insights-report.json");
  writeFileSync(file, JSON.stringify({
    schema: "trace-insights/1", target: TARGET, timestamp: new Date().toISOString(), options: rows,
  }, null, 2) + "\n");
  out(`wrote ${rows.length} option(s) to ${file}`);
  out(`Next: node harness-loop/scripts/harness-issue.mjs import --report ${file}`);
  process.exit(0);
}

if (JSON_OUT) {
  out(JSON.stringify(rows, null, 2));
  process.exit(0);
}

out(`trace insights — ${rows.length} optimization option(s)${LAYER === "all" ? "" : ` (layer: ${LAYER})`}`);
if (!rows.length) {
  out("  no optimization options found in the recorded trace — the loop looks clean on the signals checked.");
  out(`  sources: trace/trace.jsonl, trace/tool-events.jsonl, loop/route-log.jsonl (under ${TARGET})`);
  process.exit(0);
}
rows.forEach((f, i) => {
  out(`\n${String(i + 1).padStart(2)}. [${f.layer}] ${f.title}  (confidence: ${f.confidence})`);
  out(`     evidence: ${JSON.stringify(f.evidence)}`);
  out(`     remedy:   ${f.remedy}`);
});
