#!/usr/bin/env node
// replay-parallel.mjs — P08 experiment 2: the verify node as a fan-out / fan-in.
//
// `verify-harness --run-features` replays every claimed feature's verification one at a time. The
// subtasks are genuinely independent — each is "does THIS feature's command still exit 0" — so
// this is the one place in the harness where parallelism is not fighting the WIP=1 rule (WIP=1
// governs *making*, and this node does no making).
//
//   fan-out rule: one subtask per DISTINCT verification command (identical commands are one
//                 subtask — replaying the same command twice measures nothing twice), each in its
//                 own git worktree so maven's target/ and any driver dirs cannot collide.
//   fan-in  rule: AND. Every subtask must exit 0. One failure fails the node — this is evidence
//                 replay, and "most of the evidence still reproduces" is not a passing state.
//
// Usage: node replay-parallel.mjs --target DIR [--workers N] [--sequential] [--json]
import { readFileSync, writeFileSync, existsSync, rmSync, mkdirSync } from "node:fs";
import { execSync, exec } from "node:child_process";
import path from "node:path";
import os from "node:os";

const args = process.argv.slice(2);
const opt = (n, d = null) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const TARGET = path.resolve(opt("--target", "."));
const SEQUENTIAL = args.includes("--sequential");
const JSON_OUT = args.includes("--json");
const WORKERS = SEQUENTIAL ? 1 : Number(opt("--workers", Math.max(2, Math.min(6, os.cpus().length - 2))));
const TIMEOUT_MS = Number(opt("--timeout-ms", 900000));
// Commands that reach outside the repo (a shared cluster, a fixed host port) cannot be made
// independent by a worktree — isolating the filesystem does not isolate the world.
const NOT_ISOLATABLE = /k8s-test-env|kubectl|helm |minikube|docker /;
// Commands that DO run locally but contend on a machine-wide resource a worktree cannot clone —
// a fixed UDP port range, a shared IPC directory, a device. They may run in parallel with
// everything else, but only one of them at a time. Found the hard way: Aeron's TestCluster binds
// a fixed port base, so two cluster SITs in different worktrees still collided.
const EXCLUSIVE = opt("--exclusive") ? new RegExp(opt("--exclusive")) : null;

const fl = JSON.parse(readFileSync(path.join(TARGET, "feature_list.json"), "utf8"));
const claimed = (fl.features || []).filter((f) => ["done", "passing"].includes(String(f.status || f.state)));

// --- fan-out: distinct commands become subtasks -------------------------------------------------
const byCmd = new Map();
for (const f of claimed) {
  const cmd = String(f.verification || f.verify || "").trim();
  if (!cmd || /^(REPLACE|TODO|TBD)\b/i.test(cmd)) continue;
  if (!byCmd.has(cmd)) byCmd.set(cmd, []);
  byCmd.get(cmd).push(f.id);
}
const subtasks = [...byCmd.entries()].map(([command, ids], i) => ({
  index: i, command, featureIds: ids, isolatable: !NOT_ISOLATABLE.test(command),
  exclusive: !!(EXCLUSIVE && EXCLUSIVE.test(command)),
}));
const skipped = subtasks.filter((s) => !s.isolatable);
const runnable = subtasks.filter((s) => s.isolatable);

// --- worktrees: one per worker, reused across that worker's subtasks ------------------------------
const WT_ROOT = path.join(os.tmpdir(), `p08-wt-${process.pid}`);
const head = execSync("git rev-parse HEAD", { cwd: TARGET, encoding: "utf8" }).trim();
const worktrees = [];
function makeWorktrees(n) {
  if (SEQUENTIAL) return;                       // baseline runs in the repo itself
  mkdirSync(WT_ROOT, { recursive: true });
  for (let i = 0; i < n; i++) {
    const dir = path.join(WT_ROOT, `w${i}`);
    execSync(`git worktree add --detach -q "${dir}" ${head}`, { cwd: TARGET, stdio: "pipe" });
    worktrees.push(dir);
  }
}
function cleanupWorktrees() {
  for (const dir of worktrees) {
    try { execSync(`git worktree remove --force "${dir}"`, { cwd: TARGET, stdio: "pipe" }); } catch {}
  }
  try { rmSync(WT_ROOT, { recursive: true, force: true }); } catch {}
}

