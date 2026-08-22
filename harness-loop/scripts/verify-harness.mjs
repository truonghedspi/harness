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
//                           [--skip-baseline] [--run-features] [--skip-claimed] [--promote]
//                           [--timeout-ms N] [--quiet]
// --promote (requires --run-features): mechanically flips readyForCheck/in-progress features to
// done when their verification command re-runs and exits 0 — the same mechanical half of the
// checker's job verify-harness already does (re-run the evidence, don't trust the claim). It does
// NOT replace the checker's semantic review (does the behavior actually match, is there scope
// bleed) — it only saves the checker from re-doing the purely mechanical "does this reproduce"
// step by hand. Never promotes a feature with any blocker finding against it.
//
// --skip-claimed replays only readyForCheck features (what --promote actually needs to act on),
// skipping the re-run of every already-done/passing feature's verification command. Regression
// detection on already-shipped features is real value (docs/testing-standards.md: environment and
// contract drift can break unchanged code) but does not need to happen on every single maker
// iteration — a project with several Level 3 (docs/testing-standards.md) done features pays that
// cost every iteration for the rest of the project's life otherwise. Callers that want the full
// regression sweep (periodically, or at the end of a run) omit this flag.
// Exit: 0 iff no blocker findings.
import { readFileSync, writeFileSync, statSync, readdirSync, mkdirSync, writeSync } from "node:fs";
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
const SKIP_CLAIMED = flag("--skip-claimed");
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


