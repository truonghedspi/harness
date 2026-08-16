#!/usr/bin/env node
// timeline.mjs — how the feature list got to where it is, and how long things have been open.
//
// `loop-status.mjs` answers "where is it now". This answers "how did it get here, and is it
// actually moving?" — the question behind every "how is the project going", and the one a snapshot
// cannot answer. A human looking at 18/61 done cannot tell a project that finished twelve features
// last week from one that has been stuck on the same three for a fortnight.
//
// Built from git history of feature_list.json, deliberately: the commit dates are evidence, while
// the dates agents write into `evidence` are self-reported and only 22 of 61 have one at all. If
// the file was never committed there is no timeline, and this says so rather than inventing one.
//
// Usage:
//   node tools/timeline.mjs                    days, transitions, and what is open now
//   node tools/timeline.mjs --feature feat-x   one feature's whole history
//   node tools/timeline.mjs --limit 20         how many recent transitions to list (default 12)
//   node tools/timeline.mjs --json
import { readFileSync, writeSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";

const args = process.argv.slice(2);
const opt = (n, d = null) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const TARGET = path.resolve(opt("--target", "."));
const ONE = opt("--feature", null);
const LIMIT = Number(opt("--limit", 12));
const JSON_OUT = args.includes("--json");
const out = (s) => writeSync(1, s.endsWith("\n") ? s : s + "\n");
const git = (a) => spawnSync("git", a, { cwd: TARGET, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });

const DONE = new Set(["done", "passing"]);
const day = (epoch) => new Date(epoch * 1000).toISOString().slice(0, 10);

const head = git(["rev-parse", "HEAD"]);
if (head.status !== 0) {
  process.stderr.write("timeline.mjs: not a git repository (or no commits) — there is no history to read.\n");
  process.exit(2);
}
const log = git(["log", "--reverse", "--format=%H%ct%s", "--", "feature_list.json"]);
const commits = (log.stdout || "").split("\n").filter(Boolean)
  .map((l) => { const [sha, ct, subject] = l.split(""); return { sha, at: Number(ct), subject }; });

if (!commits.length) {
  process.stderr.write("timeline.mjs: feature_list.json has never been committed, so it has no history.\n" +
    "Commit it — the scope IS state, and a scope nobody can diff is a scope nobody can review.\n");
  process.exit(1);
}

// Replay every commit and record each transition. Cheap enough: one `git show` per commit, and a
// project accumulates tens of these, not thousands.
const events = [];
const firstSeen = new Map();      // id -> epoch, for "how long has this been open"
let prev = new Map();
for (const c of commits) {
  const blob = git(["show", `${c.sha}:feature_list.json`]);
  let now;
  try { now = new Map((JSON.parse(blob.stdout).features || []).map((f) => [f.id, f.status || "?"])); }
  catch { continue; }             // a commit where the file was unparseable is not a data point
  for (const [id, status] of now) {
    if (!firstSeen.has(id)) firstSeen.set(id, c.at);
    const before = prev.get(id);
    if (before === undefined) { if (prev.size) events.push({ ...c, id, from: null, to: status, kind: "added" }); }
    else if (before !== status) events.push({ ...c, id, from: before, to: status, kind: "moved" });
  }
  for (const [id] of prev) if (!now.has(id)) events.push({ ...c, id, from: prev.get(id), to: null, kind: "removed" });
  prev = now;
}

const current = (() => {
  try { return JSON.parse(readFileSync(path.join(TARGET, "feature_list.json"), "utf8")).features || []; }
  catch { return []; }
})();
const nowSec = Math.floor(Date.now() / 1000);
const ageDays = (epoch) => Math.floor((nowSec - epoch) / 86400);

// One feature's history.
if (ONE) {
  const mine = events.filter((e) => e.id === ONE);
  const f = current.find((x) => x.id === ONE);
  if (!mine.length && !f) { process.stderr.write(`no feature "${ONE}" in the history or the current list\n`); process.exit(1); }
  if (JSON_OUT) { out(JSON.stringify({ id: ONE, current: f ? f.status : null, events: mine }, null, 2)); process.exit(0); }
  const L = ["", `  ${ONE}${f ? `   ${f.name || ""}` : "   (no longer in the list)"}`, ""];
  for (const e of mine) {
    L.push(`  ${day(e.at)}  ${(e.from || "—").padEnd(13)} → ${(e.to || "removed").padEnd(13)} ${e.subject.slice(0, 46)}`);
  }
  if (f) {
    L.push("");
    L.push(`  now: ${f.status}${f.readyForCheck ? " · ready-for-check" : ""}   attempts ${f.attempts || 0}/${f.maxAttempts || "?"}` +
      (firstSeen.has(ONE) ? `   open ${ageDays(firstSeen.get(ONE))}d` : ""));
  }
  L.push("");
  out(L.join("\n"));
  process.exit(0);
}

// Per-day rollup.
const byDay = new Map();
for (const e of events) {
  const d = day(e.at);
  if (!byDay.has(d)) byDay.set(d, { day: d, done: 0, added: 0, other: 0 });
  const b = byDay.get(d);
  if (e.kind === "added") b.added++;
  else if (DONE.has(e.to)) b.done++;
  else b.other++;
}
const days = [...byDay.values()];

// Open features, oldest first — the aging signal a snapshot hides.
const open = current.filter((f) => !DONE.has(f.status))
  .map((f) => ({ id: f.id, status: f.status, ageDays: firstSeen.has(f.id) ? ageDays(firstSeen.get(f.id)) : null }))
  .sort((a, b) => (b.ageDays ?? -1) - (a.ageDays ?? -1));

const doneNow = current.filter((f) => DONE.has(f.status)).length;
const spanDays = Math.max(1, Math.ceil((commits[commits.length - 1].at - commits[0].at) / 86400));
// Recent movement, not an average. 18 done over 12 days reads as "1.5/day" while 17 of them landed
// on one afternoon and nothing has finished since — an average describes a project that does not
// exist. What a human is asking is "is it moving NOW".
const weekAgo = nowSec - 7 * 86400;
// DISTINCT features, not transitions: a feature that was finished, reopened and finished again
// counts once. Counting transitions reported 22 finished in a week on a list with 18 done at all,
// which is the kind of number that quietly destroys trust in the rest of the screen.
// NET change against the state a week ago, not a count of transitions. "21 finished this week" was
// true — distinct features that reached done — and sat next to "18 done" looking like a bug, because
// several were reopened afterwards. What a human is asking is how much further along this is than
// it was, so answer that, and report the reopens separately since they are the interesting part.
const uniq = (pred) => new Set(events.filter(pred).map((e) => e.id)).size;
const stateAt = (cutoff) => {
  let snap = new Map();
  for (const c of commits) {
    if (c.at > cutoff) break;
    const blob = git(["show", `${c.sha}:feature_list.json`]);
    try { snap = new Map((JSON.parse(blob.stdout).features || []).map((f) => [f.id, f.status || "?"])); } catch { /* skip */ }
  }
  return snap;
};
const doneAWeekAgo = [...stateAt(weekAgo).values()].filter((v) => DONE.has(v)).length;
const doneThisWeek = doneNow - doneAWeekAgo;
const reopened = uniq((e) => e.at >= weekAgo && DONE.has(e.from || "") && !DONE.has(e.to));
const lastDone = [...events].reverse().find((e) => DONE.has(e.to) && !DONE.has(e.from || ""));
const summary = { total: current.length, done: doneNow, open: open.length, spanDays,
  doneThisWeek, reopenedThisWeek: reopened,
  daysSinceLastDone: lastDone ? ageDays(lastDone.at) : null };

if (JSON_OUT) {
  out(JSON.stringify({ schema: "harness-timeline/1", summary, days, events: events.slice(-LIMIT), open }, null, 2));
  process.exit(0);
}

const L = [];
L.push("");
L.push(`  TIMELINE — ${path.basename(TARGET)}`);
L.push("  " + "─".repeat(70));
L.push(`  ${summary.done}/${summary.total} done over ${spanDays} day(s)`);
L.push(`  last 7 days: net ${summary.doneThisWeek >= 0 ? "+" : ""}${summary.doneThisWeek} done` +
  (summary.reopenedThisWeek ? `, ${summary.reopenedThisWeek} REOPENED` : "") +
  (summary.daysSinceLastDone === null ? "   (nothing has ever finished)"
    : `   · last finish was ${summary.daysSinceLastDone}d ago`));
L.push("");
const maxBar = Math.max(1, ...days.map((d) => d.done + d.added + d.other));
for (const d of days) {
  const bar = "█".repeat(Math.round((d.done / maxBar) * 24)) + "░".repeat(Math.round(((d.added + d.other) / maxBar) * 24));
  L.push(`  ${d.day}  ${bar.padEnd(26)} ${String(d.done).padStart(2)} done` +
    (d.added ? `  +${d.added} new` : "") + (d.other ? `  ${d.other} moved` : ""));
}
L.push("");
L.push(`  last ${Math.min(LIMIT, events.length)} transition(s)`);
for (const e of events.slice(-LIMIT)) {
  L.push(`      ${day(e.at)}  ${e.id.padEnd(26)} ${(e.from || "—")} → ${e.to || "removed"}`);
}
if (open.length) {
  L.push("");
  L.push(`  open, oldest first — how long each has been in the list`);
  for (const f of open.slice(0, 8)) {
    const flag = f.ageDays !== null && f.ageDays >= 7 ? "  <- open a week or more" : "";
    L.push(`      ${f.id.padEnd(26)} ${String(f.status).padEnd(13)} ${f.ageDays === null ? "?" : f.ageDays + "d"}${flag}`);
  }
  if (open.length > 8) L.push(`      … and ${open.length - 8} more`);
}
L.push("");
L.push("  One feature's history: node tools/timeline.mjs --feature <id>");
L.push("");
out(L.join("\n"));
