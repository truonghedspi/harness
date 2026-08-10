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
const WALK_SKIP = new Set(["node_modules", ".git", "target", "build", "dist", "trace", ".venv", "venv", "__pycache__"]);
/** Bounded recursive walk — used to locate a file by basename without shelling out. */
const walk = (dir, depth = 12, acc = []) => {   // deep enough for src/test/java/<package…>/
  if (depth < 0) return acc;
  for (const name of lsSafe(dir)) {
    if (WALK_SKIP.has(name)) continue;
    const p = path.join(dir, name);
    let st; try { st = statSync(p); } catch { continue; }
    if (st.isDirectory()) walk(p, depth - 1, acc); else acc.push(p);
  }
  return acc;
};

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
const add = (f) => { findings.push({ severity: "blocker", evidence: "", count: 1, ...f }); };

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
  // A justification may live in a rotated archive (knowledge-layout Pattern B) — rotation must not
  // make a properly-justified block look unjustified.
  const decisionsAll = decisions + lsSafe(P("DECISIONS"))
    .filter((f) => f.endsWith(".md"))
    .map((f) => read(P("DECISIONS", f)) || "").join("\n");

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
      const hasDecisionEntry = decisionsAll.includes(f.id);   // live log + rotated archive
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

  // An escalation with no trace of exploration is the cheapest kind of waste to catch: the agent
  // spent a human's attention without spending two minutes of its own first
  // (references/human-attention.md). Warn only — under-asking is worse than over-asking, so this
  // must never discourage a genuine question, only an unexplored one.
  const EXPLORED = /(`[^`]*(?:\.\/|node |npm |mvn|gradle|kubectl|helm|git |grep|curl)[^`]*`|\w+\.(?:java|mjs|js|ts|py|go|kt|md):\d+|\bspike\b|exit(?:ed)? \d|\bexit code\b|reproduc)/i;
  for (const f of features) {
    if (String(f.status || f.state) !== "blocked") continue;
    const why = String(f.checkerNotes || "");
    const inDecisions = decisionsAll.includes(f.id);
    if (EXPLORED.test(why) || (inDecisions && EXPLORED.test(decisionsAll))) continue;
    add({
      gate: "features", id: `escalation-without-evidence:${f.id}`, layer: "project", severity: "warn",
      symptom: `${f.id} is blocked but its justification shows no exploration — no command run, no path:line, no spike`,
      remedy: "climb the exhaustion ladder before escalating: registry, memory, environment, spike, prototype (references/human-attention.md). If it survives, ask the human a question rather than leaving it blocked",
      evidence: why.slice(0, 200),
    });
  }

  // --- test-authoring gates (references/test-authoring.md) ---------------------------------------
  // The circularity these exist for: the same agent writes the code and the test, so both can be
  // wrong in the same direction and everything still passes. None of these catch a well-disguised
  // tautology — that is the reviewer's R-T3/R-T9 pass. They catch the lazy version, which is the
  // common one. All are grouped into single findings: 20 identical warnings is the wall that
  // review-digest exists to remove, and this must not rebuild it.

  // 1. Red-green. A test nobody ever saw fail is not known to test anything.
  const RED = /\b(red|fail(?:ed|ing|ure)?s?|exit(?:ed)? [1-9]|non-zero|assertion ?error|✗)\b/i;
  const noRed = features.filter((f) =>
    ["passing", "done"].includes(String(f.status || f.state)) &&
    String(f.evidence || "").trim() && !RED.test(String(f.evidence)));
  if (noRed.length) {
    add({
      gate: "features", id: "evidence-no-red", layer: "project", severity: "warn", count: noRed.length,
      symptom: `${noRed.length} green feature(s) record no red step — their evidence never shows the verification failing before it passed`,
      remedy: "record both halves in evidence: the command failing against the unimplemented behavior, then passing after. A test that was only ever seen green may be asserting nothing (references/test-authoring.md)",
      evidence: noRed.slice(0, 5).map((f) => f.id).join(", ") + (noRed.length > 5 ? ", …" : ""),
    });
  }

  // 2. Falsifier. "What wrong implementation does this verification catch?" is the question that
  // separates a real oracle from a command that exits 0. Asked at planning time, when it is cheap.
  const pending = features.filter((f) => ["not-started", "in-progress", "active"].includes(String(f.status || f.state)));
  const noFalsifier = pending.filter((f) => !String(f.falsifier || "").trim());
  if (pending.length && noFalsifier.length) {
    add({
      gate: "features", id: "falsifier-missing", layer: "project", severity: "warn", count: noFalsifier.length,
      symptom: `${noFalsifier.length}/${pending.length} unfinished feature(s) have no "falsifier" field naming the wrong implementation their verification would catch`,
      remedy: 'add "falsifier": "<a specific wrong implementation this command fails on>" to each. If you cannot name one, the verification does not discriminate and the feature is not yet decomposed (references/test-authoring.md)',
      evidence: noFalsifier.slice(0, 5).map((f) => f.id).join(", ") + (noFalsifier.length > 5 ? ", …" : ""),
    });
  }

  // 3. Every build feature needs an independent oracle. Dependency *direction* is the wrong thing
  // to check here — prove→build is correct for completion order, and authoring order (test first)
  // is not expressible in the DAG at all; the red-evidence check above is what covers that.
  // What the DAG *does* answer is whether a piece of implementation was ever given a separate
  // acceptance claim, or whether it only ever judges itself. Opt-in: silent for projects whose
  // features carry no `kind`, so it never fires spuriously.
  const kinded = features.filter((f) => f.kind === "build" || f.kind === "prove");
  if (kinded.length) {
    const provenIds = new Set(features.filter((f) => f.kind === "prove")
      .flatMap((f) => f.dependencies || []));
    const unproven = features.filter((f) => f.kind === "build" && !provenIds.has(f.id));
    if (unproven.length) {
      add({
        gate: "features", id: "build-unproven", layer: "project", severity: "warn", count: unproven.length,
        symptom: `${unproven.length} build feature(s) have no prove feature depending on them — their only judge is the test shipped alongside the implementation`,
        remedy: "give each one a prove feature carrying the acceptance claim, authored from the spec rather than from the code (references/test-authoring.md). A feature that supplies both the implementation and its own oracle can be wrong in both directions at once",
        evidence: unproven.slice(0, 5).map((f) => f.id).join(", ") + (unproven.length > 5 ? ", …" : ""),
      });
    }
  }

  // 4. Traceability (R-T6). Only checks test files a feature's verification actually names — broad
  // scanning would flood every legacy suite and teach everyone to ignore the gate.
  const cited = new Set();
  for (const f of features) {
    const v = String(f.verification || "");
    // a path with an extension (jest/pytest/go), or a bare class name in a -Dtest= selector (maven)
    for (const m of v.matchAll(/[\w/.-]+(?:Test|IT|SIT|Spec|_test)\.\w+/g)) cited.add(m[0]);
    for (const m of v.matchAll(/-D(?:it\.)?test=([\w.$,]+)/g)) {
      for (const cls of m[1].split(",")) if (cls.trim()) cited.add(cls.trim().split(".").pop().split("$")[0] + ".java");
    }
  }
  const untraceable = [];
  const allFiles = cited.size ? walk(TARGET) : [];
  for (const name of cited) {
    const base = path.basename(name);
    const hits = allFiles.filter((p) => path.basename(p) === base);
    for (const hit of hits.slice(0, 1)) {
      const head = (read(hit) || "").split("\n").slice(0, 40).join("\n");
      // Accepted forms of "this test traces to a spec": an explicit id, or a section citation
      // into a spec document. Both let a reviewer go from the test back to what it must satisfy.
      const TRACEABLE = /\b(REQ-[A-Z0-9-]+|TCON-[A-Z0-9-]+|condition_id|requirement_id|feat-[\w-]+)\b|§\s*\d|\b(?:section|case)\s+\d/i;
      if (head && !TRACEABLE.test(head)) {
        untraceable.push(path.relative(TARGET, hit));
      }
    }
  }
  if (untraceable.length) {
    add({
      gate: "features", id: "test-untraceable", layer: "project", severity: "warn", count: untraceable.length,
      symptom: `${untraceable.length} test file(s) named by a feature's verification carry no traceability header naming the requirement or condition they implement`,
      remedy: "open each with a comment block listing its requirement_id / condition_id / feature id. A test that cannot be traced to a spec was probably derived from the code it is meant to judge (R-T6, references/test-authoring.md)",
      evidence: untraceable.slice(0, 5).join(", ") + (untraceable.length > 5 ? ", …" : ""),
    });
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
  // An agent nobody can reach is an agent nobody runs. The router (AGENTS.md/CLAUDE.md) is the
  // first file every session reads (Lesson 4), so an agent it never names is discoverable only by
  // listing .kiro/agents/ and guessing — which is how ten nodes ended up with three executable
  // incoming edges (docs/reference/graph.md, "The seven implicit edges"). Warn, because a node may
  // legitimately be dispatched only by loop/route.mjs; being named in either is enough.
  const routerText = (read(P("AGENTS.md")) || "") + (read(P("CLAUDE.md")) || "") +
    (read(P("loop", "route.mjs")) || "");
  const agentNames = lsSafe(P(".kiro", "agents")).filter((f) => f.endsWith(".json"))
    .map((f) => (readJSON(P(".kiro", "agents", f)) || {}).name).filter(Boolean);
  const unnamed = agentNames.filter((n) => !routerText.includes(n));
  if (agentNames.length && unnamed.length) {
    add({
      gate: "loop", id: "agent-unrouted", layer: "project", severity: "warn", count: unnamed.length,
      symptom: `${unnamed.length} of ${agentNames.length} agent(s) are named by neither the router nor loop/route.mjs — nothing tells a session they exist or when to run them`,
      remedy: "name each in the router's agent table with the condition that selects it, or give it a rule in loop/route.mjs. An agent reachable only by guessing is a node with no incoming edge (docs/reference/graph.md)",
      evidence: unnamed.slice(0, 6).join(", ") + (unnamed.length > 6 ? ", …" : ""),
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
    // An agent told to update a file it has no write permission for will fail at the moment it
    // matters, in a way no test covers — the instruction reads fine and the config reads fine; only
    // the pair is wrong. Found in the wild: the designer's prompt says "register it in
    // docs/cross-cutting.md" while its allowedPaths omitted that file.
    if (j && Array.isArray(j.toolsSettings?.write?.allowedPaths)) {
      const allowed = j.toolsSettings.write.allowedPaths;
      const covers = (f) => allowed.some((a) =>
        a === f || (a.endsWith("/**") && f.startsWith(a.slice(0, -2))));
      const promptRel = String(j.prompt || "").replace(/^file:\/\/(\.\.\/)*/, "");
      const body = read(P(promptRel)) || "";
      const WRITE_VERB = /\b(write|writes|writing|register|registers|record|records|update|updates|fill|fills|add(?:ing)? (?:a |one |it )?(?:row|line|entry)?\s*to)\b/i;
      const wanted = new Set();
      // "You do NOT write feature_list.json" is an instruction not to — and a path cited in
      // parentheses is a reference, not a target. Both showed up as false positives on the first run.
      const NEGATED = /\b(not|never|n't|cannot|instead of)\b/i;
      for (const line of body.split("\n")) {
        if (!WRITE_VERB.test(line) || NEGATED.test(line)) continue;
        for (const m of line.matchAll(/`(docs\/[\w./-]+\.md|feature_list\.json|DECISIONS\.md|progress\.md|loop\/[\w.-]+\.md|session-handoff\.md)`/g)) {
          // docs/reference/** is read-only knowledge copied in by setup — citing it is never a write.
          if (!m[1].startsWith("docs/reference/")) wanted.add(m[1]);
        }
      }
      for (const f of wanted) {
        if (covers(f)) continue;
        add({
          gate: "loop", id: `agent-cannot-write-instructed:${j.name || rel}:${f}`, layer: "harness", severity: "warn",
          symptom: `${j.name || rel}'s prompt tells it to write ${f}, but that path is not in its write allowedPaths`,
          remedy: `either add ${f} to that agent's allowedPaths in templates/tree/.kiro/agents/, or stop instructing it to write there`,
        });
      }
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
// Gate 10 — instruction load (references/llm-failure-modes.md). Per-instruction compliance falls
// as the number of simultaneous instructions rises: fifty rules do not produce fifty-rule
// behaviour, they produce roughly the top-N by salience. And prohibitions are the weakest shape
// of all — "don't do Y" is followed worse than "do X" — so an unenforced MUST NOT is closer to a
// wish than a rule. Both warn: the remedy is promote-or-cut, never "try harder".
// ---------------------------------------------------------------------------------------------
const RULE_BUDGET = 25;

function gateDigest() {
  if (!exists(P("feature_list.digest.md")) || !exists(P("tools", "feature-digest.mjs"))) return;
  const r = spawnSync(process.execPath, [P("tools", "feature-digest.mjs"), "--target", TARGET, "--check"],
    { encoding: "utf8" });
  if (r.status !== 0) {
    add({
      gate: "docs", id: "feature-digest-stale", layer: "project", severity: "warn",
      symptom: "feature_list.digest.md no longer matches feature_list.json — agents load the digest, so a stale one misinforms every one of them",
      remedy: "run `node tools/feature-digest.mjs --target .` (init.sh does this automatically; a stale digest means init.sh has not run since the list changed)",
    });
  }
}

function gateRules() {
  const raw = read(P("docs", "constraints.md"));
  if (!raw) return;
  const allRules = raw.split("\n").filter((l) => /^\s*-\s+MUST\b/.test(l));
  const prohibitions = allRules.filter((l) => /^\s*-\s+MUST NOT\b/.test(l));
  // A rule is enforced if its own text points at the thing that enforces it.
  const ENFORCED = /(verify-harness|check-coverage|init\.sh|gate\b|`[\w-]+\.mjs`|mechanically|checked mechanically|enforced)/i;
  const unenforced = prohibitions.filter((l) => !ENFORCED.test(l));
  // Only rules the agent must REMEMBER count against the budget. A gated rule cannot be violated
  // silently, so it costs documentation space but not attention — and that difference is the
  // whole incentive to promote rather than to keep writing rules.
  const rules = allRules.filter((l) => !ENFORCED.test(l));

  if (rules.length > RULE_BUDGET) {
    add({
      gate: "rules", id: "instruction-load-over-budget", layer: "project", severity: "warn",
      symptom: `docs/constraints.md carries ${rules.length} rules an agent must remember (budget ${RULE_BUDGET}; ${allRules.length - rules.length} more are mechanically enforced and don't count) — compliance per rule falls as the count rises, so the tail is loaded but not followed`,
      remedy: "promote or cut: a rule that matters becomes a mechanical gate (and then the prompt need not carry it), a rule that does not becomes deleted. Writing it more emphatically does not help (references/llm-failure-modes.md)",
    });
  }
  // Ratio, not a raw count: some prohibitions are irreducibly semantic ("don't weaken a test to
  // make it pass") and no grep will ever enforce them. A project that has promoted the gateable
  // ones should go quiet; one that has promoted none should not.
  if (prohibitions.length >= 4 && unenforced.length / prohibitions.length > 0.6) {
    add({
      gate: "rules", id: "prohibitions-mostly-unenforced", layer: "project", severity: "warn",
      symptom: `${unenforced.length} of ${prohibitions.length} MUST NOT rules name no mechanism that enforces them — negation is the weakest instruction shape, so these are advisory in practice`,
      remedy: "back each load-bearing prohibition with a gate and name it in the rule text, or restate it as a positive MUST, or accept it is advice and move it out of the MUST NOT list",
      evidence: unenforced.slice(0, 3).map((l) => l.trim().slice(0, 90)).join(" | "),
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
gateRules();
gateDigest();
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