// Agents exist in two formats — .kiro/agents/*.json and .claude/agents/*.md — both generated from
// agents.manifest.json. Every gate that inspects agents reads them through here, so a project
// scaffolded for either runtime is checked identically. Returns a normalised shape.
function readAgents() {
  const out = [];
  for (const f of lsSafe(P(".kiro", "agents")).filter((x) => x.endsWith(".json"))) {
    const j = readJSON(P(".kiro", "agents", f));
    if (!j) { out.push({ file: `.kiro/agents/${f}`, runtime: "kiro", broken: true }); continue; }
    out.push({
      file: `.kiro/agents/${f}`, runtime: "kiro", name: j.name,
      uris: [j.prompt, ...(Array.isArray(j.resources) ? j.resources : [])]
        .filter((u) => typeof u === "string" && u.startsWith("file://")),
      resources: (j.resources || []).map((u) => String(u).replace(/^file:\/\/(\.\.\/)*/, "")),
      canWrite: (j.tools || []).includes("write") || (j.tools || []).includes("*"),
      writes: (j.toolsSettings && j.toolsSettings.write && j.toolsSettings.write.allowedPaths) || null,
      text: read(P(".kiro", "agents", f)) || "",
    });
  }
  for (const f of lsSafe(P(".claude", "agents")).filter((x) => x.endsWith(".md"))) {
    const text = read(P(".claude", "agents", f)) || "";
    const fm = /^---\n([\s\S]*?)\n---/.exec(text);
    const field = (k) => { const m = new RegExp(`^${k}:\\s*(.+)$`, "m").exec(fm ? fm[1] : ""); return m ? m[1].trim() : null; };
    const name = (field("name") || f.replace(/\.md$/, "")).replace(/^["']|["']$/g, "");
    // Resources are injected by the SubagentStart hook, so the manifest — not the file — is the
    // authority on what this agent loads. Read it from there.
    const man = readJSON(P("agents.manifest.json"));
    const entry = ((man && man.agents) || []).find((a) => a.name === name);
    out.push({
      file: `.claude/agents/${f}`, runtime: "claude", name,
      uris: [],   // no file:// URIs in this format; the prompt is the body
      resources: (entry && entry.resources) || [],
      canWrite: /\bWrite\b|\bEdit\b/.test(field("tools") || "Write"),
      writes: (entry && entry.writes) || null,
      text,
    });
  }
  // Codex: .codex/agents/<name>.toml. Only the fields other gates actually read are pulled out —
  // a full TOML parser is not worth shipping for four keys, and `name` is what everything keys on.
  // Note what is NOT here: `writes`. Codex agent TOML cannot express a per-path write list at all,
  // so the manifest stays the authority and .codex/hooks.json + HARNESS_AGENT do the enforcing.
  for (const f of lsSafe(P(".codex", "agents")).filter((x) => x.endsWith(".toml"))) {
    const text = read(P(".codex", "agents", f)) || "";
    const key = (k) => { const m = new RegExp(`^${k}\\s*=\\s*"([^"]*)"`, "m").exec(text); return m ? m[1] : null; };
    const name = key("name") || f.replace(/\.toml$/, "");
    const man = readJSON(P("agents.manifest.json"));
    const entry = ((man && man.agents) || []).find((a) => a.name === name);
    out.push({
      file: `.codex/agents/${f}`, runtime: "codex", name,
      uris: [],   // the prompt is inlined into developer_instructions
      resources: (entry && entry.resources) || [],
      canWrite: /sandbox_mode\s*=\s*"workspace-write"/.test(text),
      writes: (entry && entry.writes) || null,
      text,
    });
  }
  return out;
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
    // prompts/ was missing, and it is the text agents read MOST. Two of them shipped a literal
    // {{PROJECT_NAME}} to a live project: the pattern was already here, nothing ever looked in the
    // directory it mattered in.
    ...lsSafe(P("prompts")).filter((f) => f.endsWith(".md")).map((f) => `prompts/${f}`),
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
          ? "scaffold a throwaway target and check whether it leaks the same token: if it does, setup-harness-loop.mjs's substitute() is missing it; if it does not, this file is residue from an older scaffold or was hand-copied, so substitute it here"
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
  // Prefer init.mjs directly: `./init.sh` is a POSIX invocation and cmd.exe cannot run it, so on
  // Windows the baseline gate would report "could not run" rather than a real verdict.
  if (!exists(P("init.mjs")) && !exists(P("init.sh"))) return; // already reported by the structure gate
  const started = Date.now();
  const r = exists(P("init.mjs")) ? runCmd(`"${process.execPath}" init.mjs`) : runCmd("./init.sh");
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
    if (claimed && !evidenceText(f).trim()) {
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
        attempts >= maxAttempts &&
        // `blocked` is the honest give-up. `done`/`passing` is finishing ON the last allowed
        // attempt, which is the timebox working, not being violated — this check once fired on a
        // feature the checker had just approved, turning a success into a blocker (HI-019).
        !["blocked", "done", "passing"].includes(String(f.status || f.state))) {
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
      const isProve = f.kind === "prove";
      const tooLong = isProve ? behavior.length > 800 && joiners >= 5 : behavior.length > 400;
      const tooCompound = isProve ? joiners >= 7 : joiners >= 3;
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
  const noRed = features.filter((f) =>
    ["passing", "done"].includes(String(f.status || f.state)) &&
    evidenceText(f).trim() && !hasRed(f));
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
  // features too, not just already-claimed passing/done ones. --skip-claimed narrows this to
  // offered-only for a cheap per-iteration pass; see the flag's own usage comment above.
  for (const f of features) {
    const claimed = !SKIP_CLAIMED && ["passing", "done"].includes(String(f.status || f.state));
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
    // A checker REJECT sets status back to in-progress (checker-prompt.md) so the router still
    // treats the feature as open for the maker to retry — but that leaves "in-progress because
    // nobody has looked yet" indistinguishable from "in-progress because the checker just looked
    // and said no" to this loop, which only checks status. Found live: a checker rejected
    // feat-lsp-client for lacking a real process-boundary oracle; the maker's OLD unit test still
    // exited 0, and the next --promote run silently overrode the reject. The checker's own verdict
    // (checkerNotes' first line, same marker convention route.mjs already uses) is the ground
    // truth here, not the status field a checker mistake could leave stale.
    if (/^REJECT\b/.test(String(f.checkerNotes || "").trim())) continue;
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
  if (!exists(P("tools/telemetry.mjs")) || !exists(P("tools/telemetry-calibrate.mjs"))) {
    add({ gate: "observability", id: "read-telemetry-missing", layer: "harness",
      symptom: "runtime hooks cannot emit calibrated, redacted read/search telemetry",
      remedy: "refresh skill-owned telemetry.mjs and telemetry-calibrate.mjs" });
  }
  if (!exists(P("tools/guard-write.mjs")) || !exists(P("tools/hook-calibrate.mjs"))) {
    add({ gate: "runtime-hooks", id: "hook-calibration-missing", layer: "harness",
      symptom: "runtime write-confinement hooks have no allow/deny adapter calibration",
      remedy: "refresh skill-owned guard-write.mjs and hook-calibrate.mjs" });
  }
  const serviceManifest = readJSON(P("services.manifest.json"));
  if (serviceManifest && !exists(P("skills/business-journey/SKILL.md"))) {
    add({ gate: "business-journey", id: "capability-pack-missing", layer: "harness",
      symptom: "integration target can deploy services but has no distributed business-journey capability contract",
      remedy: "refresh the skill-owned skills/business-journey pack" });
  }
  if (serviceManifest && (!exists(P("skills/quality-strategy/SKILL.md")) || !exists(P("skills/quality-strategy/scripts/check-quality-strategy.mjs")))) {
    add({ gate: "quality-strategy", id: "capability-pack-missing", layer: "harness",
      symptom: "integration target has no risk-to-oracle and execution-size capability contract",
      remedy: "refresh the skill-owned skills/quality-strategy pack" });
  }
  const hasExternalRules = ((serviceManifest && serviceManifest.services) || [])
    .some((s) => (s.rules && s.rules.length) || (s.ownRules && s.ownRules.length));
  if (hasExternalRules) {
    const loader = read(P("tools/agent-context.mjs")) || "";
    if (!exists(P("tools/context-plan.mjs")) || !/planContext/.test(loader) || !/harnessContextInputs/.test(loader)) {
      add({
        gate: "context-supply", id: "service-rules-unread", layer: "harness",
        symptom: "services.manifest.json records service-owned rules, but the runtime cannot select, load and report them for the active feature",
        remedy: "refresh skill-owned tools/context-plan.mjs and tools/agent-context.mjs; pointers without a consumer are discovery theatre",
      });
    }
  }
  const packetFeatures = (featureListArray || []).filter((f) => f.context && f.context.packet);
  if (packetFeatures.length) {
    const loader = read(P("tools/agent-context.mjs")) || "";
    const planner = read(P("tools/context-plan.mjs")) || "";
    if (!/harnessContextReceipt/.test(loader) || !/featurePacket/.test(planner)) {
      add({ gate: "context-supply", id: "feature-context-packet-unread", layer: "harness",
        symptom: `${packetFeatures.length} feature(s) point at context packets but dispatch cannot validate and receipt them`,
        remedy: "refresh skill-owned context-plan.mjs and agent-context.mjs; a packet without a digest check and receipt is decorative" });
    }
  }
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
  const agentNames = [...new Set(readAgents().map((a) => a.name).filter(Boolean))];
  const unnamed = agentNames.filter((n) => !routerText.includes(n));
  if (agentNames.length && unnamed.length) {
    add({
      gate: "loop", id: "agent-unrouted", layer: "project", severity: "warn", count: unnamed.length,
      symptom: `${unnamed.length} of ${agentNames.length} agent(s) are named by neither the router nor loop/route.mjs — nothing tells a session they exist or when to run them`,
      remedy: "name each in the router's agent table with the condition that selects it, or give it a rule in loop/route.mjs. An agent reachable only by guessing is a node with no incoming edge (docs/reference/graph.md)",
      evidence: unnamed.slice(0, 6).join(", ") + (unnamed.length > 6 ? ", …" : ""),
    });
  }

  // The most expensive failure in this harness's real history, and the only one that is
  // INVISIBLE while it happens: kiro resolves a `file://` URI relative to `.kiro/agents/`, not the
  // repo root. A URI that resolves to nothing does not error — the agent starts, silently WITHOUT
  // its prompt and resources, i.e. as the unrestricted default. It runs, it just is not the agent
  // you configured, and its output looks like ordinary work. Seen twice for real: once mid-run on
  // a live loop (HI-005), once on three of four agents in a dormant project nobody had run in ten
  // days. Blocker, not a warning — a write-capable agent with no rulebook loaded is not a
  // degraded harness, it is no harness.
  for (const a of readAgents()) {
    if (a.broken) {
      add({
        gate: "loop", id: `agent-unparseable:${path.basename(a.file)}`, layer: "project",
        symptom: `${a.file} is not valid JSON — the runtime cannot load this agent at all`,
        remedy: "fix the JSON, or regenerate: node tools/gen-agents.mjs --target . A malformed agent config is skipped silently, so the agent you think you are running does not exist",
      });
      continue;
    }
    // kiro only: Claude Code agents carry their prompt in the body, so there is no URI to break.
    const broken = a.uris.filter((u) => !exists(path.resolve(P(".kiro", "agents"), u.slice("file://".length))));
    if (broken.length) {
      add({
        gate: "loop", id: `agent-uri-broken:${a.name}`, layer: "project", count: broken.length,
        symptom: `${broken.length} file:// URI(s) in ${a.file} resolve to nothing — kiro resolves them relative to .kiro/agents/, so this agent starts without its prompt/resources and silently behaves as the unrestricted default`,
        remedy: "regenerate from the manifest (node tools/gen-agents.mjs --target .), which always writes ../../-prefixed URIs. A broken URI never raises an error, it just gives you a different agent",
        evidence: broken.slice(0, 5).join(", ") + (broken.length > 5 ? ", …" : ""),
      });
    }
    // An agent that can write but never loads the rulebook will violate rules it has never seen —
    // and the violation looks like ordinary output, so nothing catches it. Any always-remember
    // rule (file-size budget, index requirement, project invariants) lives in docs/constraints.md
    // precisely because it is auto-loaded; this check is what keeps that guarantee true on both
    // runtimes (kiro `resources`, Claude Code's SubagentStart injection — same manifest list).
    if (a.canWrite && a.resources.length && !a.resources.some((r) => r.includes("constraints.md"))
        && exists(P("docs", "constraints.md"))) {
      add({
        gate: "loop", id: `agent-missing-constraints:${a.name}`, layer: "harness", severity: "warn",
        symptom: `${a.name} can write files but does not load docs/constraints.md — it cannot follow rules it never sees`,
        remedy: "add docs/constraints.md to that agent's resources in agents.manifest.json, then regenerate",
      });
    }
    // An agent told to update a file it has no write permission for will fail at the moment it
    // matters, in a way no test covers — the instruction reads fine and the config reads fine; only
    // the pair is wrong. Found in the wild: the design-facilitator's prompt says "register it in
    // docs/cross-cutting.md" while its allowedPaths omitted that file.
    if (Array.isArray(a.writes)) {
      const covers = (f) => a.writes.some((w) => w === f || (w.endsWith("/**") && f.startsWith(w.slice(0, -2))));
      const man = readJSON(P("agents.manifest.json"));
      const entry = ((man && man.agents) || []).find((x) => x.name === a.name);
      const body = entry ? (read(P(entry.prompt)) || "") : a.text;
      const WRITE_VERB = /\b(write|writes|writing|register|registers|record|records|update|updates|fill|fills|add(?:ing)? (?:a |one |it )?(?:row|line|entry)?\s*to)\b/i;
      const NEGATED = /\b(not|never|n't|cannot|instead of)\b/i;
      // Negation is not always in the sentence. "## What you must not do" scopes every bullet under
      // it, and a prohibition section is a normal — desirable — prompt shape: the orchestrator's
      // whole safety case is a list of things it may not write. Flagging those taught the reader to
      // ignore the gate, which is worse than not having it.
      const NEGATED_HEADING = /\b(must not|never|do not|don't|forbidden|may not|out of scope|not your)\b/i;
      const wanted = new Set();
      let inProhibition = false;
      for (const line of body.split("\n")) {
        const h = /^#{1,6}\s+(.*)$/.exec(line);
        if (h) inProhibition = NEGATED_HEADING.test(h[1]);
        if (inProhibition) continue;
        if (!WRITE_VERB.test(line) || NEGATED.test(line)) continue;
        for (const m of line.matchAll(/`(docs\/[\w./-]+\.md|feature_list\.json|DECISIONS\.md|progress\.md|loop\/[\w.-]+\.md|session-handoff\.md)`/g)) {
          if (!m[1].startsWith("docs/reference/")) wanted.add(m[1]);
        }
      }
      for (const f of wanted) {
        if (covers(f)) continue;
        add({
          gate: "loop", id: `agent-cannot-write-instructed:${a.name}:${f}`, layer: "harness", severity: "warn",
          symptom: `${a.name}'s prompt tells it to write ${f}, but that path is not in its write list`,
          remedy: `either add ${f} to that agent's "writes" in agents.manifest.json and regenerate, or stop instructing it to write there`,
        });
      }
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

  // Stray verification scripts. An agent asked "would this test have failed on a wrong
  // implementation?" answers it by probing — a legitimate impulse — and the probe then stays,
  // untracked, looking like project code. It is invisible to the verification-outside-test-framework
  // gate, which reads the `verification` FIELD, and to write confinement, whose PreToolUse matcher
  // is Edit|Write|NotebookEdit: a shell redirect never passes through it.
  //
  // trace/scratch/ is the sanctioned home (gitignored, inside the checker's writes), so anything
  // script-shaped and untracked OUTSIDE it is debris.
  const strays = dirty
    .filter((l) => l.startsWith("??"))
    .map((l) => l.replace(/^\?\?\s*/, ""))
    .filter((f) => /\.(mjs|js|cjs|ts|sh|py)$/.test(f))
    .filter((f) => !f.startsWith("trace/") && !f.startsWith("tools/") && !f.startsWith("scripts/"));
  if (strays.length) {
    add({
      gate: "clean-state", id: "stray-verification-script", layer: "project", severity: "warn",
      count: strays.length,
      symptom: `${strays.length} untracked script(s) left in the tree — most likely a throwaway verification`,
      remedy: "delete it, or promote it into the test framework if it proved something worth keeping. A probe belongs in trace/scratch/ (gitignored); a probe left in the tree is unmaintained proof that no test run will execute again (docs/testing-standards.md, 'Where a verification lives')",
      evidence: strays.slice(0, 6).join(", "),
    });
  }

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
  // readAgents() normalises both runtimes' resource lists to plain repo-relative paths, so this
  // holds whether the project was scaffolded for kiro, Claude Code, or both.
  const seen = new Set();
  for (const a of readAgents()) {
    if (a.broken) continue;
    for (const memPath of a.resources) {
      if (!/^memory\/[^/]+\/MEMORY\.md$/.test(memPath)) continue;
      if (seen.has(a.name + memPath)) continue;
      seen.add(a.name + memPath);
      const j = { name: a.name };
      const rel = a.file;
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
// Gate memory-shared — docs/design/shared-memory-tier.md v1, INV-SHARED-1. Warn, not a blocker,
// same reasoning as gateMemory: a bad entry here means an agent trusts an unverified "shared fact",
// not a broken harness. Only memory-promote.mjs should ever write here, so a hand-edited entry
// with evidence: inference (or missing evidence) is the one thing this gate exists to catch —
// defense in depth against a human/agent bypassing the script.
// ---------------------------------------------------------------------------------------------
const SHARED_MEMORY_MAX_LINES = 200; // same budget MEMORY.md uses, applied to the combined tier

function parseSharedEntry(content) {
  const m = content.match(/^---\n([\s\S]*?)\n---/);
  if (!m) return {};
  const out = {};
  let inMetadata = false;
  for (const line of m[1].split("\n")) {
    if (/^metadata:\s*$/.test(line)) { inMetadata = true; continue; }
    const nested = line.match(/^\s+(\w+):\s*(.*)$/);
    if (inMetadata && nested) { out[nested[1]] = nested[2].trim(); continue; }
    const top = line.match(/^(\w+):\s*(.*)$/);
    if (top) out[top[1]] = top[2].trim();
  }
  return out;
}

function gateMemorySharedTier() {
  const dir = P("memory", "shared");
  if (!exists(dir)) return; // nothing promoted yet — not a defect
  const files = lsSafe(dir).filter((f) => f.endsWith(".md"));
  let totalLines = 0;
  for (const f of files) {
    const raw = read(path.join(dir, f));
    totalLines += raw.split("\n").length;
    const fm = parseSharedEntry(raw);
    if (fm.evidence !== "test" && fm.evidence !== "tool-output") {
      add({
        gate: "memory-shared", id: `memory-shared-bad-evidence:${f}`, layer: "project", severity: "warn",
        symptom: `memory/shared/${f} has evidence: ${fm.evidence || "(missing)"} — only test or tool-output may promote (INV-SHARED-1)`,
        remedy: "delete the entry or fix its evidence source; memory-promote.mjs never writes evidence: inference, so this was hand-edited or hand-added",
      });
    }
  }
  if (totalLines > SHARED_MEMORY_MAX_LINES) {
    add({
      gate: "memory-shared", id: "memory-shared-over-budget", layer: "project", severity: "warn",
      symptom: `memory/shared/ is ${totalLines} lines combined (budget ${SHARED_MEMORY_MAX_LINES}) — every agent loads this, so it must stay cheap`,
      remedy: "rotate the oldest/least-cited entries into an archive (docs/reference/knowledge-layout.md Pattern B)",
    });
  }
}

// ---------------------------------------------------------------------------------------------
// Gate 8 — design hygiene (references/design-engineering.md). All warn: design quality is a
// heuristic and a false positive must never stop a loop. These catch the mechanical half —
// uncited claims, a blocked feature resting on an unverified assumption, a named component no
// feature covers — leaving the reasoning defects to the design-facilitator's self-applied critique and, ultimately, the human who approves.
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

  // 8b2 — "how would we know this works" is a DESIGN question, and skipping it is invisible until
  // much later. Measured on this skill's dogfood project: every unfinished feature was missing its
  // falsifier, not because the planner was lazy but because nobody upstream had produced an
  // invariant to derive one from. A design with no observable seam is a boundary defect that gets
  // paid for by whoever writes the test, in the currency of a test coupled to the implementation.
  const designDocs = lsSafe(P("docs", "design"))
    .filter((f) => f.endsWith(".md") && f.toLowerCase() !== "readme.md")   // the dir's own index is not a design
    .map((f) => ({ rel: `docs/design/${f}`, text: read(P("docs", "design", f)) || "" }))
    .filter((d) => d.text.trim().length > 200);   // skip stubs and READMEs
  const SEAM = /\b(seam|observable|observability|from outside|externally visible)\b/i;
  const INVARIANT = /\b(invariant|always|never|for every|conserv|idempoten|monotonic|round[- ]trip)\b/i;
  // Checked across the WHOLE folder, not file-by-file: a design legitimately split into topic files
  // (claims table, components, critique) has files with no reason to say "seam" on their own — e.g.
  // a critique.md about premises and premortems. Per-file checking flagged a real, complete design
  // as broken the first time one was split across topic files (examples/jdt-mcp-server, found live);
  // the symptom text already claims to test "the design", not any one file in it.
  if (designDocs.length) {
    const combined = designDocs.map((d) => d.text).join("\n");
    const missing = [!SEAM.test(combined) && "observable seam", !INVARIANT.test(combined) && "invariants"]
      .filter(Boolean);
    if (missing.length) {
      add({
        gate: "design", id: "design-untestable", layer: "project", severity: "warn",
        symptom: `docs/design/*.md collectively name no ${missing.join(" and no ")} — the design does not say how anyone would know the thing works`,
        remedy: "for each component state the boundary a test attaches to and what it can see across it, plus what must hold for EVERY input (conservation, idempotency, ordering, round-trip). Those invariants are what the feature-planner derives each falsifier from (docs/reference/test-authoring.md)",
      });
    }
  }

  // 8b3 — the invariant -> falsifier contract, checked in BOTH directions
  // (references/invariant-contract.md). Forward alone is not enough: it lets the planner cite
  // nothing, or cite an id it invented, and still pass. ISO/IEC/IEEE 29148's point exactly —
  // forward shows coverage, backward surfaces artifacts that justify nothing.
  // Opt-in on the first INV- id, so adopting a repo whose designs have none stays silent.
  {
    const stated = new Map();          // INV-id -> which design doc states it
    for (const f of lsSafe(P("docs", "design")).filter((x) => x.endsWith(".md"))) {
      const text = read(P("docs", "design", f)) || "";
      for (const m of text.matchAll(/\bINV-[A-Z]+-\d+\b/g)) {
        if (!stated.has(m[0])) stated.set(m[0], f);
      }
    }
    const cited = new Map();           // INV-id -> feature ids citing it
    for (const ft of (featureListArray || [])) {
      for (const m of String(ft.falsifier || "").matchAll(/\bINV-[A-Z]+-\d+\b/g)) {
        if (!cited.has(m[0])) cited.set(m[0], []);
        cited.get(m[0]).push(ft.id);
      }
    }
    if (stated.size || cited.size) {   // the opt-in
      const uncovered = [...stated.keys()].filter((id) => !cited.has(id));
      if (uncovered.length) {
        add({
          gate: "design", id: "invariant-uncovered", layer: "project", severity: "warn", count: uncovered.length,
          symptom: `${uncovered.length} invariant(s) are stated in a design but no feature's falsifier cites them — the design says it must always hold and nothing would catch a violation`,
          remedy: "give each one a feature whose verification would fail on a violation, and cite the id in that feature's falsifier. If none is needed, the invariant does not belong in the design (docs/reference/invariant-contract.md)",
          evidence: uncovered.slice(0, 6).map((id) => `${id} (${stated.get(id)})`).join(", "),
        });
      }
      const orphans = [...cited.keys()].filter((id) => !stated.has(id));
      if (orphans.length) {
        add({
          gate: "design", id: "falsifier-orphan", layer: "project", severity: "warn", count: orphans.length,
          symptom: `${orphans.length} falsifier(s) cite an invariant id that exists in no design document — the citation is to something that was never stated`,
          remedy: "either the id is a typo, or the falsifier was written first and the citation added to satisfy the gate. The second is worse than no citation: it reports coverage nobody checked. Fix the id, or write NEEDS DESIGN and let the design-facilitator state the invariant",
          evidence: orphans.slice(0, 6).map((id) => `${id} ← ${cited.get(id).slice(0, 2).join(",")}`).join("; "),
        });
      }
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
// Gate — state-log style (docs/constraints.md: progress.md/DECISIONS.md must be short factual
// bullets, not prose narrative). Whether a passage is genuinely "too verbose" is a semantic
// judgment this repo already learned it cannot mechanize (docs/design/shared-memory-tier.md's own
// spike, on a different problem, found the same limit). What IS cheap and structural: a run of
// several consecutive lines with no list marker at all reads as a paragraph, not a bulleted state
// update, regardless of what it says. Warn only — a crude proxy must never block a loop.
// ---------------------------------------------------------------------------------------------
const PROSE_RUN_MIN_LINES = 3;
const PROSE_RUN_MIN_CHARS = 300;

function gateStateLogStyle() {
  const LIST_LINE = /^\s*(#{1,6}\s|[-*]\s|\d+\.\s|\|.*\|\s*$|```)/;
  for (const rel of ["progress.md", "DECISIONS.md"]) {
    if (!exists(P(rel))) continue;
    const lines = read(P(rel)).split("\n");
    let run = [];
    let runStart = 0;
    const flush = () => {
      const chars = run.join(" ").length;
      if (run.length >= PROSE_RUN_MIN_LINES && chars >= PROSE_RUN_MIN_CHARS) {
        add({
          gate: "docs", id: `state-log-prose:${rel}:${runStart}`, layer: "project", severity: "warn",
          symptom: `${rel}:${runStart} has ${run.length} consecutive non-bulleted lines (${chars} chars) — reads as prose narrative, not a state log`,
          remedy: "rewrite as short factual bullets — what changed, what state now (docs/constraints.md); reasoning belongs in a memory entry or design doc, not here",
        });
      }
      run = [];
    };
    lines.forEach((line, i) => {
      const trimmed = line.trim();
      if (!trimmed || LIST_LINE.test(line)) { flush(); return; }
      if (!run.length) runStart = i + 1;
      run.push(trimmed);
    });
    flush();
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

// The graph is the only place the whole control flow is written down, and it is the one artifact
// no other gate can substitute for: every check here inspects the CONTENT of a file, none inspects
// which node runs next. That blind spot is not theoretical — nine gates and a green demo coexisted
// with a livelock (a NEEDS DESIGN feature is neither done nor blocked, so the loop never exited and
// the maker was instructed to skip it) that was found only by writing the routing table out by
// hand. So when the router or an agent config changes and the graph does not, say so.
// Timestamps only: whether the graph's *content* is right is a human's judgement, not a mtime's.
// Agent configs are generated from agents.manifest.json. A hand-edit to a generated file is lost
// on the next generation AND makes the two runtimes disagree while both still start cleanly —
// the invisible failure class again, one level up from a broken URI.
function gateGenerated() {
  if (!exists(P("agents.manifest.json")) || !exists(P("tools", "gen-agents.mjs"))) return;
  const installed = ["kiro", "claude", "codex"].filter((r) => exists(P(`.${r}`, "agents")));
  if (!installed.length) return;
  const runtime = installed.join(",");
  const r = spawnSync(process.execPath,
    [P("tools", "gen-agents.mjs"), "--target", TARGET, "--runtime", runtime, "--check"],
    { encoding: "utf8" });
  if (r.status !== 0) {
    const files = (r.stderr || "").split("\n").filter((l) => /^\s{2}\S/.test(l)).map((l) => l.trim());
    add({
      gate: "loop", id: "agent-generated-stale", layer: "project", severity: "warn", count: files.length || 1,
      symptom: `${files.length || "some"} generated agent file(s) no longer match agents.manifest.json`,
      remedy: `edit agents.manifest.json (the source), then run: node tools/gen-agents.mjs --target . --runtime ${runtime}. Hand-edits to generated agent files are lost silently and make the runtimes diverge`,
      evidence: files.slice(0, 5).join(", "),
    });
  }
}

function gateGraph() {
  const graph = P("docs", "reference", "graph.md");
  if (!exists(graph)) return;                       // opt-in: projects without the doc are not nagged
  const mtime = (p) => { try { return statSync(p).mtimeMs; } catch { return 0; } };
  const graphAt = mtime(graph);
  const sources = [P("loop", "route.mjs"), P("loop", "run-loop.mjs"),
    P("agents.manifest.json"),
    ...lsSafe(P(".kiro", "agents")).filter((f) => f.endsWith(".json")).map((f) => P(".kiro", "agents", f)),
    ...lsSafe(P(".claude", "agents")).filter((f) => f.endsWith(".md")).map((f) => P(".claude", "agents", f))];
  const newer = sources.filter((p) => exists(p) && mtime(p) > graphAt)
    .map((p) => path.relative(TARGET, p));
  if (newer.length) {
    add({
      gate: "docs", id: "graph-stale", layer: "project", severity: "warn", count: newer.length,
      symptom: `${newer.length} workflow file(s) are newer than docs/reference/graph.md — the routing may have changed without the graph saying so`,
      remedy: "update the node table, shared-state owners, routing rules and mermaid in docs/reference/graph.md, then commit both together. A graph that lags the code is worse than no graph: it is read as authoritative",
      evidence: newer.slice(0, 5).join(", ") + (newer.length > 5 ? ", …" : ""),
    });
  }
}

// A project that deploys with Helm and verifies nothing against a cluster is not "not using k8s" —
// it is untested where it actually runs. Opt-in on the chart: no chart, no finding.
function gateK8s() {
  const charts = walk(TARGET).filter((f) => /\/Chart\.ya?ml$/.test(f)).map((f) => path.relative(TARGET, f));
  if (!charts.length) return;
  const agents = readAgents();
  const hasAgent = agents.some((a) => /k8s|kubernetes/i.test(a.name || ""));
  const hasTool = exists(P("tools", "k8s-test-env.sh"));
  if (!hasAgent || !hasTool) {
    add({
      gate: "loop", id: "k8s-agent-missing", layer: "project", severity: "warn",
      count: charts.length,
      symptom: `${charts.length} Helm chart(s) here, but ${!hasAgent && !hasTool ? "no k8s integration layer at all" : !hasAgent ? "no k8s integration agent" : "no tools/k8s-test-env.sh"} — nothing in this harness verifies the deployed shape`,
      remedy: "re-run setup with --k8s on (or copy templates/k8s/** by hand). The chart is how this ships; a suite that only ever runs in-process cannot catch a broken probe, a missing env var or a chart that will not install",
      evidence: charts.slice(0, 3).join(", "),
    });
  }
}

// Both runtimes are generated, so both must see the same connectors. One runtime having a server the
// other lacks is silent: the same agent simply cannot do the same job depending on who launched it.
// Codex accepts exactly two keys in hooks.json: `description` and `hooks`. Anything else and it
// rejects the WHOLE file with a one-line stderr warning and runs with no hooks — which on this
// harness means no write confinement, while every role still behaves plausibly because its prompt
// tells it to. Shipped that defect once ($comment, harmless in every other config here) and only
// caught it by reading codex's stderr, so it is a gate now.
// The bash init.sh this harness shipped for months wrote `has lint && { run lint; } || true`. The
// `|| true` was meant to skip a script that does not exist; it cannot tell that apart from a script
// that ran and failed. Measured: a project with a failing lint AND a failing test printed
// "=== Baseline green ===" and exited 0. The baseline gate — the one thing the loop refuses to run
// on red — could not go red for any Node project.
//
// Setup never overwrites an existing file, so every target scaffolded before the port still has it.
// This finds them.
// The router is the one file EVERY agent loads, so its length is a tax on every session. It used to
// say "Keep this file short" in prose, which is the weakest possible enforcement. A budget is not
// about tidiness: past ~150 lines the leverage points stop being findable, and an agent that cannot
// find the rule behaves as if the rule is not there.
// The planner rewrites feature_list.json's whole array, and it is auto-loaded with the DIGEST now
// rather than the full file — 70 lines instead of a thousand on every spawn. That trade is only
// safe if "rewrote it from the digest and dropped the fields the digest does not show" is caught by
// something other than a sentence in a prompt. This is that something.
//
// Only non-empty → empty counts. Clearing a NEEDS DESIGN: marker by REPLACING it with a resolution
// note keeps checkerNotes non-empty, which is the behaviour we want and must not flag.
// A feature's `verification` must be a runnable command — and the harness never says WHERE that
// command may live. So when a claim is not naturally expressible in the project's test framework
// ("the digest is smaller than its source"), the cheapest runnable thing is a one-off script, and
// the harness models exactly that: 23 of its own tools are .mjs and its demo is 161 `node -e`
// assertions. The result satisfies every existing gate while sitting outside docs/testing-standards.md
// — unmaintained proof that no test run will ever execute again.
//
// Deliberately a WARNING and deliberately narrow. The three shapes below are the ones that have no
// home; a committed tool under tools/ is maintained infrastructure and is not one of them.
// Two features that run the same command make the loop pay twice to prove the same thing — a
// maker dispatch, a checker dispatch and a baseline gate each, for one proof. Every sizing rule in
// feature-decomposition.md guarded against features being too BIG; nothing caught too small, and
// the cost per feature is fixed, so an over-cut list spends its budget on overhead.
// "Be brief, lead with the leverage point" has been in AGENTS.md for a while and the artifacts say
// it is not holding: on the dogfood project 30 of 49 checkerNotes opened with a first line over 200
// characters, and the longest note was 9,085 — a page and a half inside a JSON field. A prompt
// sentence was never going to fix this; it is the layer that degrades.
//
// What is gated is the LEAD, not the length. Long is fine when the first line carries the point and
// the rest is support; a reader who stops after one line should still have the finding. Gating
// length alone would push people to delete reasoning that is worth keeping.
// `evidence` was a single prose blob — on the dogfood project a median of 373 characters and a max
// of 1756, with zero newlines, so a diff shows one unreadable line and a gate can only regex at it.
// It is really a LIST OF RUNS, so it may now be one:
//
//   "evidence": [
//     { "date": "2026-08-12", "run": "red",   "cmd": "./mvnw -q test -Dtest=X", "result": "1 failure: …" },
//     { "date": "2026-08-12", "run": "green", "cmd": "./mvnw -q test -Dtest=X", "result": "1 test passed" }
//   ]
//
// Strings still work exactly as before — 22 features already had one and rewriting them by hand is
// not an upgrade. Structure buys exactness: `evidence-no-red` stops guessing from prose, and each
// line is short enough to read in a diff.
// A red run: exact when the evidence is structured, a regex over prose when it is not. RED lives
// here rather than inside the gate because hasRed() is what uses it now — a function-scoped const
// referenced from module scope is a ReferenceError waiting for the first call.
const RED = /\b(red|fail(?:ed|ing|ure)?s?|exit(?:ed)? [1-9]|non-zero|assertion ?error|✗)\b/i;
function hasRed(f) {
  const runs = evidenceRuns(f);
  if (runs) return runs.some((r) => String(r.run || "").toLowerCase() === "red");
  return RED.test(String(f.evidence || ""));
}
function evidenceRuns(f) {
  const e = f.evidence;
  if (Array.isArray(e)) return e.filter((r) => r && typeof r === "object");
  return null;                                  // legacy string, or empty
}
function evidenceText(f) {
  const runs = evidenceRuns(f);
  if (!runs) return String(f.evidence || "");
  return runs.map((r) => [r.date, r.run, r.cmd, r.result].filter(Boolean).join(" ")).join("\n");
}

// The handoff into implementation. feature-decomposition.md Step 3 requires the planner to name the
// 1-3 files a feature touches BEFORE writing it down — that is how the feature gets sized — and
// until now there was no field to put them in, so the knowledge was used once and discarded. The
// maker then re-reads the codebase to learn what the planner already knew, which is the most
// expensive kind of rework: it happens on every feature, forever.
// Code the project did not write, with no record of where it came from. Borrowed from
// deepseek-harness, whose vendor/README.md carries directory, upstream repo, version AND commit,
// a local-modification log, an update procedure, and a hygiene gate that asserts it.
//
// This harness had none of that and was already bitten: aeron-demo vendored skills/test-design on
// 2026-08-10 and a schema inside it was widened on 08-13 to accept REQ-MDC-SIT-002. Nothing
// recorded that as a LOCAL MODIFICATION, so the next sync from upstream either silently reverts the
// fix or silently keeps a stale one, and no one finds out until a test schema rejects an id again.
//
// The valuable half is the drift check, and it works offline: git already knows which files under a
// vendored path changed after it was vendored.
function gateVendor() {
  const ROOTS = ["vendor", "third_party", "third-party", "external", "skills"];
  const found = [];
  for (const root of ROOTS) {
    for (const e of lsSafe(P(root))) {
      const rel = `${root}/${e}`;
      try { if (statSync(P(rel)).isDirectory()) found.push(rel); } catch { /* skip */ }
    }
  }
  if (!found.length) return;
  const man = readJSON(P("vendor.manifest.json"));
  if (!man) {
    add({
      gate: "docs", id: "vendor-unpinned", layer: "project", severity: "warn", count: found.length,
      symptom: `${found.length} vendored director(ies) with no provenance — nothing records where they came from or what was changed here`,
      remedy: "add vendor.manifest.json: { vendored: [{ path, upstream, ref, vendoredCommit, localModifications: [{ file, why }] }] }. Without the ref you cannot re-sync; without the modification log a re-sync silently reverts your fixes or silently keeps stale ones",
      evidence: found.join(", "),
    });
    return;
  }
  const declared = new Map((man.vendored || []).map((v) => [v.path, v]));
  const undeclared = found.filter((f) => !declared.has(f));
  if (undeclared.length) {
    add({
      gate: "docs", id: "vendor-unpinned", layer: "project", severity: "warn", count: undeclared.length,
      symptom: `${undeclared.length} vendored director(ies) are not in vendor.manifest.json`,
      remedy: "add an entry for each, or delete the directory if it is not vendored code",
      evidence: undeclared.join(", "),
    });
  }
  const unpinned = [...declared.values()].filter((v) => !v.upstream || !v.ref);
  if (unpinned.length) {
    add({
      gate: "docs", id: "vendor-unpinned", layer: "project", severity: "warn", count: unpinned.length,
      symptom: `${unpinned.length} vendored entr(ies) name no upstream or no ref — they cannot be re-synced or compared`,
      remedy: "record `upstream` (the repo) and `ref` (tag or commit). A copy you cannot diff against its source is a fork you did not decide to make",
      evidence: unpinned.map((v) => v.path).join(", "),
    });
  }
  // Drift: files changed since vendoring that the manifest does not list as local modifications.
  for (const v of declared.values()) {
    // `git diff`, not `git log`: what DIFFERS from the vendored state, not what was ever touched.
    // A file edited and then reverted is net-unchanged and must not be reported — the log form
    // reported it forever, because the revert commit touches the file too.
    // No `..HEAD`: diffing the commit against the WORKING TREE catches an edit that has not been
    // committed yet, which is exactly when saying something is still useful.
    const argv = v.vendoredCommit ? ["diff", "--name-only", v.vendoredCommit, "--", v.path] : null;
    if (!argv) continue;
    const r = spawnSync("git", argv, { cwd: TARGET, encoding: "utf8" });
    if (r.status !== 0) continue;
    const changed = [...new Set((r.stdout || "").split("\n").map((x) => x.trim()).filter(Boolean))];
    const known = new Set((v.localModifications || []).map((m) => `${v.path}/${m.file}`.replace(/\/+/g, "/")));
    const drift = changed.filter((f) => !known.has(f));
    if (drift.length) {
      add({
        gate: "docs", id: `vendor-modified-unrecorded:${v.path}`, layer: "project", severity: "warn",
        count: drift.length,
        symptom: `${drift.length} file(s) under ${v.path} changed after it was vendored, and are not in its localModifications log`,
        remedy: `record each in vendor.manifest.json with the reason, or revert it. An unrecorded change to vendored code is lost at the next sync — and if it was load-bearing, its loss is silent`,
        evidence: drift.slice(0, 5).join(", "),
      });
    }
  }
}

function gateFeatureContext() {
  const fl = readJSON(P("feature_list.json"));
  if (!fl) return;
  const open = (fl.features || []).filter((f) => !["done", "passing"].includes(String(f.status)));
  const without = open.filter((f) => {
    const c = f.context || {};
    return !(Array.isArray(c.touches) && c.touches.length) && !String(c.note || "").trim();
  });
  if (!without.length || !open.length) return;
  add({
    gate: "features", id: "feature-context-missing", layer: "project", severity: "warn",
    count: without.length,
    symptom: `${without.length} of ${open.length} unfinished feature(s) carry no \`context\` — the implementer will rediscover which files they touch`,
    remedy: "add `context: { touches: [...], note: \"…\" }` when planning. The planner already had to name those files to size the feature; writing them down is the difference between one agent learning the codebase and every agent learning it again",
    evidence: without.slice(0, 5).map((f) => f.id).join(", ") + (without.length > 5 ? ", …" : ""),
  });
}

function gateLead() {
  const LEAD = 200;
  const fl = readJSON(P("feature_list.json"));
  const buried = [];
  for (const f of (fl && fl.features) || []) {
    const note = String(f.checkerNotes || "").trim();
    if (!note) continue;
    const first = note.split("\n")[0].trim();
    if (first.length > LEAD) buried.push(`${f.id} (${first.length} chars)`);
  }
  // progress.md entries: same rule, same reason — the first line after the heading is the point.
  const prog = read(P("progress.md")) || "";
  const entries = prog.split(/^## /m).slice(1);
  for (const e of entries) {
    const lines = e.split("\n");
    const heading = lines[0].trim().slice(0, 40);
    const firstBody = lines.slice(1).map((l) => l.trim()).find((l) => l && !/^[-*|#]/.test(l));
    if (firstBody && firstBody.length > LEAD) buried.push(`progress.md "${heading}" (${firstBody.length} chars)`);
  }
  if (buried.length) {
    add({
      gate: "docs", id: "lead-buried", layer: "project", severity: "warn", count: buried.length,
      symptom: `${buried.length} note(s) open with a paragraph instead of a sentence — the point is somewhere inside, so a reader who stops after one line has nothing`,
      remedy: `put the verdict, decision or finding in the FIRST line, under ${LEAD} characters, then a blank line, then the support. This is the shape, not a style preference: routing reads the first line of checkerNotes, tools/loop-status.mjs shows the first line, and a human skimming reads the first line`,
      evidence: buried.slice(0, 5).join("; "),
    });
  }
}

function gateDuplicateVerification() {
  const fl = readJSON(P("feature_list.json"));
  if (!fl) return;
  const byCmd = new Map();
  for (const f of fl.features || []) {
    const cmd = String(f.verification || "").trim();
    if (!cmd || /REPLACE/i.test(cmd)) continue;
    if (!byCmd.has(cmd)) byCmd.set(cmd, []);
    byCmd.get(cmd).push(f.id);
  }
  const dups = [...byCmd.entries()].filter(([, ids]) => ids.length > 1);
  if (!dups.length) return;
  // A build/prove pair sharing one command is the DELIBERATE exception — the split buys oracle
  // independence and must not be merged. The cost is still real, so name the right fix for each
  // shape rather than telling someone to undo the one thing holding the maker off its own test.
  const kindOf = new Map((fl.features || []).map((f) => [f.id, f.kind]));
  const isPair = (ids) => ids.length === 2 &&
    new Set(ids.map((i) => kindOf.get(i))).size === 2 &&
    ids.every((i) => ["build", "prove"].includes(kindOf.get(i)));
  const pairs = dups.filter(([, ids]) => isPair(ids));
  const plain = dups.filter(([, ids]) => !isPair(ids));
  if (plain.length) {
    add({
      gate: "features", id: "verification-duplicated", layer: "project", severity: "warn",
      count: plain.length,
      symptom: `${plain.length} verification command(s) are shared by features of the same kind — the loop pays full price to run the same proof twice`,
      remedy: "merge them, or give the second a proof of its own. Two features that prove the same thing with the same command are one feature written as two, and each one costs a maker dispatch, a checker dispatch and a baseline run (docs/reference/feature-decomposition.md, 'The lower bound')",
      evidence: plain.slice(0, 3).map(([cmd, ids]) => `${ids.join(" + ")} → ${cmd.slice(0, 40)}`).join("; "),
    });
  }
  if (pairs.length) {
    add({
      gate: "features", id: "build-proved-only-at-top-level", layer: "project", severity: "warn",
      count: pairs.length,
      symptom: `${pairs.length} build feature(s) have no proof of their own — their only verification is the same top-level command as the prove feature above them`,
      remedy: "do NOT merge these: the build/prove split is what stops the maker writing the test it is judged by. Give the build a cheaper proof at its own level instead (docs/testing-standards.md) so a failure says which of the two broke, and the loop stops running the slowest test twice. If no cheaper level exists — a final class, an unmockable boundary — say so in the behavior sentence and accept it deliberately",
      evidence: pairs.slice(0, 3).map(([cmd, ids]) => `${ids.join(" + ")} → ${cmd.slice(0, 40)}`).join("; "),
    });
  }
}

function gateVerificationHome() {
  const fl = readJSON(P("feature_list.json"));
  if (!fl) return;
  // Git-tracked files, so "this script is not even committed" is answerable.
  const tracked = new Set((() => {
    const r = spawnSync("git", ["ls-files"], { cwd: TARGET, encoding: "utf8" });
    return r.status === 0 ? (r.stdout || "").split("\n").filter(Boolean) : [];
  })());
  const RUNNER = /^(\.\/)?(mvnw(\.cmd)?|mvn|gradlew(\.bat)?|gradle|npm|pnpm|yarn|bun|npx|pytest|python3?|go|cargo|dotnet|make|bash|sh)$/;
  const findings = [];
  for (const f of fl.features || []) {
    const cmd = String(f.verification || "").trim();
    if (!cmd) continue;                                   // a missing command is a different gate
    // 1. An inline one-liner: proof with no file, so nothing can maintain or re-read it.
    if (/\bnode\s+-e\b/.test(cmd)) {
      findings.push(`${f.id}: inline \`node -e\``); continue;
    }
    const first = cmd.split(/\s+/)[0];
    const isBaseline = /^(\.\/)?init\.(sh|cmd)$/.test(first) || /^node\s+init\.mjs/.test(cmd);
    if (isBaseline || RUNNER.test(first)) continue;
    // 2. A script argument that is not committed — evidence that will not exist for the next run.
    const scriptArg = cmd.split(/\s+/).find((t) => /\.(mjs|js|cjs|sh|py)$/.test(t));
    const rel = scriptArg ? scriptArg.replace(/^\.\//, "") : null;
    if (rel && !tracked.has(rel) && tracked.size) {
      findings.push(`${f.id}: ${rel} is not committed`); continue;
    }
    // 3. A script outside tools/ — tools/ is where maintained project machinery lives and is
    //    indexed; a root-level or scratch script is the ad-hoc case.
    if (rel && !rel.startsWith("tools/")) findings.push(`${f.id}: ${rel} lives outside tools/`);
  }
  if (findings.length) {
    add({
      gate: "features", id: "verification-outside-test-framework", layer: "project", severity: "warn",
      count: findings.length,
      symptom: `${findings.length} feature(s) verify with a one-off script rather than through the project's test framework`,
      remedy: "move the assertion into the framework docs/testing-standards.md names for its level. A one-off script is a smell that a level is missing: it satisfies 'runnable command' while nobody's test run ever executes it again. If it is real project machinery, commit it under tools/ and index it",
      evidence: findings.slice(0, 5).join("; "),
    });
  }
}

function gateFieldLoss() {
  if (!exists(P("feature_list.json"))) return;
  const prevRaw = spawnSync("git", ["show", "HEAD:feature_list.json"], { cwd: TARGET, encoding: "utf8" });
  if (prevRaw.status !== 0 || !prevRaw.stdout) return;      // no git, no HEAD, or file is new
  let prev = null, now = null;
  try { prev = JSON.parse(prevRaw.stdout); now = readJSON(P("feature_list.json")); } catch { return; }
  if (!prev || !now) return;
  const CARRIES_CONTENT = ["evidence", "checkerNotes", "falsifier", "behavior", "verification"];
  const byId = new Map((now.features || []).map((f) => [f.id, f]));
  const lost = [];
  for (const before of prev.features || []) {
    const after = byId.get(before.id);
    if (!after) continue;                                    // deletion is a re-cut, not field loss
    for (const k of CARRIES_CONTENT) {
      const had = String(before[k] || "").trim();
      const has = String(after[k] || "").trim();
      if (had && !has) lost.push(`${before.id}.${k}`);
    }
  }
  if (lost.length) {
    add({
      gate: "features", id: "feature-field-lost", layer: "project", severity: "blocker", count: lost.length,
      symptom: `${lost.length} field(s) that had content in the last commit are now empty — most likely the array was rewritten from the digest, which does not carry them`,
      remedy: "restore from `git show HEAD:feature_list.json`. A dropped checkerNotes takes its routing marker with it, so the loop silently stops escalating that feature; a dropped evidence unproves a feature nobody will re-check",
      evidence: lost.slice(0, 6).join(", ") + (lost.length > 6 ? ", …" : ""),
    });
  }
}

function gateRouterBudget() {
  const BUDGET = 150;
  for (const name of ["AGENTS.md", "CLAUDE.md"]) {
    const raw = read(P(name));
    if (!raw) continue;
    const lines = raw.split("\n").length;
    if (lines > BUDGET) {
      add({
        gate: "docs", id: "router-bloated", layer: "project", severity: "warn", count: lines,
        symptom: `${name} is ${lines} lines (budget ${BUDGET}) — every agent loads it, every session`,
        remedy: "move detail into docs/ and leave a pointer. The router names what exists and who decides; it is not the place to explain any of it",
      });
    }
    if (!/how you write|brief and concise/i.test(raw)) {
      add({
        gate: "docs", id: "router-no-writing-rule", layer: "project", severity: "warn",
        symptom: `${name} states no writing rule — nothing tells agents to lead with the leverage point and stay brief`,
        remedy: "add the 'How you write' section from templates/tree/AGENTS.md. It is the one instruction surface every agent loads, so it is the only place this rule reaches all of them at once",
      });
    }
    break;                                          // AGENTS.md wins if both exist
  }
}

function gateInitSwallows() {
  if (exists(P("init.mjs"))) return;                 // ported: the gate is JS and run() exits non-zero
  const sh = read(P("init.sh"));
  if (!sh) return;
  const bad = sh.split("\n")
    .map((l, i) => [i + 1, l])
    .filter(([, l]) => /\|\|\s*true\s*$/.test(l) && /\b(run|npm|pnpm|yarn|bun|test|lint|build|check|typecheck|verify)\b/.test(l));
  if (!bad.length) return;
  add({
    gate: "baseline", id: "init-swallows-failure", layer: "harness", severity: "blocker", count: bad.length,
    symptom: `init.sh has ${bad.length} verification step(s) ending in \`|| true\` — a failing step is swallowed and the baseline reports green`,
    remedy: "re-scaffold the gate: it now lives in init.mjs (with init.sh/init.cmd as wrappers), where a non-zero exit stops the run. `|| true` cannot distinguish 'this script does not exist' from 'this script failed', and only the first was intended",
    evidence: bad.slice(0, 3).map(([n, l]) => `init.sh:${n} ${l.trim().slice(0, 60)}`).join("; "),
  });
}

function gateCodexHooks() {
  const raw = read(P(".codex", "hooks.json"));
  if (raw === null) {
    // Only a finding if some role actually needs enforcing.
    const man = readJSON(P("agents.manifest.json"));
    if (!exists(P(".codex", "agents")) || !((man && man.agents) || []).some((a) => a.writes)) return;
    add({
      gate: "loop", id: "codex-hooks-missing", layer: "project", severity: "warn",
      symptom: "Codex agents are generated but .codex/hooks.json is absent — no per-agent write restriction is enforced under Codex",
      remedy: "node tools/gen-agents.mjs --target . --runtime codex. Codex agent TOML cannot express a write list, so this file is the only thing that enforces one",
    });
    return;
  }
  let j = null;
  try { j = JSON.parse(raw); } catch (e) {
    add({
      gate: "loop", id: "codex-hooks-invalid", layer: "project", severity: "blocker",
      symptom: `.codex/hooks.json is not valid JSON (${e.message}) — Codex will run with no hooks at all`,
      remedy: "regenerate with node tools/gen-agents.mjs --target . --runtime codex",
    });
    return;
  }
  const ALLOWED = new Set(["description", "hooks"]);
  const bad = Object.keys(j).filter((k) => !ALLOWED.has(k));
  if (bad.length) {
    add({
      gate: "loop", id: "codex-hooks-invalid", layer: "project", severity: "blocker", count: bad.length,
      symptom: `.codex/hooks.json has ${bad.length} key(s) Codex does not accept (${bad.join(", ")}) — it rejects the entire file and runs with NO hooks`,
      remedy: "Codex allows only `description` and `hooks` here. The failure is near-invisible: one warning line on stderr, after which write-restricted roles are unrestricted and still look well-behaved because their prompts tell them to be",
      evidence: bad.join(", "),
    });
  }
}

function gateMcp() {
  // One entry per runtime: where its MCP config lives, and how to read the server names out of it.
  // Codex's is TOML, so the names come from the [mcp_servers.<name>] table headers rather than JSON.
  const codexToml = read(P(".codex", "config.toml"));
  const runtimes = [
    { id: "kiro", installed: exists(P(".kiro", "agents")),
      servers: (() => { const j = readJSON(P(".kiro", "settings", "mcp.json")); return j ? Object.keys(j.mcpServers || {}) : null; })() },
    { id: "claude", installed: exists(P(".claude", "agents")),
      servers: (() => { const j = readJSON(P(".mcp.json")); return j ? Object.keys(j.mcpServers || {}) : null; })() },
    { id: "codex", installed: exists(P(".codex", "agents")),
      servers: codexToml === null ? null : [...codexToml.matchAll(/^\[mcp_servers\.([^\]]+)\]/gm)].map((m) => m[1].replace(/^"|"$/g, "")) },
  ].filter((r) => r.installed);
  if (runtimes.length < 2) return;                 // nothing to be skewed against
  const configured = runtimes.filter((r) => r.servers !== null);
  if (!configured.length) return;                  // no MCP anywhere is a choice, not a skew
  const absent = runtimes.filter((r) => r.servers === null);
  if (absent.length && configured.some((r) => r.servers.length)) {
    add({
      gate: "loop", id: "mcp-runtime-skew", layer: "project", severity: "warn", count: absent.length,
      symptom: `agents are generated for ${runtimes.length} runtimes but ${absent.map((r) => r.id).join(", ")} ${absent.length > 1 ? "have" : "has"} no MCP config at all`,
      remedy: "re-run setup-harness-loop.mjs, which writes .kiro/settings/mcp.json, .mcp.json and .codex/config.toml from one source",
    });
    return;
  }
  const all = [...new Set(configured.flatMap((r) => r.servers))].sort();
  const diff = [];
  for (const name of all) {
    const missing = configured.filter((r) => !r.servers.includes(name)).map((r) => r.id);
    if (missing.length) diff.push(`${name} (missing from ${missing.join(", ")})`);
  }
  if (diff.length) {
    add({
      gate: "loop", id: "mcp-runtime-skew", layer: "project", severity: "warn", count: diff.length,
      symptom: `${diff.length} MCP server(s) are configured for some runtimes and not others`,
      remedy: "add the server to EVERY installed runtime's config (.kiro/settings/mcp.json, .mcp.json, .codex/config.toml). An agent that can query a cluster under one runtime and not another produces two different verdicts for the same feature",
      evidence: diff.join(", "),
    });
  }
}

// A prompt that tells an agent to edit `FOO_BAR` in a script that has no FOO_BAR sends it looking
// for something that does not exist — and an agent that cannot find it improvises. This is the same
// failure class as a broken file:// URI: the prompt still reads plausibly, and only the behaviour is
// wrong. Caught here because it happened: the k8s prompt named three config variables that had been
// removed from the script it named.
function gatePromptVars() {
  const bad = [];
  for (const f of lsSafe(P("prompts")).filter((x) => x.endsWith(".md"))) {
    const lines = (read(P("prompts", f)) || "").split("\n");
    for (let i = 0; i < lines.length; i++) {
      const scripts = [...lines[i].matchAll(/`?(tools\/[\w.-]+\.(?:sh|mjs))`?/g)].map((m) => m[1]);
      if (!scripts.length) continue;
      // Variables are often listed on the following line or two, not the one naming the script.
      const window = lines.slice(i, i + 3).join("\n");
      const vars = [...window.matchAll(/`([A-Z][A-Z0-9]*(?:_[A-Z0-9]+){1,})`/g)].map((m) => m[1]);
      if (!vars.length) continue;
      for (const sc of scripts) {
        const body = read(P(sc));
        if (body === null) continue;             // agent-uri-broken / other gates own missing files
        for (const v of new Set(vars)) {
          if (!body.includes(v)) bad.push(`prompts/${f}:${i + 1} names ${v} in ${sc}`);
        }
      }
    }
  }
  if (bad.length) {
    add({
      gate: "loop", id: "prompt-cites-missing-var", layer: "project", severity: "warn", count: bad.length,
      symptom: `${bad.length} prompt reference(s) name a variable the script does not define`,
      remedy: "update the prompt to match the script, or the script to match the prompt. An agent told to fill in a variable that does not exist will improvise something that looks like an answer",
      evidence: bad.slice(0, 4).join("; "),
    });
  }
}

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
gateMemorySharedTier();
gateDesign();
gateDocs();
gateStateLogStyle();
gateRules();

gateGenerated();
gateGraph();
gateK8s();
gatePromptVars();
gateVendor();
gateFeatureContext();
gateLead();
gateDuplicateVerification();
gateVerificationHome();
gateFieldLoss();
gateRouterBudget();
gateInitSwallows();
gateCodexHooks();
gateMcp();
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
  // writeSync, not console.log: stdout on a pipe is async and the process exits below, so any
  // report past the pipe buffer (~8 KB on macOS) was silently truncated for every spawnSync
  // caller. adoption-baseline hit exactly that the moment aeron-demo's report crossed 8 KB —
  // and a truncated report parses as "could not read", not as "wrong", which is the good case.
  // The bad case is a consumer that tolerates partial JSON and under-reports.
  writeSync(1, JSON.stringify(report, null, 2) + "\n");
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
