#!/usr/bin/env node
// Cross-platform autonomous loop driver. The .sh/.cmd files are compatibility wrappers only.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFileSync, existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
  if (!next.hash && !next.requestId) return;
  appendFileSync("loop/route-log.jsonl", `${JSON.stringify({
    node: next.node, feature: next.feature || null, hash: next.hash || null,
    requestId: next.requestId || null, at: new Date().toISOString(),
  })}\n`);
}

function markCurrent(next, iteration, finished = false) {
  let current = { node: next.node, feature: next.feature || null, iteration, startedAt: Date.now() };
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

async function approvalAllowsPromote(iteration) {
  if (!existsSync("loop/approval-gate.mjs")) return true;
  if (run(process.execPath, ["loop/approval-gate.mjs", "--check"]).status === 0) return true;
  console.log(`=== iteration ${iteration}/${iterations} — HUMAN APPROVAL required before promote ===`);
  const wait = run(process.execPath, ["loop/approval-gate.mjs", "--wait", "--timeout-min",
    process.env.APPROVAL_TIMEOUT_MIN || "0", "--on-timeout", process.env.APPROVAL_ON_TIMEOUT || "reject"],
  { stdio: "inherit" });
  rmSync("loop/approval.md", { force: true });
  rmSync("loop/approval-request.md", { force: true });
  return wait.status === 0;
}

// Re-running EVERY already-done feature's verification command on every single maker iteration is
// real regression coverage (docs/testing-standards.md: environment/contract drift can break
// unchanged code) but not a cost worth paying every iteration forever, especially once a project
// has Level 3 integration-verified features. Full replay (including already-claimed features) runs
// only every Nth iteration and once more at the end of the run; every other iteration replays only
// readyForCheck features — the ones --promote actually needs to act on this iteration.
const FULL_REPLAY_EVERY = Number(process.env.HARNESS_FULL_REPLAY_EVERY || 5);

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
    if (next.kind === "agent") {
      markCurrent(next, iteration);
      const code = await dispatch(next.node,
        `You are running HEADLESS under node loop/run-loop.mjs — no human can answer questions, so commit directly instead of asking. The router selected you because: ${next.why}. Run exactly one iteration per your instructions and loop/goal.md. Honor every stop condition.`,
        { runtime });
      markCurrent(next, iteration, true);
      if (code !== 0) return code;
    }
    if (attended && !await checkpoint(iteration, next.node)) return 0;
    if (!["maker", "k8s-integration-tester"].includes(next.node)) continue;
    const reviewBatch = readyForCheck();
    if (!reviewBatch.length) {
      console.log("checker skipped: maker recorded a checkpoint, but no complete feature-level claim is ready");
      continue;
    }
    console.log(`review batch: ${reviewBatch.map((feature) => feature.id).join(", ")}`);
    const promote = await approvalAllowsPromote(iteration);
    if (promote && existsSync("tools/verify-harness.mjs")) {
      const fullReplay = iteration % FULL_REPLAY_EVERY === 0;
      const replayArgs = ["tools/verify-harness.mjs", "--target", ".", "--skip-baseline", "--run-features", "--promote", "--quiet"];
      if (!fullReplay) replayArgs.push("--skip-claimed");
      show(process.execPath, replayArgs);
    }
    console.log(`=== iteration ${iteration}/${iterations} — checker ===`);
    const checkerCode = await dispatch("checker", "Check every feature with readyForCheck=true per your instructions. Verdicts and reasons only.", { runtime });
    if (checkerCode !== 0) return checkerCode;
    recordBaseline();
    baselineChecked = true;
  }
  // A run that ended mid-cycle of FULL_REPLAY_EVERY may never have re-checked already-done
  // features' evidence this session — do it once here so drift doesn't sit unnoticed until the
  // next run happens to land on a full-replay iteration.
  if (baselineChecked && existsSync("tools/verify-harness.mjs")) {
    show(process.execPath, ["tools/verify-harness.mjs", "--target", ".", "--skip-baseline", "--run-features", "--promote", "--quiet"]);
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