// A one-slot mutex for the exclusive group. Not a scheduler — the point is that the fan-out rule
// must partition on the RESOURCE a subtask needs, not on the command text.
let exclusiveChain = Promise.resolve();
const withExclusive = (fn) => {
  const next = exclusiveChain.then(fn, fn);
  exclusiveChain = next.catch(() => {});
  return next;
};

const run = (cmd, cwd) => new Promise((resolve) => {
  const started = Date.now();
  exec(cmd, { cwd, timeout: TIMEOUT_MS, maxBuffer: 32e6, // true, not "/bin/bash": that path does not exist on Windows, where the default shell is cmd.exe
    shell: true }, (err, stdout, stderr) => {
    resolve({
      code: err ? (typeof err.code === "number" ? err.code : 1) : 0,
      ms: Date.now() - started,
      tail: ((stdout || "") + (stderr || "")).split("\n").slice(-12).join("\n"),
    });
  });
});

// --- run: a worker pool, each worker pinned to one worktree ---------------------------------------
const results = [];
async function worker(id) {
  const cwd = SEQUENTIAL ? TARGET : worktrees[id];
  for (;;) {
    const task = runnable.shift();
    if (!task) return;
    const r = task.exclusive
      ? await withExclusive(() => run(task.command, cwd))
      : await run(task.command, cwd);
    results.push({ ...task, ...r, worker: id, cwd });
    if (!JSON_OUT) {
      console.log(`  [w${id}]${task.exclusive ? "*" : " "} ${r.code === 0 ? "ok  " : "FAIL"} ${(r.ms / 1000).toFixed(1)}s  ${task.command.slice(0, 74)}`);
    }
  }
}

const t0 = Date.now();
makeWorktrees(WORKERS);
const setupMs = Date.now() - t0;
if (!JSON_OUT) {
  console.log(`replay ${SEQUENTIAL ? "SEQUENTIAL" : `PARALLEL x${WORKERS}`} — ${runnable.length} distinct command(s) from ${claimed.length} claimed feature(s)`);
  if (skipped.length) console.log(`  skipping ${skipped.length} not isolatable by a worktree (touches a shared cluster/port)`);
  const ex = runnable.filter((s) => s.exclusive).length;
  if (ex) console.log(`  ${ex} subtask(s) marked * share a machine-wide resource — parallel with others, serial among themselves`);
  if (!SEQUENTIAL) console.log(`  worktree setup: ${(setupMs / 1000).toFixed(1)}s`);
}
const t1 = Date.now();
await Promise.all(Array.from({ length: SEQUENTIAL ? 1 : WORKERS }, (_, i) => worker(i)));
const runMs = Date.now() - t1;
cleanupWorktrees();
const totalMs = Date.now() - t0;

// --- fan-in: AND ----------------------------------------------------------------------------------
const failed = results.filter((r) => r.code !== 0);
const out = {
  mode: SEQUENTIAL ? "sequential" : `parallel-${WORKERS}`,
  subtasks: results.length, failed: failed.length,
  exclusiveGroup: EXCLUSIVE ? String(EXCLUSIVE) : null,
  setupMs, runMs, totalMs,
  serialSumMs: results.reduce((a, r) => a + r.ms, 0),
  skippedNotIsolatable: skipped.map((s) => s.command),
  results: results.map(({ tail, ...r }) => ({ ...r, tail: r.code === 0 ? "" : tail })),
  verdict: failed.length === 0 ? "PASS" : "FAIL",
};
const reportDir = path.join(TARGET, "trace");
mkdirSync(reportDir, { recursive: true });
writeFileSync(path.join(reportDir, `replay-${out.mode}.json`), JSON.stringify(out, null, 2) + "\n");

if (JSON_OUT) { console.log(JSON.stringify(out, null, 2)); }
else {
  console.log(`\n  wall clock: ${(totalMs / 1000).toFixed(1)}s   (sum of subtask times: ${(out.serialSumMs / 1000).toFixed(1)}s)`);
  console.log(`  fan-in (AND): ${out.verdict} — ${results.length - failed.length}/${results.length} subtasks exited 0`);
  for (const f of failed) console.log(`    FAILED: ${f.command}\n${f.tail.split("\n").map((l) => "      " + l).join("\n")}`);
}
process.exit(failed.length ? 1 : 0);
