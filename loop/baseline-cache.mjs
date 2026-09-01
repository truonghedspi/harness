#!/usr/bin/env node
// Cross-session baseline cache.
//
// The baseline is a START gate (Lesson 6). `run-loop.mjs` already reuses a green one for the rest
// of a session, because the environment it checks does not change between iterations. This adds
// the half that was missing: when a NEW session starts and nothing that feeds the gate has
// changed, re-running it buys no information and costs whatever the gate costs. That is not
// hypothetical — jdt-mcp-server's provisioner replay takes 562 s per run because the clean-cache
// path really downloads a JDT LS distribution.
//
// Every rule below fails toward RUNNING. A cache that guesses wrong turns a red baseline into a
// silent green, which is the one failure this gate exists to prevent. So no policy file, no git,
// no recorded digest, an unreadable timestamp or any doubt at all means: run it. A red baseline is
// never reused either — red is a claim about now, and only a fresh run can retire it.
//
// Usage:
//   node loop/baseline-cache.mjs            # print the decision; exit 0 = reuse, 1 = must run
//   node loop/baseline-cache.mjs --digest   # print the current inputs digest only
//
// Policy lives in `loop/baseline-cache.json` (opt-in — absent means disabled):
//   { "schema": "baseline-cache/1", "enabled": true, "maxAgeHours": 24,
//     "root": "..", "probes": ["node -v", "./mvnw -v"], "ignore": ["docs/"] }

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const TREE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const POLICY_FILE = path.join(TREE, "loop/baseline-cache.json");
const STATE_FILE = path.join(TREE, "loop/baseline-state.json");

// Bookkeeping the loop itself rewrites on every run. Left in the digest, these guarantee a miss
// every single time — the cache would be dead code that still pays the cost of looking.
const LOOP_STATE = [
  "harness/loop/baseline-state.json", "harness/loop/current.json", "harness/loop/route-log.jsonl",
  "harness/loop/approval-log.jsonl", "harness/loop/approval.md", "harness/loop/approval-request.md",
  "harness/trace/trace.jsonl",
  "loop/baseline-state.json", "loop/current.json", "loop/route-log.jsonl",
  "loop/approval-log.jsonl", "loop/approval.md", "loop/approval-request.md", "trace/trace.jsonl",
];

// A tracked tree far larger than this is a sign the digest is reading build output or vendored
// payload, where hashing stops being cheap. Refuse rather than make the gate slow to skip.
const MAX_INPUT_BYTES = 64 * 1024 * 1024;

function readJSON(file) {
  try { return JSON.parse(readFileSync(file, "utf8")); } catch { return null; }
}

function git(cwd, args) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  return result.status === 0 ? String(result.stdout) : null;
}

export function policy() {
  if (process.env.HARNESS_BASELINE_CACHE === "0") {
    return { enabled: false, reason: "HARNESS_BASELINE_CACHE=0" };
  }
  const raw = readJSON(POLICY_FILE);
  if (!raw) return { enabled: false, reason: "no loop/baseline-cache.json — the cache is opt-in" };
  if (raw.enabled === false) return { enabled: false, reason: "loop/baseline-cache.json sets enabled:false" };

  // Default root: the project the gate builds, not the harness directory the gate lives in. A
  // tree installed as <project>/harness verifies its parent; one installed at the root is its own.
  const declared = typeof raw.root === "string" ? raw.root : (path.basename(TREE) === "harness" ? ".." : ".");
  return {
    enabled: true,
    root: path.resolve(TREE, declared),
    maxAgeHours: Number.isFinite(Number(raw.maxAgeHours)) ? Number(raw.maxAgeHours) : 24,
    probes: (Array.isArray(raw.probes) ? raw.probes : [])
      .map((probe) => (Array.isArray(probe) ? probe : String(probe).split(/\s+/)).filter(Boolean))
      .filter((argv) => argv.length),
    ignore: [...LOOP_STATE, ...(Array.isArray(raw.ignore) ? raw.ignore.map(String) : [])],
  };
}

function ignored(relPath, ignore) {
  return ignore.some((entry) => relPath === entry || (entry.endsWith("/") && relPath.startsWith(entry)));
}

