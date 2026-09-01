#!/usr/bin/env node
// Run one named agent through the installed runtime. This is the implementation on every platform;
// dispatch.sh and dispatch.cmd are compatibility wrappers and contain no control logic.
import { spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
// A directory literally named "harness" is not proof of a contained layout (the harness-loop
// skill's own repo is named "harness" and is flat) — only the thin root AGENTS.md a contained
// scaffold writes is (HI-055). Require both.
const PROJECT_ROOT = path.basename(ROOT) === "harness" && existsSync(path.join(path.dirname(ROOT), "AGENTS.md"))
  ? path.dirname(ROOT) : ROOT;
const IS_WIN = process.platform === "win32";
const RUNTIME_REFUSAL = /monthly request limit reached|rate limit exceeded|quota exceeded|usage limit reached|temporarily unavailable|PreToolUse hook returned unsupported|hook returned invalid pre-tool-use JSON output/i;

// --- bounded retry ---------------------------------------------------------------------------
//
// The retry unit here is NOT an LLM turn on a durable history — it is an agent session that edits
// files. So the usual "classify the error and try again" is unsafe by default: a runtime that dies
// after the maker has rewritten half of feature_list.json leaves a tree no second run can reason
// about, and re-dispatching the same role onto it is how one flaky connection becomes a corrupted
// feature list. Blind retry would trade a visible failure for an invisible one.
//
// The discriminator is therefore not the error text but whether the dispatch PRODUCED ANYTHING. A
// dispatch that returned zero bytes did no agent work, whatever killed it, so running it again is
// exactly equivalent to running it the first time. A dispatch that produced output may have landed
// work, so it fails once and a human reads it.
//
// Failures that carry output stay terminal on purpose. `RUNTIME_REFUSAL` is a period-long refusal,
// not a flaky call (references/runtimes.md: "that is not a retry-and-continue failure; it ends the
// runtime for the period"), and an auth failure is a credential a retry cannot mint.
const RETRY_BASE_MS = 500, RETRY_CAP_MS = 10_000;
const retryBudget = () => {
  const n = Number(process.env.HARNESS_DISPATCH_RETRIES);
  return Number.isFinite(n) && n >= 0 ? n : 2;
};
// Full jitter: without it every parallel slice worker backs off on the same schedule and retries in
// a thundering herd, which is how a transient fault becomes a sustained one.
const backoffMs = (attempt) => Math.round(Math.random() * Math.min(RETRY_CAP_MS, RETRY_BASE_MS * 2 ** attempt));

export function classify({ spawnError, output = "", code = null }) {
  if (spawnError) return { failure: "TRANSPORT", retry: true, why: `the runtime process could not start: ${spawnError.message}` };
  if (RUNTIME_REFUSAL.test(output)) return { failure: "REFUSAL", retry: false, why: "the runtime refused the dispatch; no agent work is accepted" };
  if (!String(output).trim()) return { failure: "EMPTY_RESPONSE", retry: true, why: `the runtime exited ${code} without producing any output` };
  return { failure: null, retry: false, why: "" };
}

const sleep = (ms, signal) => new Promise((resolve, reject) => {
  if (signal?.aborted) return reject(new Error("dispatch aborted"));
  const timer = setTimeout(() => { signal?.removeEventListener("abort", onAbort); resolve(); }, ms);
  function onAbort() { clearTimeout(timer); reject(new Error("dispatch aborted")); }
  signal?.addEventListener("abort", onAbort, { once: true });
});

function commandRuns(command, args = ["--version"]) {
  const result = spawnSync(command, args, { cwd: PROJECT_ROOT, stdio: "ignore", shell: IS_WIN });
  return !result.error && result.status === 0;
}

export function selectRuntime(forced = process.env.HARNESS_RUNTIME || "") {
  if (forced && !["kiro", "claude", "codex"].includes(forced)) {
    throw new Error(`unknown HARNESS_RUNTIME=${forced} (expected kiro, claude or codex)`);
  }
  if (forced) return forced;
  if (existsSync(path.join(PROJECT_ROOT, ".kiro", "agents")) && commandRuns("kiro-cli")) return "kiro";
  if (existsSync(path.join(PROJECT_ROOT, ".claude", "agents")) && commandRuns("claude")) return "claude";
  if (existsSync(path.join(PROJECT_ROOT, ".codex", "agents")) && commandRuns("codex")) return "codex";
  throw new Error("no runtime — install kiro-cli, claude or codex, with the matching agents directory");
}

function checkRuntime(runtime) {
  if (runtime === "kiro" && !process.env.KIRO_API_KEY && !commandRuns("kiro-cli", ["whoami"])) {
    throw new Error("no auth — set KIRO_API_KEY or log in first (kiro-cli login)");
  }
  if (runtime === "claude" && !existsSync(path.join(PROJECT_ROOT, ".claude", "agents"))) {
    throw new Error("runtime=claude but .claude/agents/ is missing");
  }
  if (runtime === "codex") {
    if (!existsSync(path.join(PROJECT_ROOT, ".codex", "hooks.json"))) {
      throw new Error("runtime=codex but .codex/hooks.json is missing — write restrictions would not be enforced");
    }
    if (!commandRuns("codex", ["login", "status"])) throw new Error("codex is not logged in (codex login)");
  }
}

function invocation(runtime, agent, message) {
  if (runtime === "kiro") return [process.execPath, [path.join(ROOT, "tools", "kiro-acp-dispatch.mjs"), agent, message]];
  if (runtime === "claude") return ["claude", ["-p", message, "--agent", agent, "--dangerously-skip-permissions"]];
  return [process.execPath, [path.join(ROOT, "tools", "codex-dispatch.mjs"), agent, message]];
}

function runOnce(agent, message, { runtime, env, signal }) {
  const [command, args] = invocation(runtime, agent, message);
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: PROJECT_ROOT, env: { ...process.env, HARNESS_AGENT: agent, ...env }, shell: IS_WIN,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "", spawnError = null;
    // Best-effort only: the runtimes spawn their own children, and signalling the direct child does
    // not reach a grandchild. Cancelling the BACKOFF is exact; cancelling a running agent is not.
    const onAbort = () => { try { child.kill("SIGTERM"); } catch {} };
    signal?.addEventListener("abort", onAbort, { once: true });
    for (const [stream, sink] of [[child.stdout, process.stdout], [child.stderr, process.stderr]]) {
      stream.on("data", (chunk) => { output += chunk; sink.write(chunk); });
    }
    // A failed spawn emits `error` and then `close`, so let close settle it and keep the error.
    child.on("error", (error) => { spawnError = error; });
    child.on("close", (code, killedBy) => {
      signal?.removeEventListener("abort", onAbort);
      resolve({ code: code ?? (killedBy ? 1 : 0), output, spawnError });
    });
  });
}

