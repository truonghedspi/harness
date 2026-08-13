#!/usr/bin/env node
// check-coverage.mjs — prove all 13 Learn-Harness-Engineering lessons are covered in a project.
// Usage: node check-coverage.mjs [--target DIR] [--json]
// Implements references/13-lesson-coverage.md. Exit code 0 iff 13/13 pass — so it can gate a
// loop or CI. Structural only: a green report on a red ./init.sh proves files are in place, not
// that the project works. Always run ./init.sh too.
import { readFileSync, statSync, readdirSync } from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
const targetIdx = args.indexOf("--target");
const TARGET = path.resolve(targetIdx >= 0 ? args[targetIdx + 1] : ".");
const AS_JSON = args.includes("--json");

const P = (...p) => path.join(TARGET, ...p);
const exists = (p) => { try { statSync(p); return true; } catch { return false; } };
const read = (p) => { try { return readFileSync(p, "utf8"); } catch { return null; } };
const isExec = (p) => { try { return (statSync(p).mode & 0o111) !== 0; } catch { return false; } };
const readJSON = (p) => { try { return JSON.parse(readFileSync(p, "utf8")); } catch { return null; } };

// The agent router file: AGENTS.md preferred, CLAUDE.md accepted.
const agentFile = exists(P("AGENTS.md")) ? "AGENTS.md" : exists(P("CLAUDE.md")) ? "CLAUDE.md" : null;
const agent = agentFile ? read(P(agentFile)) : null;

const MANIFESTS = ["package.json", "pyproject.toml", "requirements.txt", "go.mod", "Cargo.toml", "pom.xml", "build.gradle", "build.gradle.kts"];
const hasManifest = MANIFESTS.some((m) => exists(P(m))) || readdirSyncSafe(TARGET).some((f) => f.endsWith(".csproj") || f.endsWith(".sln"));
function readdirSyncSafe(d) { try { return readdirSync(d); } catch { return []; } }

const fl = readJSON(P("feature_list.json"));
const features = fl && Array.isArray(fl.features) ? fl.features : null;
const VALID_STATES = new Set(["not-started", "not_started", "active", "in-progress", "blocked", "passing", "done"]);

// The gate itself is init.mjs; init.sh/init.cmd are wrappers. Read whichever exists so this
// works both on targets scaffolded before the port and on ones scaffolded after.
const initSh = read(P("init.mjs")) || read(P("init.sh"));
const agentJsonFiles = readdirSyncSafe(P(".kiro", "agents")).filter((f) => f.endsWith(".json"));
const agentJsonBlob = agentJsonFiles.map((f) => read(P(".kiro", "agents", f)) || "").join("\n");

// A check returns [pass:boolean, detail:string].
const ok = (d) => [true, d];
const no = (d) => [false, d];