// The working tree is what the gate actually reads, so the digest hashes file CONTENT rather than
// the commit: an uncommitted edit can never be mistaken for the committed state. Only the last
// run's digest is kept, so reverting an edit after an intervening run costs one more run — the
// conservative direction, and the cheap one to be wrong in.
export function inputsDigest(pol = policy()) {
  if (!pol.enabled) return { digest: null, reason: pol.reason };
  if (!existsSync(pol.root)) return { digest: null, reason: `digest root ${pol.root} does not exist` };
  if (git(pol.root, ["rev-parse", "--is-inside-work-tree"]) === null) {
    return { digest: null, reason: "not a git work tree — the cache cannot enumerate its inputs" };
  }

  const tracked = git(pol.root, ["ls-files", "-z"]);
  const untracked = git(pol.root, ["ls-files", "--others", "--exclude-standard", "-z"]);
  if (tracked === null || untracked === null) {
    return { digest: null, reason: "git could not list the working tree" };
  }
  const files = [...tracked.split("\0"), ...untracked.split("\0")]
    .filter(Boolean).filter((rel) => !ignored(rel, pol.ignore)).sort();

  const hash = createHash("sha256");
  hash.update(`root\0${path.basename(pol.root)}\n`);
  let bytes = 0;
  for (const rel of files) {
    const abs = path.join(pol.root, rel);
    let content;
    try {
      // A symlink or a file that vanished mid-walk is state we cannot digest honestly.
      if (!statSync(abs).isFile()) continue;
      content = readFileSync(abs);
    } catch { return { digest: null, reason: `could not read ${rel} while digesting inputs` }; }
    bytes += content.length;
    if (bytes > MAX_INPUT_BYTES) {
      return { digest: null, reason: `working tree exceeds ${MAX_INPUT_BYTES} bytes — too large to digest cheaply` };
    }
    hash.update(`${rel}\0`);
    hash.update(createHash("sha256").update(content).digest());
    hash.update("\n");
  }

  // Toolchain identity. A green recorded under JDK 21 says nothing once the JDK is swapped, and no
  // amount of file hashing sees that. A probe that will not run is itself a state change, so its
  // failure goes into the digest instead of silently disabling the cache.
  for (const argv of pol.probes) {
    const result = spawnSync(argv[0], argv.slice(1), { cwd: pol.root, encoding: "utf8", timeout: 30_000 });
    const output = `${result.stdout || ""}${result.stderr || ""}`.trim();
    hash.update(`probe\0${argv.join(" ")}\0${result.error ? `error:${result.error.code}` : result.status}\0${output}\n`);
  }

  return { digest: hash.digest("hex"), reason: `${files.length} file(s), ${pol.probes.length} probe(s)` };
}

export function decide() {
  const pol = policy();
  if (!pol.enabled) return { reuse: false, reason: pol.reason };

  const state = readJSON(STATE_FILE);
  if (!state) return { reuse: false, reason: "no baseline has been recorded yet" };
  if (state.status !== "green") {
    return { reuse: false, reason: `the recorded baseline is ${state.status || "unknown"} — red is never reused` };
  }
  if (!state.inputsDigest) {
    return { reuse: false, reason: "the recorded baseline predates the cache — it carries no inputsDigest" };
  }

  const { digest, reason } = inputsDigest(pol);
  if (!digest) return { reuse: false, reason };
  if (digest !== state.inputsDigest) return { reuse: false, reason: `inputs changed since ${state.checkedAt}` };

  const ageHours = (Date.now() - Date.parse(state.checkedAt)) / 3_600_000;
  if (!Number.isFinite(ageHours)) return { reuse: false, reason: "the recorded baseline has no readable checkedAt" };
  if (ageHours > pol.maxAgeHours) {
    return { reuse: false, reason: `the recorded baseline is ${ageHours.toFixed(1)}h old, past the ${pol.maxAgeHours}h limit` };
  }

  return { reuse: true, digest, state, reason: `inputs unchanged (${reason}), recorded ${ageHours.toFixed(1)}h ago` };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.includes("--digest")) {
    const { digest, reason } = inputsDigest();
    console.log(digest || `no digest: ${reason}`);
    process.exit(digest ? 0 : 1);
  }
  const decision = decide();
  console.log(decision.reuse
    ? `REUSE the recorded green baseline — ${decision.reason}`
    : `RUN the baseline — ${decision.reason}`);
  process.exit(decision.reuse ? 0 : 1);
}