// `env` carries the parallel-iteration identity: HARNESS_FEATURE + HARNESS_SLICE tell
// tools/guard-write.mjs which slice of a work-split plan this worker is confined to. It has to
// travel in the environment rather than the prompt, because the prompt is the layer that degrades
// and the guard runs before the model gets a say.
//
// `signal` cancels the backoff between attempts and asks the running child to stop. There is no
// deadline: an agent session legitimately runs for tens of minutes, so a guessed one turns real
// work into a killed turn — and bounding a hung runtime honestly needs process-group management,
// which changes what Ctrl+C does and belongs in its own change. A hung dispatch still hangs.
export async function dispatch(agent, message, { runtime = selectRuntime(), env = {}, signal } = {}) {
  checkRuntime(runtime);
  const budget = retryBudget();
  for (let attempt = 0; ; attempt++) {
    if (signal?.aborted) throw new Error("dispatch aborted");
    const result = await runOnce(agent, message, { runtime, env, signal });
    const verdict = classify(result);
    if (verdict.failure === "REFUSAL") {
      console.error("runtime refused the dispatch despite its process status; no agent work is accepted");
      return 75;
    }
    if (!verdict.failure) return result.code;
    if (!verdict.retry || attempt >= budget) {
      console.error(`dispatch failed [${verdict.failure}] after ${attempt + 1} attempt(s): ${verdict.why}`);
      return result.code || 1;
    }
    const wait = backoffMs(attempt);
    console.error(`dispatch [${verdict.failure}] — ${verdict.why}; retrying in ${wait}ms (${attempt + 1}/${budget})`);
    await sleep(wait, signal);
  }
}

function agentExists(agent) {
  const manifest = JSON.parse(readFileSync(path.join(ROOT, "agents.manifest.json"), "utf8"));
  return (manifest.agents || []).some((item) => item.name === agent);
}

// One slice of a work-split plan, as its own dispatch. The brief is generated by the code node
// rather than written by the caller: a hand-typed brief is how a worker ends up with a question it
// cannot ask (tools/work-split.mjs).
function sliceBrief(feature, slice) {
  const result = spawnSync(process.execPath, [path.join(ROOT, "tools", "work-split.mjs"), "brief", feature, slice],
    { cwd: ROOT, encoding: "utf8" });
  if (result.status !== 0) {
    console.error(result.stderr || `could not build the brief for ${feature}/${slice}`);
    process.exit(result.status || 1);
  }
  return result.stdout;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2);
  const flag = (name) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : null; };
  // Health check without dispatching: prove the selected runtime can actually be driven before a
  // run spends a turn on it. This is the pre-step gate — a broken dispatcher is a blocker, not a
  // reason for the orchestrator to silently become every role itself (generator/evaluator, L13).
  if (argv.includes("--check")) {
    try {
      const runtime = selectRuntime();
      checkRuntime(runtime);
      console.log(`dispatch ok: ${runtime}`);
      process.exit(0);
    } catch (error) {
      console.error(`dispatch broken: ${error.message}`);
      process.exit(1);
    }
  }
  const feature = flag("--feature"), slice = flag("--slice");
  const positional = argv.filter((value, index) =>
    !value.startsWith("--") && argv[index - 1] !== "--feature" && argv[index - 1] !== "--slice");
  const [agent, ...messageParts] = positional;
  if (slice && !feature) {
    console.error("--slice needs --feature: the slice's allowed paths live in that feature's work-split plan");
    process.exit(2);
  }
  if (!agent || (!messageParts.length && !slice)) {
    console.error("usage: node loop/dispatch.mjs <agent> \"<message>\"\n" +
      "       node loop/dispatch.mjs maker --feature <feat-id> --slice <slice-id>");
    process.exit(2);
  }
  if (!agentExists(agent)) {
    console.error(`no agent "${agent}" in agents.manifest.json`);
    process.exit(2);
  }
  try {
    const runtime = selectRuntime();
    const message = slice ? `${sliceBrief(feature, slice)}\n${messageParts.join(" ")}` : messageParts.join(" ");
    const env = slice ? { HARNESS_FEATURE: feature, HARNESS_SLICE: slice } : {};
    console.log(`runtime: ${runtime} — dispatching ${agent}${slice ? ` on slice ${feature}/${slice}` : ""}`);
    process.exitCode = await dispatch(agent, message, { runtime, env });
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
