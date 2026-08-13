#!/usr/bin/env node
// loop-status.mjs — what is the loop doing RIGHT NOW.
//
// The harness could already tell you what happened afterwards (tools/run-report.mjs) and what is
// structurally wrong (tools/verify-harness.mjs). Neither answers the question a human actually has
// while a loop is running: *where is it, and is it going somewhere useful?* Without that the only
// options are reading a growing log by eye or waiting for the run to finish — and waiting is how a
// loop spends an hour doing the wrong thing, which is the failure this harness exists to prevent.
//
// Read-only. Safe to run from a second terminal against a loop in progress.
//
// Usage:
//   node tools/loop-status.mjs                 one screen, then exit
//   node tools/loop-status.mjs --watch [--every 5]
//   node tools/loop-status.mjs --json
import { readFileSync, existsSync, statSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";

const args = process.argv.slice(2);
const opt = (n, d = null) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const TARGET = path.resolve(opt("--target", "."));
const WATCH = args.includes("--watch");
const EVERY = Number(opt("--every", 5)) * 1000;
const JSON_OUT = args.includes("--json");
const P = (...p) => path.join(TARGET, ...p);
const read = (p) => { try { return readFileSync(p, "utf8"); } catch { return null; } };
const readJSON = (p) => { try { return JSON.parse(readFileSync(p, "utf8")); } catch { return null; } };

const dur = (ms) => {
  const s = Math.floor(ms / 1000);
  return s < 60 ? `${s}s` : s < 3600 ? `${Math.floor(s / 60)}m${String(s % 60).padStart(2, "0")}s`
    : `${Math.floor(s / 3600)}h${String(Math.floor((s % 3600) / 60)).padStart(2, "0")}m`;
};

function collect() {
  const out = { at: new Date().toISOString() };

  // What the dispatcher says it is doing. Written at dispatch, cleared when the node returns, so a
  // stale entry with no live process is itself a signal — that is a crashed or killed iteration.
  out.current = readJSON(P("loop", "current.json"));
  if (out.current && out.current.startedAt) out.current.elapsedMs = Date.now() - out.current.startedAt;

  // Where the router would send work next.
  const r = spawnSync(process.execPath, [P("loop", "route.mjs"), "--json"],
    { cwd: TARGET, encoding: "utf8", timeout: 20000 });
  out.next = (() => { try { return JSON.parse(r.stdout); } catch { return null; } })();

  const fl = readJSON(P("feature_list.json"));
  const features = (fl && fl.features) || [];
  out.features = { total: features.length, byStatus: {} };
  for (const f of features) out.features.byStatus[f.status || "?"] = (out.features.byStatus[f.status || "?"] || 0) + 1;
  // The ones a human would want to look at: in flight, waiting on judgement, or out of budget.
  out.inFlight = features
    .filter((f) => ["active", "in-progress"].includes(f.status) || f.readyForCheck ||
      (f.attempts || 0) >= (f.maxAttempts || 99))
    .map((f) => ({ id: f.id, status: f.status, readyForCheck: !!f.readyForCheck,
      attempts: `${f.attempts || 0}/${f.maxAttempts || "?"}`,
      note: String(f.checkerNotes || "").split("\n")[0].slice(0, 70) }));

  // Markers are the loop's own escalation channel; a human should see them without grepping.
  out.markers = features
    .filter((f) => /^NEEDS (DESIGN|RE-PLAN):/.test(String(f.checkerNotes || "").trim()))
    .map((f) => ({ id: f.id, marker: String(f.checkerNotes).split("\n")[0].slice(0, 80) }));

  // What has been dispatched, newest last. Repetition here is the shape of a livelock.
  const log = (read(P("loop", "route-log.jsonl")) || "").split("\n").filter(Boolean)
    .map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  out.dispatched = log.slice(-6);
  const tail = log.slice(-4);
  out.repeating = tail.length === 4 && tail.every((e) => e.node === tail[0].node && e.feature === tail[0].feature);

  // Uncommitted work: what the agents have written that no commit has captured yet.
  const g = spawnSync("git", ["status", "--porcelain"], { cwd: TARGET, encoding: "utf8" });
  out.uncommitted = (g.stdout || "").split("\n").filter(Boolean).map((l) => l.trim()).slice(0, 12);

  const vr = readJSON(P("trace", "verify-report.json"));
  if (vr) {
    const blockers = (vr.findings || []).filter((f) => f.severity === "blocker");
    out.verify = { blockers: blockers.length, warnings: (vr.findings || []).length - blockers.length,
      topBlockers: blockers.slice(0, 3).map((f) => f.id),
      ageMs: (() => { try { return Date.now() - statSync(P("trace", "verify-report.json")).mtimeMs; } catch { return null; } })() };
  }
  return out;
}

function render(s) {
  const L = [];
  L.push("");
  L.push(`  LOOP STATUS — ${path.basename(TARGET)}   ${new Date().toLocaleTimeString()}`);
  L.push("  " + "─".repeat(70));
  if (s.current && !s.current.finishedAt) {
    L.push(`  RUNNING   ${s.current.node}${s.current.feature ? ` on ${s.current.feature}` : ""}` +
      `   ${dur(s.current.elapsedMs || 0)}   (iteration ${s.current.iteration || "?"})`);
  } else {
    L.push(`  idle — no agent dispatched right now`);
  }
  if (s.next) L.push(`  next      ${s.next.node} [${s.next.layer}] — ${String(s.next.why || "").slice(0, 60)}`);
  L.push("");
  const st = Object.entries(s.features.byStatus).map(([k, v]) => `${k} ${v}`).join("  ");
  L.push(`  features  ${s.features.total} total   ${st}`);
  if (s.inFlight.length) {
    L.push("  in flight");
    for (const f of s.inFlight.slice(0, 6))
      L.push(`      ${f.id.padEnd(28)} ${f.status.padEnd(12)} attempts ${f.attempts}${f.readyForCheck ? "  READY-FOR-CHECK" : ""}`);
  }
  if (s.markers.length) {
    L.push(`  escalations (${s.markers.length}) — the loop is asking for a decision`);
    for (const m of s.markers.slice(0, 4)) L.push(`      ${m.marker}`);
  }
  if (s.dispatched.length) {
    L.push("  dispatched (newest last)");
    L.push("      " + s.dispatched.map((d) => d.node).join(" → "));
    if (s.repeating) L.push(`      !! same node on the same feature 4x — that is a livelock, stop the loop`);
  }
  if (s.verify) {
    L.push(`  verify    ${s.verify.blockers} blocker(s), ${s.verify.warnings} warning(s)` +
      (s.verify.ageMs !== null ? `   (report is ${dur(s.verify.ageMs)} old)` : "") +
      (s.verify.topBlockers.length ? `   ${s.verify.topBlockers.join(", ")}` : ""));
  }
  if (s.uncommitted.length) {
    L.push(`  uncommitted (${s.uncommitted.length})`);
    for (const f of s.uncommitted.slice(0, 6)) L.push(`      ${f}`);
  }
  L.push("");
  return L.join("\n");
}

function once() {
  const s = collect();
  if (JSON_OUT) { process.stdout.write(JSON.stringify(s, null, 2) + "\n"); return; }
  process.stdout.write(render(s) + "\n");
}

if (!WATCH) { once(); }
else {
  const tick = () => { process.stdout.write("\x1b[2J\x1b[H"); once(); };
  tick();
  setInterval(tick, EVERY);
}
