#!/usr/bin/env node
// survey-project.mjs — read a repository and write down what it actually is.
//
// `harness-onboarder` already surveys, but it does it as an LLM reading prose, so the result is a
// paragraph nobody can diff and no gate can check. `setup-harness-loop.mjs` detects the package
// manager and nothing else. So the project-specific half of AGENTS.md — what this repo IS, the real
// commands, where things live — has always been hand-written, on every project, from scratch.
//
// This gathers it mechanically. Two rules make the output trustworthy:
//
//   1. EVERY fact carries its source. A command is reported with the file it was read from, so a
//      reader can check it. A command that is conventional for the stack but appears nowhere in the
//      repo is not a fact about this repo.
//   2. What cannot be derived is `null`, never guessed. The project's PURPOSE is the obvious one:
//      no amount of reading tells you why it exists. A survey that invents a purpose produces an
//      AGENTS.md whose first paragraph is wrong, which is worse than a blank.
//
// Usage:
//   node tools/survey-project.mjs --target DIR            human-readable
//   node tools/survey-project.mjs --target DIR --json     project-survey.json shape
//   node tools/survey-project.mjs --target DIR --agents-md > AGENTS.md
import { readFileSync, existsSync, readdirSync, statSync, writeSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";

const args = process.argv.slice(2);
const opt = (n, d = null) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const TARGET = path.resolve(opt("--target", "."));
const JSON_OUT = args.includes("--json");
const AGENTS_MD = args.includes("--agents-md");
const P = (...p) => path.join(TARGET, ...p);
const read = (p) => { try { return readFileSync(p, "utf8"); } catch { return null; } };
const readJSON = (p) => { try { return JSON.parse(readFileSync(p, "utf8")); } catch { return null; } };
const ls = (p) => { try { return readdirSync(p); } catch { return []; } };
const isDir = (p) => { try { return statSync(p).isDirectory(); } catch { return false; } };
const SKIP = new Set(["node_modules", ".git", "target", "build", "dist", ".venv", "venv",
  "__pycache__", ".idea", ".vscode", "vendor", ".gradle", "out", "bin", "obj", "trace"]);

// --- stack -------------------------------------------------------------------------------------
const MANIFESTS = [
  ["package.json", "node"], ["pom.xml", "maven"], ["build.gradle", "gradle"],
  ["build.gradle.kts", "gradle"], ["go.mod", "go"], ["Cargo.toml", "rust"],
  ["pyproject.toml", "python"], ["requirements.txt", "python"], ["Gemfile", "ruby"],
  ["composer.json", "php"], ["CMakeLists.txt", "cmake"], ["Makefile", "make"],
];
const manifests = MANIFESTS.filter(([f]) => existsSync(P(f))).map(([f, stack]) => ({ file: f, stack }));
const stacks = [...new Set(manifests.map((m) => m.stack))];

// --- the REAL commands, each with the file it came from ------------------------------------------
// Order matters: CI is the most authoritative statement of "what must pass", because it is what
// actually blocks a merge. A README can be years stale; a Makefile can be aspirational.
const commands = [];
const addCmd = (kind, cmd, source) => {
  if (!cmd || !String(cmd).trim()) return;
  if (commands.some((c) => c.cmd === cmd)) return;
  commands.push({ kind, cmd: String(cmd).trim(), source });
};
for (const ci of [".github/workflows", ".gitlab-ci.yml", ".circleci/config.yml", "Jenkinsfile"]) {
  if (!existsSync(P(ci))) continue;
  const files = isDir(P(ci)) ? ls(P(ci)).map((f) => `${ci}/${f}`) : [ci];
  for (const f of files) {
    const body = read(P(f)) || "";
    for (const m of body.matchAll(/^\s*(?:-\s*)?(?:run:\s*)?((?:\.\/)?(?:mvnw|gradlew|npm|pnpm|yarn|make|cargo|go|dotnet|pytest|python)[^\n|>]*)$/gm)) {
      const c = m[1].trim();
      // Substring, not \b, for the verbs: gradle tasks are camelCase, so `./gradlew customVerifyTask`
      // never matched `verify\b` and the repo's actual CI command was dropped. `ci` keeps its word
      // boundary — as a substring it matches "special", "notice" and most of the dictionary.
      if ((/(test|verify|build|check|lint)/i.test(c) || /\bci\b/i.test(c)) && c.length < 120) {
        addCmd("ci", c, f);
      }
    }
  }
}
const pkg = readJSON(P("package.json"));
if (pkg && pkg.scripts) {
  for (const k of ["test", "build", "lint", "typecheck", "check", "verify"]) {
    if (pkg.scripts[k]) addCmd(k, `npm run ${k}`, "package.json#scripts");
  }
}
if (existsSync(P("Makefile"))) {
  for (const m of (read(P("Makefile")) || "").matchAll(/^([a-zA-Z][\w-]*):/gm)) {
    if (/^(test|build|check|verify|lint|all)$/.test(m[1])) addCmd(m[1], `make ${m[1]}`, "Makefile");
  }
}
if (existsSync(P("pom.xml"))) addCmd("verify", existsSync(P("mvnw")) ? "./mvnw -q verify" : "mvn -q verify", "pom.xml");
if (existsSync(P("build.gradle")) || existsSync(P("build.gradle.kts"))) {
  addCmd("build", existsSync(P("gradlew")) ? "./gradlew build" : "gradle build", "build.gradle");
}
if (existsSync(P("go.mod"))) addCmd("test", "go test ./...", "go.mod");
if (existsSync(P("Cargo.toml"))) addCmd("test", "cargo test", "Cargo.toml");

// --- layout ------------------------------------------------------------------------------------
// A hardcoded skip list always misses one: the real Aeron repo has `graphify-out/`, 1496 generated
// JSON files, which topped the map as if it were the project. It is not gitignored either — merely
// untracked. So ask the sharper question: which directories does git actually TRACK files in?
// Everything else is output, scratch, or someone's local mess, and none of it is the project.
const tracked = (() => {
  const r = spawnSync("git", ["ls-files"], { cwd: TARGET, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  if (r.status !== 0) return null;                       // not a repo: fall back to the skip list
  const tops = new Set();
  for (const line of (r.stdout || "").split("\n")) {
    const seg = line.split("/")[0];
    if (seg) tops.add(seg);
  }
  return tops;
})();
const layout = [];
for (const e of ls(TARGET)) {
  if (SKIP.has(e) || e.startsWith(".")) continue;
  if (tracked && !tracked.has(e)) continue;   // untracked or ignored: not part of the project
  if (!isDir(P(e))) continue;
  let files = 0; const exts = {};
  const walk = (d, depth = 6) => {
    if (depth < 0) return;
    for (const x of ls(d)) {
      if (SKIP.has(x)) continue;
      const q = path.join(d, x);
      if (isDir(q)) walk(q, depth - 1);
      else { files++; const ext = path.extname(x); if (ext) exts[ext] = (exts[ext] || 0) + 1; }
    }
  };
  walk(P(e));
  const top = Object.entries(exts).sort((a, b) => b[1] - a[1])[0];
  layout.push({ dir: e, files, mainType: top ? top[0] : null });
}
layout.sort((a, b) => b.files - a.files);

// --- knowledge already here ----------------------------------------------------------------------
const docs = [];
for (const cand of ["README.md", "ARCHITECTURE.md", "CONTRIBUTING.md", "DESIGN.md", "docs", "doc", "adr", "docs/adr"]) {
  const p = P(cand);
  if (!existsSync(p)) continue;
  if (isDir(p)) {
    for (const f of ls(p)) if (f.endsWith(".md")) {
      const lines = (read(path.join(p, f)) || "").split("\n").length;
      docs.push({ file: `${cand}/${f}`, lines, overBudget: lines > 300 });
    }
  } else {
    const lines = (read(p) || "").split("\n").length;
    docs.push({ file: cand, lines, overBudget: lines > 300 });
  }
}

// --- tests ---------------------------------------------------------------------------------------
const testDirs = ["test", "tests", "src/test", "spec", "__tests__"].filter((d) => existsSync(P(d)));
let testFiles = 0; const testNames = [];
const collectTests = (d, depth = 8) => {
  if (depth < 0) return;
  for (const x of ls(d)) {
    if (SKIP.has(x)) continue;
    const q = path.join(d, x);
    if (isDir(q)) collectTests(q, depth - 1);
    else if (/(test|spec|_test|Test|SIT|IT)\.\w+$/.test(x)) { testFiles++; if (testNames.length < 6) testNames.push(x); }
  }
};
for (const d of testDirs.length ? testDirs : ["src", "."]) collectTests(P(d), 6);

// --- collisions: what a scaffold would overwrite --------------------------------------------------
const collisions = ["AGENTS.md", "CLAUDE.md", "feature_list.json", "init.sh", "init.mjs",
  "progress.md", "DECISIONS.md", ".kiro", ".claude", ".codex"].filter((f) => existsSync(P(f)));

// --- in flight ------------------------------------------------------------------------------------
const git = (a) => spawnSync("git", a, { cwd: TARGET, encoding: "utf8" });
const isRepo = git(["rev-parse", "HEAD"]).status === 0;
const recent = isRepo ? (git(["log", "-5", "--format=%h %s"]).stdout || "").split("\n").filter(Boolean) : [];
const branch = isRepo ? (git(["rev-parse", "--abbrev-ref", "HEAD"]).stdout || "").trim() : null;

const survey = {
  schema: "project-survey/1",
  name: path.basename(TARGET),
  // Nothing in a repository states WHY it exists. Reading one and writing a purpose produces an
  // AGENTS.md whose first paragraph is confidently wrong, which is worse than a blank.
  purpose: null,
  purposeSource: "needs-human — no file states why this project exists",
  stacks, manifests, commands, layout, docs, collisions,
  tests: { dirs: testDirs, files: testFiles, examples: testNames },
  git: { isRepo, branch, recent },
};

// --- output ---------------------------------------------------------------------------------------
if (JSON_OUT) { writeSync(1, JSON.stringify(survey, null, 2) + "\n"); process.exit(0); }

if (AGENTS_MD) {
  const cmd = commands.find((c) => c.kind === "ci") || commands.find((c) => /verify|test/.test(c.kind)) || commands[0];
  const L = [];
  L.push(`# ${survey.name}`, "");
  L.push("<!-- NEEDS HUMAN: one sentence on what this project is for. Nothing in the repository");
  L.push("     states it, so the survey left it blank rather than inventing it. -->", "");
  L.push("Router for agents working in this repo. Detail lives in `docs/`, revealed on demand.", "");
  L.push("## The six that carry everything", "");
  L.push("Violating one of these breaks the loop itself. Everything below is detail.", "");
  L.push("1. **Don't pick your own next task** — `node loop/route.mjs` names the next node and why.");
  L.push("2. **WIP = 1.** One feature `active`. Finish it before touching another.");
  L.push("3. **The worker never grades itself.** Only the checker sets `status: done`.");
  L.push("4. **No claim without a run.** Paste the real command output, or it did not happen.");
  L.push("5. **Change the workflow → update `docs/reference/graph.md` in the same commit.**");
  L.push("6. **Escalate instead of guessing.** An unanswered question is a handoff, not an assumption.", "");
  L.push("## Verification Commands", "");
  L.push("```bash");
  if (cmd) L.push(`${cmd.cmd}    # from ${cmd.source}`);
  else L.push("# NEEDS HUMAN: no build/test command was found in CI, Makefile or any manifest.");
  L.push("```", "");
  if (commands.length > 1) {
    L.push("Others found in this repo, each with where it was read from:", "");
    for (const c of commands.slice(0, 6)) L.push(`- \`${c.cmd}\` — ${c.kind}, from \`${c.source}\``);
    L.push("");
  }
  L.push("## Map", "");
  L.push(`Stack: ${stacks.join(", ") || "not detected"}. Largest directories:`, "");
  for (const d of layout.slice(0, 6)) L.push(`- \`${d.dir}/\` — ${d.files} files${d.mainType ? `, mostly \`${d.mainType}\`` : ""}`);
  if (docs.length) {
    L.push("", "Knowledge already here:", "");
    for (const d of docs.slice(0, 8)) L.push(`- \`${d.file}\` (${d.lines} lines)${d.overBudget ? " — **over the 300-line budget, split it**" : ""}`);
  }
  L.push("", `Tests: ${survey.tests.files} file(s)${testDirs.length ? ` under ${testDirs.map((d) => `\`${d}\``).join(", ")}` : ""}` +
    (testNames.length ? `, e.g. ${testNames.slice(0, 3).map((n) => `\`${n}\``).join(", ")}` : ""), "");
  L.push("<!-- The sections a full harness AGENTS.md also carries — Startup Readiness, Who runs next,");
  L.push("     While you work, How you write, Definition of Done, End of Session, Escalate — come from");
  L.push("     templates/tree/AGENTS.md. This file is the SURVEYED half: what only this repo can say. -->");
  writeSync(1, L.join("\n") + "\n");
  process.exit(0);
}

const out = [];
out.push("", `  SURVEY — ${survey.name}`, "  " + "─".repeat(66));
out.push(`  stack        ${stacks.join(", ") || "not detected"}   (${manifests.map((m) => m.file).join(", ") || "no manifest"})`);
out.push(`  purpose      NEEDS HUMAN — nothing in the repo states why it exists`);
out.push("");
out.push(`  commands     ${commands.length} found, each with its source`);
for (const c of commands.slice(0, 6)) out.push(`      ${c.kind.padEnd(10)} ${c.cmd.slice(0, 44).padEnd(46)} ${c.source}`);
if (!commands.length) out.push("      none — NEEDS HUMAN: nothing in CI, Makefile or a manifest states how to verify this");
out.push("");
out.push(`  layout`);
for (const d of layout.slice(0, 6)) out.push(`      ${d.dir.padEnd(22)} ${String(d.files).padStart(5)} files  ${d.mainType || ""}`);
out.push("");
out.push(`  tests        ${survey.tests.files} file(s)` + (testDirs.length ? ` under ${testDirs.join(", ")}` : " — none found"));
if (docs.length) {
  const over = docs.filter((d) => d.overBudget);
  out.push(`  docs         ${docs.length} file(s)` + (over.length ? `, ${over.length} over the 300-line budget: ${over.slice(0, 3).map((d) => d.file).join(", ")}` : ""));
}
if (collisions.length) out.push(`  collisions   a scaffold would overwrite: ${collisions.join(", ")}`);
if (recent.length) { out.push(`  in flight    branch ${branch}`); for (const r of recent.slice(0, 3)) out.push(`      ${r.slice(0, 66)}`); }
out.push("");
out.push("  Draft the router from it:  node tools/survey-project.mjs --agents-md > AGENTS.md");
out.push("");
writeSync(1, out.join("\n") + "\n");