const CHECKS = [
  ["L1  Definition of Done", () => {
    if (!exists(P("docs/definition-of-done.md"))) return no("missing docs/definition-of-done.md");
    if (!agent || !/definition of done/i.test(agent)) return no(`${agentFile || "AGENTS.md"} lacks a Definition of Done section`);
    return ok("DoD doc + section present");
  }],
  ["L2  Five subsystems", () => {
    const missing = [];
    if (!agent) missing.push("instructions(AGENTS.md)");
    if (!hasManifest) missing.push("environment(manifest)");
    if (!exists(P("progress.md"))) missing.push("state(progress.md)");
    if (!initSh) missing.push("feedback(init.sh)");
    const hasVerifDoc = (agent && /verificat/i.test(agent)) || (initSh && /(test|build|check|verify)/i.test(initSh));
    if (!hasVerifDoc) missing.push("verification-command");
    return missing.length ? no("missing: " + missing.join(", ")) : ok("instructions/tools/env/state/feedback present");
  }],
  ["L3  Fresh Session Test", () => {
    const a = read(P("docs/architecture.md"));
    if (!a) return no("missing docs/architecture.md");
    const q = [[/what/i, "what"], [/organiz/i, "organization"], [/\brun\b/i, "run"], [/verif/i, "verify"], [/(where are we|current state)/i, "where-now"]];
    const gaps = q.filter(([re]) => !re.test(a)).map(([, n]) => n);
    return gaps.length ? no("architecture.md missing: " + gaps.join(", ")) : ok("answers all 5 fresh-session questions");
  }],
  ["L4  Router, not manual", () => {
    if (!agent) return no("no AGENTS.md/CLAUDE.md");
    const lines = agent.split("\n").length;
    const docLinks = new Set((agent.match(/docs\/[\w-]+\.md/g) || []));
    if (lines > 200) return no(`${agentFile} is ${lines} lines (>200) — split into docs/`);
    if (docLinks.size < 2) return no(`${agentFile} links only ${docLinks.size} docs/ files (need >=2)`);
    return ok(`${lines} lines, links ${docLinks.size} topic docs`);
  }],
  ["L5  Cross-session state", () => {
    const missing = [];
    if (!exists(P("progress.md"))) missing.push("progress.md");
    if (!exists(P("DECISIONS.md"))) missing.push("DECISIONS.md");
    if (missing.length) return no("missing: " + missing.join(", "));
    if (!agent || !/(startup workflow|start of session)/i.test(agent) || !/end of session/i.test(agent))
      return no(`${agentFile} lacks clock-in/clock-out — copy the "Startup Workflow (start of session — clock in)" section from templates/tree/AGENTS.md and fill it with this project's real startup steps`);
    return ok("progress + decisions + clock-in/out present");
  }],
  ["L6  Init phase", () => {
    if (!exists(P("init.mjs")) && !exists(P("init.sh"))) return no("missing init.mjs (and no legacy init.sh)");
    // Windows has no exec bit and cmd.exe cannot run a .sh at all, so requiring both there reports a
    // failure the user cannot fix. What matters per platform is that a runnable entry point exists.
    if (process.platform === "win32") {
      if (exists(P("init.mjs")) && !exists(P("init.cmd"))) return no("init.cmd missing — cmd.exe/PowerShell cannot run init.sh");
    } else if (exists(P("init.sh")) && !isExec(P("init.sh"))) {
      return no("init.sh is not executable (chmod +x)");
    }
    if (!agent || !/startup readiness/i.test(agent)) return no(`${agentFile} lacks a Startup Readiness section`);
    return ok("runnable init entry point + readiness checklist");
  }],
  ["L7  WIP = 1", () => {
    if (!agent) return no("no AGENTS.md/CLAUDE.md");
    if (/(wip\s*=?\s*1|one feature at a time|one active|single active)/i.test(agent)) return ok("WIP=1 rule present");
    return no(`${agentFile} lacks a WIP=1 / one-feature-at-a-time rule`);
  }],
  ["L8  Feature list primitive", () => {
    if (!fl) return no("feature_list.json missing or invalid JSON");
    if (!features || !features.length) return no("feature_list.json has no features");
    const bad = features.filter((f) => {
      const verif = f.verification || f.verify;
      const state = f.status || f.state;
      return !verif || !String(verif).trim() || !VALID_STATES.has(String(state));
    });
    return bad.length ? no(`${bad.length} feature(s) lack a verification command or valid state`) : ok(`${features.length} features carry behavior+verification+state`);
  }],
  ["L9  Externalized termination", () => {
    if (!exists(P("loop/checker-prompt.md"))) return no("missing loop/checker-prompt.md (no independent checker)");
    if (!features) return no("feature_list.json invalid — cannot check evidence field");
    const noEvidence = features.filter((f) => !Object.prototype.hasOwnProperty.call(f, "evidence"));
    return noEvidence.length ? no(`${noEvidence.length} feature(s) lack an 'evidence' field`) : ok("checker present + every feature has evidence field");
  }],
  ["L10 Full-pipeline verification", () => {
    const t = read(P("docs/testing-standards.md"));
    if (!t) return no("missing docs/testing-standards.md");
    const levels = [
      [/unit/i, "unit"],
      [/integration/i, "integration"],
      [/(micro-?service|cross-service|service-to-service|contract|e2e|end-to-end|end to end)/i, "microservice-integration"],
    ];
    const gaps = levels.filter(([re]) => !re.test(t)).map(([, n]) => n);
    if (gaps.length) return no("testing-standards.md missing level(s): " + gaps.join(", ") + " — name the level after the tests this project actually has; if they exist under another name, relabel the section, do not invent a level");
    if (!initSh || !/(test|build|check|verify|pytest|gradle|mvn|cargo|dotnet)/i.test(initSh)) return no("init does not run a build/test/check step");
    return ok("3 levels documented + init runs the pipeline");
  }],
  ["L11 Observability", () => {
    if (!exists(P("tools/trace.mjs"))) return no("missing tools/trace.mjs");
    if (!/trace\.mjs/.test(agentJsonBlob)) return no("no .kiro/agents/*.json references trace.mjs in hooks");
    return ok("trace.mjs present + wired into agent hooks");
  }],
  ["L12 Clean-state handoff", () => {
    if (!agent || !/(end of session|clean state)/i.test(agent)) return no(`${agentFile} lacks a clean-state exit — copy the "End of Session (clock out — leave clean state)" section from templates/tree/AGENTS.md and fill it with this project's real exit conditions`);
    if (!exists(P("session-handoff.md"))) return no("missing session-handoff.md");
    return ok("exit checklist + handoff file present");
  }],
  ["L13 Autonomous loop", () => {
    const required = ["loop/goal.md", "loop/maker-prompt.md", "loop/checker-prompt.md", "loop/run-loop.sh", ".kiro/agents/maker.json", ".kiro/agents/checker.json"];
    const missing = required.filter((r) => !exists(P(r)));
    if (missing.length) return no("missing: " + missing.join(", "));
    const goal = read(P("loop/goal.md"));
    if (!goal || !/stop condition/i.test(goal)) return no("loop/goal.md lacks a stop-condition section");
    return ok("goal+maker+checker+run-loop+agents present, goal has stop conditions");
  }],
];

const results = CHECKS.map(([label, fn]) => {
  let pass = false, detail = "";
  try { [pass, detail] = fn(); } catch (e) { pass = false; detail = "check error: " + e.message; }
  return { label, pass, detail };
});
const passed = results.filter((r) => r.pass).length;

if (AS_JSON) {
  console.log(JSON.stringify({ target: TARGET, passed, total: results.length, results }, null, 2));
} else {
  console.log(`\n13-Lesson Coverage — ${TARGET}\n`);
  for (const r of results) console.log(`  ${r.pass ? "PASS" : "FAIL"}  ${r.label.padEnd(30)} ${r.detail}`);
  console.log(`\n  ${passed}/13 lessons covered.` + (passed < 13 ? "  Fix the FAIL rows above (lowest-covered first)." : "  Now confirm ./init.sh is green — structural coverage is necessary, not sufficient."));
  console.log("");
}

process.exit(passed === results.length ? 0 : 1);
