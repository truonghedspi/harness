#!/usr/bin/env node
// Cross-platform autonomous loop driver. The .sh/.cmd files are compatibility wrappers only.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import readline from "node:readline/promises";
import { fileURLToPath } from "node:url";
import { dispatch, selectRuntime } from "./dispatch.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
process.chdir(ROOT);
const args = process.argv.slice(2);
const iterations = Number(args.find((arg) => /^\d+$/.test(arg)) || 1);
let attended = !args.includes("--headless") && process.env.HARNESS_ATTENDED !== "0";
if (args.includes("--attended")) attended = true;
if (attended && !process.stdin.isTTY) {
  console.log("no TTY on stdin — running headless. Watch it with: node tools/loop-status.mjs --watch");
  attended = false;
}

function run(command, commandArgs, options = {}) {
  return spawnSync(command, commandArgs, { cwd: ROOT, encoding: "utf8", ...options });
}

function allSettled() {
  let list;
  try { list = JSON.parse(readFileSync("feature_list.json", "utf8")); } catch { return false; }
  let decisions = "";
  try { decisions = readFileSync("DECISIONS.md", "utf8"); } catch {}
  return (list.features || []).every((feature) => {
    const status = String(feature.status || feature.state || "");
    return ["done", "passing"].includes(status) ||
      (status === "blocked" && (String(feature.checkerNotes || "").trim() || decisions.includes(feature.id)));
  });
}

function readyForCheck() {
  try {
    const list = JSON.parse(readFileSync("feature_list.json", "utf8"));
    return (list.features || []).filter((feature) => feature.readyForCheck === true);
  } catch { return []; }
}

function recordBaseline() {
  const entry = existsSync("init.mjs") ? [process.execPath, ["init.mjs"]] : ["bash", ["init.sh"]];
  const result = run(entry[0], entry[1], { timeout: 300_000 });
  const output = String(result.stdout || "") + String(result.stderr || "");
  process.stdout.write(output);
  const normalized = output.replace(/\b\d+(?:\.\d+)?(?:ms|s)\b/g, "<duration>").trim();
  const state = {
    schema: "baseline-state/1", status: result.status === 0 ? "green" : "red",
    evidenceDigest: createHash("sha256").update(`${result.status}\0${normalized}`).digest("hex").slice(0, 16),
    exitCode: result.status, checkedAt: new Date().toISOString(), tail: output.split("\n").slice(-20).join("\n"),
  };
  writeFileSync("loop/baseline-state.json", `${JSON.stringify(state, null, 2)}\n`);
  console.log(`baseline: ${state.status} (${state.evidenceDigest})`);
  return state;
}

function route() {
  const result = run(process.execPath, ["loop/route.mjs", "--json"]);
  try { return JSON.parse(result.stdout); } catch {
    return { node: "maker", kind: "agent", layer: "implementation", why: "router unavailable — defaulting" };
  }
}

function logRoute(next) {
  // Every dispatch is the trajectory, not only marker-driven escalation. A marker still rides the
  // same entry as hash/requestId so the router's ladder and loop-status's livelock can tell an
  // ordinary delivery turn from a re-dispatched escalation without a second stream.
  appendFileSync("loop/route-log.jsonl", `${JSON.stringify({
    node: next.node, feature: next.feature || null, layer: next.layer || null,
    hash: next.hash || null, requestId: next.requestId || null,
    at: new Date().toISOString(),
  })}\n`);
}

function markCurrent(next, iteration, finished = false) {
  let current = { node: next.node, feature: next.feature || null, iteration, startedAt: Date.now(),
    mode: next.mode || null, slices: next.slices || null };
  if (finished) {
    try { current = JSON.parse(readFileSync("loop/current.json", "utf8")); } catch {}
    current.finishedAt = Date.now();
  }
  writeFileSync("loop/current.json", JSON.stringify(current, null, 2));
}

function show(command, commandArgs) {
  const result = run(command, commandArgs);
  process.stdout.write(result.stdout || "");
  process.stderr.write(result.stderr || "");
}

async function checkpoint(iteration, node) {
  console.log(`\n── after iteration ${iteration}/${iterations}: ${node} ──`);
  show("git", ["--no-pager", "diff", "--stat", "HEAD"]);
  if (existsSync("tools/loop-status.mjs")) show(process.execPath, ["tools/loop-status.mjs", "--target", "."]);
  const input = readline.createInterface({ input: process.stdin, output: process.stdout });
  while (true) {
    const answer = await input.question("continue? [Enter]=yes  s=full status  d=diff  q=quit : ");
    if (/^q$/i.test(answer)) { input.close(); return false; }
    if (/^s$/i.test(answer)) show(process.execPath, ["tools/loop-status.mjs", "--target", "."]);
    else if (/^d$/i.test(answer)) show("git", ["--no-pager", "diff", "HEAD"]);
    else { input.close(); return true; }
  }
}

// The fan-out: one maker per outstanding slice of a validated work-split plan, all inside ONE
// feature. WIP=1 is untouched — it bounds features, not files — and tools/guard-write.mjs confines
// each worker to its slice's paths, so the thing they could contend on is removed rather than
// coordinated. The fan-in is deliberately NOT here: the integrating maker is a separate, single
// dispatch on the router's next turn, because N concurrent runs of one test suite is how a shared
// port or database turns a green feature red (references/p08-parallel-record.md).
//
// Fan-in rule: AND. One failed worker fails the iteration. "Most of the slices landed" is not a
// state this loop has — it is a half-written feature that nobody has been told about.
const MAX_PARALLEL = Number(process.env.HARNESS_MAX_PARALLEL || 4);

