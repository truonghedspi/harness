#!/usr/bin/env node
// verify-harness.mjs — the VERIFY step of the harness lifecycle (create -> verify -> improve).
//
// check-coverage.mjs proves the 13 lessons are *structurally* present. This script proves the
// harness actually WORKS: no placeholders left, ./init.sh really goes green, recorded evidence
// really reproduces, loop artifacts are sane, and the tree is left in a clean state.
//
// Every failure is emitted as a finding classified by LAYER:
//   layer=project — the target repo must be fixed (fill a placeholder, make the build pass)
//   layer=harness — the harness/skill itself is at fault (scaffolder didn't write a file,
//                   substitution leaked, template can't express this stack)
// layer=harness findings are what feeds harness-issue.mjs and the self-improvement loop.
//
// Usage:
//   node verify-harness.mjs [--target DIR] [--json] [--report PATH]
//                           [--skip-baseline] [--run-features] [--promote]
//                           [--timeout-ms N] [--quiet]
// --promote (requires --run-features): mechanically flips readyForCheck/in-progress features to
// done when their verification command re-runs and exits 0 — the same mechanical half of the
// checker's job verify-harness already does (re-run the evidence, don't trust the claim). It does
// NOT replace the checker's semantic review (does the behavior actually match, is there scope
// bleed) — it only saves the checker from re-doing the purely mechanical "does this reproduce"
// step by hand. Never promotes a feature with any blocker finding against it.
// Exit: 0 iff no blocker findings.
import { readFileSync, writeFileSync, statSync, readdirSync, mkdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const args = process.argv.slice(2);
const opt = (n, d = null) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const flag = (n) => args.includes(n);

const TARGET = path.resolve(opt("--target", "."));
const AS_JSON = flag("--json");
const SKIP_BASELINE = flag("--skip-baseline");
const RUN_FEATURES = flag("--run-features");
const PROMOTE = flag("--promote");
const QUIET = flag("--quiet");
if (PROMOTE && !RUN_FEATURES) {
  console.error("error: --promote requires --run-features (promotion is based on evidence replay)");
  process.exit(2);
}
const TIMEOUT_MS = Number(opt("--timeout-ms", 900000));

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.resolve(scriptDir, "..");
const treeRoot = path.join(skillRoot, "templates", "tree");

const REPORT = path.resolve(opt("--report", path.join(TARGET, "trace", "verify-report.json")));

const P = (...p) => path.join(TARGET, ...p);
const exists = (p) => { try { statSync(p); return true; } catch { return false; } };
const read = (p) => { try { return readFileSync(p, "utf8"); } catch { return null; } };
const readJSON = (p) => { try { return JSON.parse(readFileSync(p, "utf8")); } catch { return null; } };
const lsSafe = (d) => { try { return readdirSync(d); } catch { return []; } };

// Same manifest set init.sh's if-elif chain recognizes. Used to tell apart "this stack has no
// verification block yet" (harness gap) from "there is no stack here at all" (project hasn't
// been set up — already reported by the structure gate's L2 check, don't double-report it here
// as a harness defect).
const MANIFESTS = ["package.json", "pyproject.toml", "requirements.txt", "go.mod", "Cargo.toml", "pom.xml", "build.gradle", "build.gradle.kts"];
const hasAnyManifest = () => MANIFESTS.some((m) => exists(P(m))) || lsSafe(TARGET).some((f) => f.endsWith(".csproj") || f.endsWith(".sln"));

// ---------------------------------------------------------------------------------------------
// Findings
// ---------------------------------------------------------------------------------------------
const findings = [];
/**
 * @param {{gate:string,id:string,layer:"project"|"harness",symptom:string,remedy:string,
 *          severity?:"blocker"|"warn",evidence?:string}} f
 */
const add = (f) => { findings.push({ severity: "blocker", evidence: "", ...f }); };

const blockers = () => findings.filter((f) => f.severity === "blocker");

// Paths the scaffolder is responsible for writing. If one of these is missing, that is a
// harness-layer defect (setup didn't do its job), not something the user forgot.
function scaffoldedPaths() {
  const out = new Set(["check-coverage.mjs"]);
  const walk = (dir, rel = "") => {
    for (const e of lsSafe(dir)) {
      const abs = path.join(dir, e);
      const childRel = rel ? `${rel}/${e}` : e;
      let st; try { st = statSync(abs); } catch { continue; }
      if (st.isDirectory()) walk(abs, childRel); else out.add(childRel);
    }
  };
  if (exists(treeRoot)) walk(treeRoot);
  return out;
}
const SCAFFOLDED = scaffoldedPaths();
// AGENTS.md may have been renamed to CLAUDE.md at setup time.
const scaffolderOwns = (p) => SCAFFOLDED.has(p) || (p === "CLAUDE.md" && SCAFFOLDED.has("AGENTS.md"));

function runCmd(cmd, { cwd = TARGET, timeout = TIMEOUT_MS, shell = true } = {}) {
  const r = spawnSync(cmd, { cwd, timeout, shell, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
  const stdout = r.stdout || "";
  const stderr = r.stderr || "";
  return {
    code: r.status,
    timedOut: r.error && r.error.code === "ETIMEDOUT",
    error: r.error ? r.error.message : null,
    out: stdout + stderr,
    tail: (stdout + stderr).split("\n").slice(-40).join("\n").trim(),
  };
}

// ---------------------------------------------------------------------------------------------
// Gate 1 — structural coverage (delegates to check-coverage.mjs)
// ---------------------------------------------------------------------------------------------
let coverage = null;
function gateStructure() {
  const local = P("check-coverage.mjs");
  const checker = exists(local) ? local : path.join(scriptDir, "check-coverage.mjs");
  if (!exists(checker)) {
    add({
      gate: "structure", id: "checker-missing", layer: "harness",
      symptom: "check-coverage.mjs not found in the target or the skill",
      remedy: "re-run setup-harness-loop.mjs, which copies check-coverage.mjs into the target",
    });
    return;
  }
  const r = spawnSync(process.execPath, [checker, "--target", TARGET, "--json"],
    { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
  let parsed = null;
  try { parsed = JSON.parse(r.stdout); } catch { /* handled below */ }
  if (!parsed) {
    add({
      gate: "structure", id: "checker-unparseable", layer: "harness",
      symptom: "check-coverage.mjs --json did not emit parseable JSON",
      remedy: "fix check-coverage.mjs output contract",
      evidence: (r.stdout || "").slice(0, 500) + (r.stderr || "").slice(0, 500),
    });
    return;
  }
  coverage = { passed: parsed.passed, total: parsed.total, results: parsed.results };
  for (const res of parsed.results.filter((x) => !x.pass)) {
    // "missing docs/foo.md" / "missing: a, b" → did the scaffolder own those files?
    const named = (res.detail.match(/[\w./-]+\.(md|json|mjs|sh)/g) || []);
    const ownedMissing = /missing/i.test(res.detail) && named.some(scaffolderOwns);
    add({
      gate: "structure",
      id: `lesson-${res.label.split(/\s+/)[0].toLowerCase()}`,
      layer: ownedMissing ? "harness" : "project",
      symptom: `${res.label}: ${res.detail}`,
      remedy: ownedMissing
        ? "the scaffolder should have written this file — fix templates/tree or setup-harness-loop.mjs"
        : "fill in the missing content in the target repo",
    });
  }
}

// ---------------------------------------------------------------------------------------------
// Gate 2 — placeholders: a scaffold that still says "REPLACE ME" is not a harness
// ---------------------------------------------------------------------------------------------
const PLACEHOLDER_PATTERNS = [
  [/REPLACE ME/i, "project", "REPLACE ME marker"],
  [/REPLACE with/i, "project", "REPLACE with … instruction"],
  [/\[Project-specific/i, "project", "[Project-specific …] stub"],
  [/One-line description of what this project does/i, "project", "default project purpose"],
  [/Replace with the first concrete behavior/i, "project", "placeholder feature behavior"],
  // A leaked mustache means substitution failed — that is the scaffolder's bug, not the user's.
  [/\{\{[A-Z_]+\}\}/, "harness", "unsubstituted {{TOKEN}}"],
];
function gatePlaceholders() {
  const candidates = [
    "AGENTS.md", "CLAUDE.md", "feature_list.json", "progress.md", "DECISIONS.md",
    "session-handoff.md", "init.sh",
    "loop/goal.md", "loop/maker-prompt.md", "loop/checker-prompt.md",
    ...lsSafe(P("docs")).filter((f) => f.endsWith(".md")).map((f) => `docs/${f}`),
  ];
  for (const rel of candidates) {
    const body = read(P(rel));
    if (body == null) continue;
    for (const [re, layer, label] of PLACEHOLDER_PATTERNS) {
      const m = body.match(re);
      if (!m) continue;
      const lineNo = body.slice(0, m.index).split("\n").length;
      add({
        gate: "placeholders", id: `placeholder:${rel}`, layer,
        symptom: `${rel}:${lineNo} still contains a ${label}`,
        remedy: layer === "harness"
          ? "setup-harness-loop.mjs substitution missed this token — add it to substitute()"
          : `replace the placeholder in ${rel} with the project's real content`,
        evidence: body.split("\n")[lineNo - 1].trim().slice(0, 200),
      });
      break; // one finding per file is enough to make the point
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Gate 3 — baseline: ./init.sh must actually go green
// ---------------------------------------------------------------------------------------------
let baseline = null;
function gateBaseline() {
  if (SKIP_BASELINE) { baseline = { skipped: true }; return; }
  if (!exists(P("init.sh"))) return; // already reported by the structure gate
  const started = Date.now();
  const r = runCmd("./init.sh");
  baseline = { code: r.code, ms: Date.now() - started, timedOut: !!r.timedOut, tail: r.tail };

  // A gate that cannot go red is not a gate. Exit 0 while verifying nothing is worse than exit 1:
  // it green-lights a loop on an unverified project. A stack-less target with no manifest at all
  // is a project-setup gap (L2 already reports it) — only a manifest init.sh fails to recognize
  // is a harness gap.
  if (r.code === 0 && /No recognized manifest|Edit this VERIFICATION block/i.test(r.out)) {
    add({
      gate: "baseline", id: "init-vacuously-green", layer: hasAnyManifest() ? "harness" : "project",
      symptom: "./init.sh exited 0 without running any build/test step",
      remedy: hasAnyManifest()
        ? "init.sh must fail when it recognizes no stack — a vacuous green lets a loop run on an unverified project"
        : "add the project's manifest (package.json/pom.xml/...) so init.sh has a stack to verify",
      evidence: r.tail,
    });
    return;
  }
  if (r.code === 0) return;

  // Classify: is init.sh unable to express this stack, or is the project genuinely broken?
  const out = r.out;
  const harnessSignals = [
    [/No recognized manifest/i, "init.sh has no verification block for this project's stack", hasAnyManifest],
    [/(mvn|gradle|dotnet|cargo|go|pytest):?\s*(command not found|not found)/i,
      "init.sh calls a build tool that is not on PATH while a wrapper may exist", () => true],
  ];
  const hit = harnessSignals.find(([re, , applies]) => re.test(out) && applies());
  const wrapperPresent = exists(P("mvnw")) || exists(P("gradlew"));
  add({
    gate: "baseline", id: "init-red",
    layer: hit ? "harness" : "project",
    severity: "blocker",
    symptom: r.timedOut
      ? `./init.sh timed out after ${TIMEOUT_MS}ms`
      : `./init.sh exited ${r.code}${hit ? ` — ${hit[1]}` : ""}`,
    remedy: hit
      ? (wrapperPresent
        ? "init.sh should prefer ./mvnw / ./gradlew when a wrapper exists — fix templates/tree/init.sh"
        : "extend the VERIFICATION block in templates/tree/init.sh to cover this stack")
      : "fix the project until ./init.sh is green — a loop on a red baseline amplifies failure",
    evidence: r.tail,
  });
}

// ---------------------------------------------------------------------------------------------
// Gate 4 — features: real verification commands, and evidence that reproduces
// ---------------------------------------------------------------------------------------------
const PLACEHOLDER_VERIF = /^(REPLACE|TODO|TBD|n\/a|none)\b/i;
let featureReplay = [];
let promoted = [];
let featureListPath = null;
let featureListData = null;
let featureListArray = null;

function gateFeatures() {
  featureListPath = P("feature_list.json");
  featureListData = readJSON(featureListPath);
  featureListArray = featureListData && Array.isArray(featureListData.features) ? featureListData.features : null;
  const features = featureListArray;
  if (!features) return; // structure gate covers a missing/invalid file

  const decisions = read(P("DECISIONS.md")) || "";

  for (const f of features) {
    const verif = String(f.verification || f.verify || "").trim();
    if (!verif || PLACEHOLDER_VERIF.test(verif)) {
      add({
        gate: "features", id: `verification:${f.id}`, layer: "project",
        symptom: `feature ${f.id} (${f.name}) has no runnable verification command`,
        remedy: "every feature needs a real command; 'looks right' is not a stopping condition",
        evidence: verif.slice(0, 200),
      });
    }
    // Claiming done without evidence is exactly the failure mode Lesson 9 exists to stop.
    const claimed = ["passing", "done"].includes(String(f.status || f.state));
    if (claimed && !String(f.evidence || "").trim()) {
      add({
        gate: "features", id: `evidence-missing:${f.id}`, layer: "project",
        symptom: `feature ${f.id} claims status=${f.status} with an empty evidence field`,
        remedy: "record the command + result that proves it, or move the feature back to in-progress",
      });
    }
    // An unexplained "blocked" is indistinguishable from silently giving up (docs/constraints.md).
    if (String(f.status || f.state) === "blocked") {
      const hasNote = String(f.checkerNotes || "").trim().length > 0;
      const hasDecisionEntry = decisions.includes(f.id);
      if (!hasNote && !hasDecisionEntry) {
        add({
          gate: "features", id: `blocked-unjustified:${f.id}`, layer: "project",
          symptom: `feature ${f.id} is blocked with no reason in checkerNotes and no DECISIONS.md entry mentioning it`,
          remedy: "write the concrete blocker into checkerNotes, or add a DECISIONS.md entry referencing this feature id",
        });
      }
    }
    // The timebox itself (docs/constraints.md): a feature over budget must stop retrying and
    // hand off to blocked, not keep trying silently forever.
    const maxAttempts = Number(f.maxAttempts);
    const attempts = Number(f.attempts);
    if (Number.isFinite(maxAttempts) && maxAttempts > 0 && Number.isFinite(attempts) &&
        attempts >= maxAttempts && String(f.status || f.state) !== "blocked") {
      add({
        gate: "features", id: `over-budget:${f.id}`, layer: "project",
        symptom: `feature ${f.id} has attempts=${attempts} >= maxAttempts=${maxAttempts} but status is "${f.status}", not "blocked"`,
        remedy: "the maker must stop retrying once the timebox is exhausted and set status=blocked with a reason (docs/constraints.md)",
      });
    }
    // Heuristic, not a hard rule (severity: warn): a compound or overlong behavior sentence is
    // the cheapest early signal that a feature is actually two features, or too big for one
    // maker iteration to hold in context — see references/feature-decomposition.md Step 3.
    const behavior = String(f.behavior || "").trim();
    if (behavior) {
      const joiners = (behavior.match(/\b(and|then)\b/gi) || []).length;
      const tooLong = behavior.length > 400;
      const tooCompound = joiners >= 3;
      if (tooLong || tooCompound) {
        add({
          gate: "features", id: `scope-smell:${f.id}`, layer: "project", severity: "warn",
          symptom: `feature ${f.id}'s behavior sentence looks oversized (${behavior.length} chars` +
            (tooCompound ? `, ${joiners} and/then joiners` : "") + `) — possibly two features`,
          remedy: "split at the joining clause into separate features with a dependency edge (references/feature-decomposition.md Step 3), or confirm this really is one atomic behavior",
          evidence: behavior.slice(0, 200),
        });
      }
    }
  }

  if (!RUN_FEATURES) return;
  // Mechanized falsification: re-run the evidence of everything claimed green, or offered for
  // check (readyForCheck) — --promote acts on this same replay, so it must cover readyForCheck
  // features too, not just already-claimed passing/done ones.
  for (const f of features) {
    const claimed = ["passing", "done"].includes(String(f.status || f.state));
    const offered = f.readyForCheck === true;
    const verif = String(f.verification || f.verify || "").trim();
    if ((!claimed && !offered) || !verif || PLACEHOLDER_VERIF.test(verif)) continue;
    const r = runCmd(verif);
    featureReplay.push({ id: f.id, command: verif, code: r.code, timedOut: !!r.timedOut });
    if (r.code !== 0) {
      add({
        gate: "features", id: `evidence-not-reproducible:${f.id}`, layer: "project",
        symptom: `feature ${f.id} is ${f.status} but its verification exits ${r.code}`,
        remedy: "the checker must reject this feature — evidence does not reproduce",
        evidence: r.tail,
      });
    }
  }
}

// Mechanical half of the checker's job: a feature whose evidence just reproduced clean, with no
// blocker finding anywhere against it, gets flipped to done. Never touches a feature with any
// blocker — including ones unrelated to it, since a harness-layer blocker means the whole
// verification run isn't trustworthy yet.
function promoteFeatures() {
  if (!PROMOTE || !featureListArray) return;
  if (blockers().length > 0) return; // do not promote anything out of an untrustworthy run
  const reproducedIds = new Set(featureReplay.filter((r) => r.code === 0).map((r) => r.id));
  const now = new Date().toISOString().slice(0, 10);
  for (const f of featureListArray) {
    if (!reproducedIds.has(f.id)) continue;
    const status = String(f.status || f.state);
    // blocked is a human/checker call that passing evidence is not enough (e.g. the test was
    // narrowed to what's provable and a requirement gap remains) — mechanical promotion must
    // never override that judgment just because the narrowed command still exits 0.
    if (status === "done" || status === "blocked") continue;
    const note = `[mechanically promoted by verify-harness --promote on ${now}: verification re-run, exited 0]`;
    f.status = "done";
    f.readyForCheck = false;
    f.checkerNotes = f.checkerNotes ? `${f.checkerNotes}\n${note}` : note;
    promoted.push(f.id);
  }
  if (promoted.length) {
    writeFileSync(featureListPath, JSON.stringify(featureListData, null, 2) + "\n");
  }
}

// ---------------------------------------------------------------------------------------------
// Gate 5 — loop artifacts: a loop is only as good as its goal, its split, and its stop conditions
// ---------------------------------------------------------------------------------------------
function gateLoop() {
  const goal = read(P("loop/goal.md"));
  if (goal) {
    if (!/stop condition/i.test(goal)) {
      add({
        gate: "loop", id: "goal-no-stop", layer: "project",
        symptom: "loop/goal.md has no stop-condition section",
        remedy: "a loop without a stopping condition does not terminate — add one",
      });
    }
    if (!/\b(init\.sh|npm|pnpm|yarn|bun|mvn|gradle|pytest|cargo|go test|dotnet|\.\/mvnw|\.\/gradlew)\b/i.test(goal)) {
      add({
        gate: "loop", id: "goal-not-machine-checkable", layer: "project", severity: "warn",
        symptom: "loop/goal.md names no concrete command in its stopping condition",
        remedy: "state termination as a command that exits 0, not as a description",
      });
    }
  }
  const maker = read(P("loop/maker-prompt.md"));
  if (maker && !/(never|not).{0,40}\bdone\b/is.test(maker)) {
    add({
      gate: "loop", id: "maker-may-self-grade", layer: "harness", severity: "warn",
      symptom: "loop/maker-prompt.md does not forbid the maker from setting status=done",
      remedy: "generator/evaluator separation: only the checker may flip done — fix the template",
    });
  }
  for (const rel of lsSafe(P(".kiro", "agents")).filter((f) => f.endsWith(".json"))) {
    const j = readJSON(P(".kiro", "agents", rel));
    // An agent that can write but never loads the rulebook will violate rules it has never seen —
    // and the violation looks like ordinary output, so nothing catches it. Any always-remember
    // rule (file-size budget, index requirement, project invariants) lives in docs/constraints.md
    // precisely because it is auto-loaded; this check is what keeps that guarantee true.
    if (j && (j.tools || []).includes("write") && Array.isArray(j.resources)
        && !j.resources.some((r) => String(r).includes("constraints.md"))
        && exists(P("docs", "constraints.md"))) {
      add({
        gate: "loop", id: `agent-missing-constraints:${j.name || rel}`, layer: "harness", severity: "warn",
        symptom: `${j.name || rel} can write files but does not load docs/constraints.md — it cannot follow rules it never sees`,
        remedy: "add file://../../docs/constraints.md to that agent's resources in templates/tree/.kiro/agents/",
      });
    }
    if (!j) {
      add({
        gate: "loop", id: `agent-json-invalid:${rel}`, layer: "harness",
        symptom: `.kiro/agents/${rel} is not valid JSON — kiro-cli will refuse to start it`,
        remedy: "fix the agent template in templates/tree/.kiro/agents/",
      });
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Gate 6 — clean state (Lesson 12). A warn, not a blocker: mid-session dirt is normal.
// ---------------------------------------------------------------------------------------------
function gateCleanState() {
  if (!exists(P(".git"))) {
    add({
      gate: "clean-state", id: "not-a-repo", layer: "project", severity: "warn",
      symptom: "target is not a git repository — clean-state cannot be verified or restored",
      remedy: "git init the target so every session can prove it left a clean tree",
    });
    return;
  }
  const r = runCmd("git status --porcelain", { timeout: 30000 });
  const dirty = r.out.split("\n").map((l) => l.trim()).filter(Boolean);
  if (dirty.length > 30) {
    add({
      gate: "clean-state", id: "tree-very-dirty", layer: "project", severity: "warn",
      symptom: `${dirty.length} uncommitted paths in the working tree`,
      remedy: "commit or clean before ending the session (Lesson 12)",
    });
  }
}

// ---------------------------------------------------------------------------------------------
// Gate 7 — agent memory (references/agent-memory.md). Warn, not a blocker: a missing or oversized
// memory file means an agent starts one run without its accumulated lessons, or with an index
// that's stopped being cheap to load — not a broken harness. Structural check only; the actual
// consolidation call (what to merge, what to archive) is memory-consolidate.mjs's report plus a
// human/agent judgment, not something this gate can decide.
// ---------------------------------------------------------------------------------------------
const MEMORY_INDEX_MAX_LINES = 200;

function gateMemory() {
  for (const rel of lsSafe(P(".kiro", "agents")).filter((f) => f.endsWith(".json"))) {
    const j = readJSON(P(".kiro", "agents", rel));
    if (!j || !Array.isArray(j.resources)) continue;
    for (const res of j.resources) {
      // Agent JSONs live in .kiro/agents/, so kiro-cli resolves their file:// URIs relative to
      // THAT directory — the templates carry a ../../ prefix. Tolerate any depth of it.
      const m = /^file:\/\/(?:\.\.\/)*(memory\/[^/]+\/MEMORY\.md)$/.exec(res);
      if (!m) continue;
      const memPath = m[1];
      if (!exists(P(memPath))) {
        add({
          gate: "memory", id: `memory-missing:${j.name || rel}`, layer: "project", severity: "warn",
          symptom: `${j.name || rel} references ${memPath} in its resources, but the file does not exist`,
          remedy: "scaffold it (mkdir -p the memory/<agent> dir and add a MEMORY.md index) or remove the stale resource entry",
        });
        continue;
      }
      const lines = read(P(memPath)).split("\n").length;
      if (lines > MEMORY_INDEX_MAX_LINES) {
        add({
          gate: "memory", id: `memory-index-over-budget:${j.name || rel}`, layer: "project", severity: "warn",
          symptom: `${memPath} is ${lines} lines (budget ${MEMORY_INDEX_MAX_LINES}) — no longer cheap to load every run`,
          remedy: "run scripts/memory-consolidate.mjs and archive/merge the oldest or least-useful entries",
        });
      }
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Gate 8 — design hygiene (references/design-engineering.md). All warn: design quality is a
// heuristic and a false positive must never stop a loop. These catch the mechanical half —
// uncited claims, a blocked feature resting on an unverified assumption, a named component no
// feature covers — leaving the reasoning defects to the design-reviewer's judgment.
// ---------------------------------------------------------------------------------------------
const WEAK_EVIDENCE = /^(|todo|tbd|n\/a|—|-|\?|recall|from memory|typically|should be)$/i;

function parseAssumptions() {
  const raw = read(P("docs", "assumptions.md"));
  if (!raw) return [];
  const rows = [];
  for (const line of raw.split("\n")) {
    if (!line.trim().startsWith("|") || /^\|[\s|:-]+\|$/.test(line.trim())) continue;
    const cells = line.split("|").slice(1, -1).map((c) => c.trim());
    if (cells.length < 5 || /^id$/i.test(cells[0])) continue;
    rows.push({ id: cells[0], assumption: cells[1], status: cells[2].toLowerCase(), ifFalse: cells[3], dependents: cells[4] });
  }
  return rows;
}

function gateDesign() {
  // 8a — uncited claims in any docs/design/*.md claims table.
  for (const f of lsSafe(P("docs", "design")).filter((f) => f.endsWith(".md") && f !== "README.md")) {
    const lines = read(P("docs", "design", f)).split("\n");
    lines.forEach((line, i) => {
      const t = line.trim();
      if (!t.startsWith("|") || /^\|[\s|:-]+\|$/.test(t)) return;
      const cells = t.split("|").slice(1, -1).map((c) => c.trim());
      if (cells.length !== 2 || /^claim$/i.test(cells[0])) return;
      if (WEAK_EVIDENCE.test(cells[1])) {
        add({
          gate: "design", id: `design-claim-uncited:${f}:${i + 1}`, layer: "project", severity: "warn",
          symptom: `docs/design/${f}:${i + 1} states a claim with no real evidence ("${cells[1] || "empty"}")`,
          remedy: "cite a path:line from a checkout on this machine, or a spike under spikes/ that runs — recall is not a citation",
          evidence: t.slice(0, 200),
        });
      }
    });
  }

  // 8b — a blocked feature resting on an assumption nobody verified. This is the failure mode
  // that cost this skill's dogfood project a week: a correct conclusion under an unstated premise.
  const assumptions = parseAssumptions();
  const byId = new Map((featureListArray || []).map((f) => [f.id, f]));
  for (const a of assumptions) {
    if (a.status.startsWith("verified")) continue;
    for (const dep of a.dependents.split(/[,\s]+/).map((d) => d.trim()).filter((d) => byId.has(d))) {
      if (String(byId.get(dep).status || byId.get(dep).state) !== "blocked") continue;
      add({
        gate: "design", id: `design-assumption-unverified:${dep}`, layer: "project", severity: "warn",
        symptom: `${dep} is blocked while resting on assumption ${a.id} (status: ${a.status || "unset"})`,
        remedy: `verify ${a.id} before accepting the block — a conclusion can be correct under a premise that is simply false (references/design-engineering.md)`,
        evidence: a.assumption.slice(0, 200),
      });
    }
  }

  // 8c — a component named in architecture.md that no feature covers (total-mapping idea).
  const arch = read(P("docs", "architecture.md"));
  if (arch && featureListArray && featureListArray.length) {
    const haystack = featureListArray.map((f) => `${f.id} ${f.name || ""} ${f.behavior || ""}`).join(" ").toLowerCase();
    for (const m of arch.matchAll(/^-\s+\*\*(.+?)\*\*/gm)) {
      const name = m[1].replace(/\(.*?\)/g, " ").trim();
      const tokens = name.toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length >= 4);
      if (!tokens.length || tokens.some((t) => haystack.includes(t))) continue;
      add({
        gate: "design", id: `design-component-uncovered:${name.replace(/\s+/g, "-").toLowerCase()}`,
        layer: "project", severity: "warn",
        symptom: `docs/architecture.md names component "${name}" but no feature mentions it`,
        remedy: "either add a feature covering it (feature-planner) or drop it from the architecture — a named component with no feature is a coverage hole",
      });
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Gate 9 — knowledge layout (references/knowledge-layout.md). Past ~300 lines a document stops
// being reliably USED: it gets skimmed, the middle is dropped, and the agent acts on a partial
// reading while believing it read the whole thing — a failure that raises no error. Warn only.
// ---------------------------------------------------------------------------------------------
const DOC_MAX_LINES = 300;

function gateDocs() {
  const seen = [];
  const walk = (dir, rel = "") => {
    for (const e of lsSafe(dir)) {
      if (e.startsWith(".") || ["node_modules", "target", "build", "dist", "trace"].includes(e)) continue;
      const abs = path.join(dir, e);
      const childRel = rel ? `${rel}/${e}` : e;
      let st; try { st = statSync(abs); } catch { continue; }
      if (st.isDirectory()) { walk(abs, childRel); continue; }
      if (!e.endsWith(".md")) continue;
      // AGENTS.md and MEMORY.md carry their own tighter budgets, checked elsewhere.
      if (e === "AGENTS.md" || e === "CLAUDE.md" || e === "MEMORY.md") continue;
      // A frozen, INDEXED archive is exempt: you never read it end to end, you follow its index
      // to one entry (references/knowledge-layout.md Pattern B). The condition must be narrow:
      // the directory needs BOTH its own INDEX.md AND a live sibling file it was rotated out of
      // (DECISIONS/ next to DECISIONS.md). Without that second half, `docs/` — which has an
      // INDEX.md of its own — would exempt every document in the project. Caught by demo.sh
      // immediately after the first, looser version shipped.
      const isRotatedArchive = rel && exists(path.join(dir, "INDEX.md")) &&
        exists(path.join(path.dirname(dir), `${path.basename(dir)}.md`));
      if (isRotatedArchive && e !== "INDEX.md") continue;
      const n = read(abs).split("\n").length;
      if (n > DOC_MAX_LINES) seen.push({ rel: childRel, n });
    }
  };
  walk(TARGET);
  for (const d of seen) {
    const isLog = /DECISIONS|progress|CHANGELOG/i.test(d.rel);
    add({
      gate: "docs", id: `doc-over-budget:${d.rel}`, layer: "project", severity: "warn",
      symptom: `${d.rel} is ${d.n} lines (budget ${DOC_MAX_LINES}) — past this an agent skims it and silently acts on a partial reading`,
      remedy: isLog
        ? "append-only log: rotate closed periods into a dated archive + an index, keeping recent entries live (references/knowledge-layout.md Pattern B)"
        : "topic doc: split at section boundaries into sibling files and leave the original as a map that keeps its filename (references/knowledge-layout.md Pattern A)",
    });
  }
  // An index is what makes the budget survivable — without it, splitting just scatters knowledge.
  if (seen.length && !exists(P("docs", "INDEX.md"))) {
    add({
      gate: "docs", id: "doc-index-missing", layer: "project", severity: "warn",
      symptom: "documents exceed the size budget but docs/INDEX.md does not exist — split files with no map are harder to use than one long file",
      remedy: "add docs/INDEX.md with one line per document and a 'read it when' column",
    });
  }
}

// ---------------------------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------------------------
gateStructure();
gatePlaceholders();
gateBaseline();
gateFeatures();
gateLoop();
gateCleanState();
gateMemory();
gateDesign();
gateDocs();
promoteFeatures();

const byLayer = (l) => findings.filter((f) => f.layer === l);
const report = {
  schema: "harness-verify/1",
  target: TARGET,
  timestamp: new Date().toISOString(),
  green: blockers().length === 0,
  coverage,
  baseline,
  featureReplay,
  promoted,
  counts: {
    blockers: blockers().length,
    warnings: findings.length - blockers().length,
    harnessLayer: byLayer("harness").length,
    projectLayer: byLayer("project").length,
  },
  findings,
};

try {
  mkdirSync(path.dirname(REPORT), { recursive: true });
  writeFileSync(REPORT, JSON.stringify(report, null, 2));
} catch (e) {
  if (!QUIET) console.error(`warning: could not write report to ${REPORT}: ${e.message}`);
}

// Record the verdict in the task trace when the target has one (Lesson 11).
if (exists(P("tools/trace.mjs"))) {
  spawnSync(process.execPath, ["tools/trace.mjs", "verify",
    report.green ? "verify-green" : "verify-red",
    `blockers=${report.counts.blockers} harness=${report.counts.harnessLayer}`],
    { cwd: TARGET, encoding: "utf8" });
}

if (AS_JSON) {
  console.log(JSON.stringify(report, null, 2));
} else if (!QUIET) {
  console.log(`\nHarness verify — ${TARGET}\n`);
  if (coverage) console.log(`  structure : ${coverage.passed}/${coverage.total} lessons`);
  if (baseline) {
    console.log(`  baseline  : ${baseline.skipped ? "skipped" : baseline.code === 0 ? `green (${baseline.ms}ms)` : `RED (exit ${baseline.code})`}`);
  }
  if (featureReplay.length) {
    const bad = featureReplay.filter((f) => f.code !== 0).length;
    console.log(`  evidence  : replayed ${featureReplay.length}, ${bad} did not reproduce`);
  }
  if (PROMOTE) {
    console.log(`  promote   : ${promoted.length ? `${promoted.length} feature(s) -> done: ${promoted.join(", ")}` : "0 features promoted"}`);
  }
  console.log("");
  if (!findings.length) {
    console.log("  No findings. Harness is green — safe to start the loop.\n");
  } else {
    for (const layer of ["harness", "project"]) {
      const rows = byLayer(layer);
      if (!rows.length) continue;
      console.log(`  ── layer: ${layer} (${rows.length}) ${layer === "harness" ? "— fix the skill, then re-scaffold" : "— fix the target repo"}`);
      for (const f of rows) {
        console.log(`     ${f.severity === "blocker" ? "BLOCK" : "warn "}  [${f.gate}] ${f.symptom}`);
        console.log(`            → ${f.remedy}`);
      }
      console.log("");
    }
    console.log(`  ${report.counts.blockers} blocker(s), ${report.counts.warnings} warning(s). Report: ${REPORT}`);
    if (report.counts.harnessLayer) {
      console.log(`  ${report.counts.harnessLayer} harness-layer finding(s) — feed them back:`);
      console.log(`     node ${path.relative(process.cwd(), path.join(scriptDir, "harness-issue.mjs"))} import --report ${REPORT}`);
    }
    console.log("");
  }
}

process.exit(report.green ? 0 : 1);