async function fanOut(next, headless, runtime) {
  const slices = next.slices || [];
  console.log(`fan-out: ${slices.length} slice(s) of ${next.feature}, ${MAX_PARALLEL} at a time`);
  const results = [];
  for (let i = 0; i < slices.length; i += MAX_PARALLEL) {
    const batch = slices.slice(i, i + MAX_PARALLEL);
    const settled = await Promise.all(batch.map(async (slice) => {
      run(process.execPath, ["tools/work-split.mjs", "start", next.feature, slice]);
      const brief = run(process.execPath, ["tools/work-split.mjs", "brief", next.feature, slice]);
      if (brief.status !== 0) {
        console.error(brief.stderr || `no brief for ${next.feature}/${slice}`);
        return { slice, code: 2 };
      }
      const code = await dispatch(next.node, `${brief.stdout}\n${headless}`,
        { runtime, env: { HARNESS_FEATURE: next.feature, HARNESS_SLICE: slice } });
      // A worker that neither completed nor failed its own slice left it `running`. Record that
      // here rather than letting the next router turn re-dispatch a slice already half-written by
      // a process that is gone.
      const state = run(process.execPath, ["tools/work-split.mjs", "status", next.feature, "--json"]);
      let recorded = "";
      try { recorded = (JSON.parse(state.stdout).slices || []).find((x) => x.id === slice)?.status || ""; } catch {}
      if (recorded === "running") {
        run(process.execPath, ["tools/work-split.mjs", "fail", next.feature, slice,
          "--note", `worker exited ${code} without recording an outcome`]);
      }
      return { slice, code };
    }));
    results.push(...settled);
  }
  for (const r of results) console.log(`  slice ${r.slice}: exit ${r.code}`);
  const failed = results.filter((r) => r.code !== 0);
  if (failed.length) {
    console.error(`fan-out failed: ${failed.map((r) => r.slice).join(", ")} — the router will name a ` +
      `maker to re-cut the split before any more parallel work`);
    return 0;   // routable state, not a crash: rule "a validated work split has a failed slice"
  }
  return 0;
}

async function main() {
  if (allSettled()) {
    console.log("all features done (or blocked with a recorded reason) — nothing to do, exiting early.");
    return 0;
  }
  const runtime = selectRuntime();
  console.log(`runtime: ${runtime}`);
  let baselineChecked = false;
  for (let iteration = 1; iteration <= iterations; iteration++) {
    if (allSettled()) return 0;
    recordBaseline();
    const next = route();
    logRoute(next);
    console.log(`=== iteration ${iteration}/${iterations} — route → ${next.node} [layer: ${next.layer}] ===`);
    console.log(`    ${next.why}`);
    if (next.node === "exit") return 0;
    if (next.node === "human") {
      console.log("router: features are open but no rule routes them — a human must look.");
      appendFileSync("session-handoff.md", `${next.why}\n`);
      return 3;
    }
    if (next.node === "checker") {
      const reviewBatch = readyForCheck();
      if (!reviewBatch.length || existsSync("tools/review-contract.mjs") &&
          run(process.execPath, ["tools/review-contract.mjs", "--ready"], { stdio: "inherit" }).status !== 0) {
        console.log("checker skipped: final handoff batch failed mechanical admission; attempts unchanged");
        continue;
      }
      console.log(`final review batch: ${reviewBatch.map((feature) => feature.id).join(", ")}`);
    }
    if (next.kind === "agent") {
      markCurrent(next, iteration);
      const headless = `You are running HEADLESS under node loop/run-loop.mjs — no human can answer questions, so commit directly instead of asking. The router selected you because: ${next.why}. Run exactly one iteration per your instructions and loop/goal.md. Honor every stop condition.`;
      const code = next.mode === "slice-fanout"
        ? await fanOut(next, headless, runtime)
        : await dispatch(next.node, headless, { runtime });
      markCurrent(next, iteration, true);
      if (code !== 0) return code;
    }
    if (next.node === "checker") {
      recordBaseline();
      baselineChecked = true;
    }
    if (attended && !await checkpoint(iteration, next.node)) return 0;
  }
  // The checker owns semantic acceptance; this replay is post-verdict regression evidence only
  // and deliberately lacks --promote.
  if (baselineChecked && existsSync("tools/verify-harness.mjs")) {
    show(process.execPath, ["tools/verify-harness.mjs", "--target", ".", "--skip-baseline", "--run-features", "--quiet"]);
  }
  for (const tool of ["memory-consolidate.mjs", "cross-cutting-audit.mjs"]) {
    if (existsSync(path.join("tools", tool))) show(process.execPath, [path.join("tools", tool), "--target", "."]);
  }
  if (!baselineChecked) {
    console.log(`loop finished: ${iterations} iteration(s). No complete review batch ran.`);
    return 0;
  }
  const baseline = JSON.parse(readFileSync("loop/baseline-state.json", "utf8"));
  console.log(`loop finished: ${iterations} iteration(s), baseline ${baseline.status}.`);
  return baseline.status === "green" ? 0 : 1;
}

try { process.exitCode = await main(); }
catch (error) { console.error(error.message); process.exitCode = 1; }
