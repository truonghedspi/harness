#!/usr/bin/env node
// setup-harness-loop.mjs — scaffold a full harness + maker-checker loop into any project,
// covering all 13 Learn-Harness-Engineering lessons. Node built-ins only.
//
// Usage:
//   node setup-harness-loop.mjs --target /path/to/project [options]
// Options:
//   --agent-file CLAUDE.md          router filename (default AGENTS.md)
//   --package-manager npm|pnpm|yarn|bun
//   --commands "cmd one,cmd two"    override the auto-detected verification block in init.sh
//   --name "Project X"              project name for templates
//   --purpose "one line"            one-line project purpose
//   --force                         overwrite existing files (requires explicit user OK)
import { readdirSync, statSync, readFileSync, writeFileSync, mkdirSync, chmodSync, utimesSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const args = process.argv.slice(2);
const opt = (name, def = null) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : def; };
const flag = (name) => args.includes(name);

const TARGET = opt("--target");
if (!TARGET) { console.error("error: --target /path/to/project is required"); process.exit(2); }
const targetRoot = path.resolve(TARGET);
const LAYOUT = opt("--layout", process.env.HARNESS_LAYOUT || "contained");
if (!new Set(["contained", "legacy"]).has(LAYOUT)) { console.error("error: --layout must be contained|legacy"); process.exit(2); }
const harnessRoot = LAYOUT === "contained" ? path.join(targetRoot, "harness") : targetRoot;
const AGENT_FILE = opt("--agent-file", "AGENTS.md");
const FORCE = flag("--force");
const NAME = opt("--name", path.basename(targetRoot));
const PURPOSE = opt("--purpose", "One-line description of what this project does — replace me.");
const COMMANDS = opt("--commands", null);
// kiro | claude | codex | both (=kiro,claude) | all | comma list. Default `all`: the agent files are
// small, and which CLI the next person has is not knowable from here — generating only the one on
// THIS machine is how a repo arrives somewhere else with no usable agents at all.
const RUNTIME = opt("--runtime", "all");
// k8s: auto|on|off. Shipping the Kubernetes layer as a manual copy was the wrong default for any
// org where Helm and kube ARE the deployment (most of them). `auto` turns it on when the target
// already has a chart, which is the cheapest true signal that this project is deployed that way.
const K8S = opt("--k8s", "auto");
// --integration <services.manifest.json> scaffolds the target ABOVE the individual repos: its scope
// is the registry, its features are cross-service scenarios, and its Level 3 command is the
// multi-service environment. Each service repo keeps its own harness for in-service work
// (references/multi-service.md).
const INTEGRATION = opt("--integration", null);
// --gitignore-harness: keep the skill's MACHINERY out of the product repo. Off by default, because
// a repo that ignores it cannot run the loop until someone re-installs the harness — a real cost
// that has to be chosen, not inherited.
const IGNORE_MACHINERY = args.includes("--gitignore-harness");

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.resolve(scriptDir, "..");
const treeRoot = path.join(skillRoot, "templates", "tree");

const exists = (p) => { try { statSync(p); return true; } catch { return false; } };

// --- package manager / verification detection ---------------------------------------------
function detectPM() {
  if (opt("--package-manager")) return opt("--package-manager");
  if (exists(path.join(targetRoot, "pnpm-lock.yaml"))) return "pnpm";
  if (exists(path.join(targetRoot, "yarn.lock"))) return "yarn";
  if (exists(path.join(targetRoot, "bun.lockb")) || exists(path.join(targetRoot, "bun.lock"))) return "bun";
  if (exists(path.join(targetRoot, "package.json"))) return "npm";
  return null;
}
const PM = detectPM();
const PRIMARY_CMD = "./init.sh    # full baseline gate (Lesson 6/9/12)";

// Custom verification block for init.sh, if --commands given.
// The verification block lives in init.mjs (init.sh and init.cmd are wrappers), so a custom block
// is JavaScript now. Each command still goes through run(), which means a non-zero exit stops the
// gate — the bash version this replaces wrapped these in `|| true` and could not go red.
function customVerificationBlock() {
  if (!COMMANDS) return null;
  const cmds = COMMANDS.split(",").map((c) => c.trim()).filter(Boolean);
  return [
    "// >>> VERIFICATION  (custom, provided at setup)",
    'say("=== Custom verification ===");',
    ...cmds.map((c) => `run(${JSON.stringify(c)});`),
    "// <<< VERIFICATION",
  ].join("\n");
}

// --- substitution ---------------------------------------------------------------------------
function substitute(content, relPath) {
  let out = content
    .replaceAll("{{PROJECT_NAME}}", NAME)
    .replaceAll("{{PROJECT_PURPOSE}}", PURPOSE)
    .replaceAll("{{PRIMARY_VERIFICATION_COMMAND}}", PRIMARY_CMD)
    .replaceAll("{{DATE}}", new Date().toISOString().slice(0, 10));

  // Rename the router if a different agent file was requested, and fix in-text references.
  if (AGENT_FILE !== "AGENTS.md") out = out.replaceAll("AGENTS.md", AGENT_FILE);

  if (LAYOUT === "contained") {
    out = out
      .replaceAll("node tools/", "node harness/tools/")
      .replaceAll("node loop/", "node harness/loop/")
      .replaceAll("node init.mjs", "node harness/init.mjs")
      .replaceAll("./init.sh", "./harness/init.sh")
      .replaceAll("init.cmd", "harness/init.cmd");
    if (relPath.endsWith(".md")) {
      out = out
        .replace(/(?<!harness\/)\b(docs|prompts|loop|tools|skills|memory|trace)\//g, "harness/$1/")
        .replace(/(?<!harness\/)\b(feature_list(?:\.digest)?\.md|feature_list\.json|progress\.md|DECISIONS\.md|session-handoff\.md|agents\.manifest\.json)\b/g, "harness/$1");
    }
  }

  // Swap the verification block when custom commands were provided.
  if (relPath === "init.mjs") {
    const custom = customVerificationBlock();
    if (custom) {
      out = out.replace(/\/\/ >>> VERIFICATION[\s\S]*?\/\/ <<< VERIFICATION/, custom);
    }
  }
  return out;
}

// Destination path for a template-relative path (handles agent-file rename).
function destOf(relPath) {
  if (relPath === ".gitignore") return path.join(targetRoot, relPath);
  return path.join(harnessRoot, relPath);
}

// --- walk + write ---------------------------------------------------------------------------
const written = [], skipped = [];
function walk(dir, rel = "") {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name);
    const childRel = rel ? path.join(rel, entry.name) : entry.name;
    if (entry.isDirectory()) { walk(abs, childRel); continue; }
    const dest = destOf(childRel);
    if (exists(dest) && !FORCE) { skipped.push(path.relative(targetRoot, dest)); continue; }
    mkdirSync(path.dirname(dest), { recursive: true });
    writeFileSync(dest, substitute(readFileSync(abs, "utf8"), childRel));
    if (/\.(sh|mjs)$/.test(dest) && /init\.mjs$|\.sh$/.test(dest)) chmodSync(dest, 0o755);
    written.push(path.relative(targetRoot, dest));
  }
}

if (!exists(treeRoot)) { console.error(`error: template tree not found at ${treeRoot}`); process.exit(1); }
mkdirSync(targetRoot, { recursive: true });
walk(treeRoot);

if (LAYOUT === "contained") {
  const manifestPath = path.join(harnessRoot, "agents.manifest.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const harnessOwned = /^(AGENTS\.md|agents\.manifest\.json|feature_list(?:\.digest)?\.md|feature_list\.json|progress\.md|DECISIONS\.md|session-handoff\.md|requirement.*|docs\/|loop\/|memory\/|trace\/|prompts\/|skills\/|tools\/)/;
  const prefix = (value) => value.startsWith("harness/") ? value : `harness/${value}`;
  for (const agent of manifest.agents || []) {
    agent.prompt = prefix(agent.prompt);
    agent.resources = (agent.resources || []).map(prefix);
    // `null` means unrestricted BY DESIGN (maker, test-implementer) and must survive the rewrite.
    // Collapsing it to `[]` looks harmless and is not: `[]` is truthy, so gen-agents.mjs emits the
    // PreToolUse guard for a role that has no restriction, and guard-write.mjs then denies every
    // write with "not in its list ()". Contained scaffolds only — which is why the flat-layout
    // demo never saw it (HI-062).
    agent.writes = agent.writes ? agent.writes.map((entry) => harnessOwned.test(entry) ? prefix(entry) : entry) : null;
  }
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
}

// Runtime discovery requires one root instruction file. Keep it a tiny adapter; the complete,
// versioned rules live with the rest of the harness instead of being duplicated here.
if (LAYOUT === "contained") {
  const rootAgent = path.join(targetRoot, AGENT_FILE);
  const adapter = `# ${NAME} — agent entry\n\nThe project harness lives under \`harness/\`. Before acting, read \`harness/AGENTS.md\` completely and follow it.\n\nStart with \`node harness/tools/loop-status.mjs\` and \`node harness/loop/route.mjs\`. The router, not the current agent, selects the next role.\n`;
  if (!exists(rootAgent) || FORCE) { writeFileSync(rootAgent, adapter); written.push(AGENT_FILE); }
  else skipped.push(AGENT_FILE);
}

// The onboarder is intentionally installed before the target has docs/constraints.md, so its
// minimal entry cannot reference that file yet. Once setup creates the rulebook, complete the
// handoff: a writing agent must load the rules it can now violate. Preserve every other field and
// resource because the onboarder is target-owned rather than part of agents.manifest.json.
const onboarderPath = path.join(targetRoot, ".kiro", "agents", "harness-onboarder.json");
const constraintsUri = LAYOUT === "contained" ? "file://../../harness/docs/constraints.md" : "file://../../docs/constraints.md";
if (exists(onboarderPath) && exists(path.join(harnessRoot, "docs", "constraints.md"))) {
  try {
    const onboarder = JSON.parse(readFileSync(onboarderPath, "utf8"));
    onboarder.resources = Array.isArray(onboarder.resources) ? onboarder.resources : [];
    if (!onboarder.resources.includes(constraintsUri)) {
      onboarder.resources.push(constraintsUri);
      writeFileSync(onboarderPath, JSON.stringify(onboarder, null, 2) + "\n");
      written.push(".kiro/agents/harness-onboarder.json (completed constraints handoff)");
    }
  } catch (error) {
    console.error(`error: cannot complete onboarder constraints handoff: ${error.message}`);
    process.exit(1);
  }
}

// Copy the coverage checker into the target root so the loop/setup agent can run it locally.
const checkerDest = path.join(harnessRoot, "check-coverage.mjs");
if (!exists(checkerDest) || FORCE) {
  writeFileSync(checkerDest, readFileSync(path.join(scriptDir, "check-coverage.mjs"), "utf8"));
  written.push(path.relative(targetRoot, checkerDest));
} else skipped.push(path.relative(targetRoot, checkerDest));

// Knowledge the agents' prompts cite, and tools they invoke, must live IN the target — a prompt
// pointing at harness-loop/references/... resolves to nothing in a scaffolded repo (the Fresh
// Session Test, Lesson 3, applied to this skill's own output). Copied, not referenced.
const EXTRA_COPIES = [
  ["scripts/verify-harness.mjs", "tools/verify-harness.mjs"],
  ["scripts/memory-query.mjs", "tools/memory-query.mjs"],
  ["scripts/memory-consolidate.mjs", "tools/memory-consolidate.mjs"],
  ["scripts/memory-promote.mjs", "tools/memory-promote.mjs"],
  ["scripts/run-report.mjs", "tools/run-report.mjs"],
  ["scripts/trajectory.mjs", "tools/trajectory.mjs"],
  ["scripts/loop-status.mjs", "tools/loop-status.mjs"],
  ["scripts/timeline.mjs", "tools/timeline.mjs"],
  ["scripts/cross-cutting-audit.mjs", "tools/cross-cutting-audit.mjs"],
  ["scripts/feature-digest.mjs", "tools/feature-digest.mjs"],
  ["scripts/feature.mjs", "tools/feature.mjs"],
  ["scripts/context-budget.mjs", "tools/context-budget.mjs"],
  ["scripts/review-digest.mjs", "tools/review-digest.mjs"],
  ["scripts/work-split.mjs", "tools/work-split.mjs"],
  ["scripts/adoption-baseline.mjs", "tools/adoption-baseline.mjs"],
  ["scripts/gen-agents.mjs", "tools/gen-agents.mjs"],
  ["scripts/agent-context.mjs", "tools/agent-context.mjs"],
  ["scripts/context-plan.mjs", "tools/context-plan.mjs"],
  ["scripts/context-collection-eval.mjs", "tools/context-collection-eval.mjs"],
  ["scripts/telemetry.mjs", "tools/telemetry.mjs"],
  ["scripts/telemetry-calibrate.mjs", "tools/telemetry-calibrate.mjs"],
  ["scripts/guard-write.mjs", "tools/guard-write.mjs"],
  ["scripts/hook-calibrate.mjs", "tools/hook-calibrate.mjs"],
  ["scripts/codex-dispatch.mjs", "tools/codex-dispatch.mjs"],
  ["scripts/replay-parallel.mjs", "tools/replay-parallel.mjs"],
  ["scripts/collect-services.mjs", "tools/collect-services.mjs"],
  ["scripts/survey-project.mjs", "tools/survey-project.mjs"],
  ["scripts/services-check.mjs", "tools/services-check.mjs"],
  ["scripts/check-capability-eval.mjs", "tools/check-capability-eval.mjs"],
  ["scripts/harness-status.mjs", "tools/harness-status.mjs"],
  ["scripts/harness-cli.mjs", "cli.mjs"],
  ["scripts/environment.mjs", "tools/environment.mjs"],
  ["references/agent-memory.md", "docs/reference/agent-memory.md"],
  ["references/feature-decomposition.md", "docs/reference/feature-decomposition.md"],
  ["references/design-engineering.md", "docs/reference/design-engineering.md"],
  ["references/knowledge-layout.md", "docs/reference/knowledge-layout.md"],
  ["references/human-attention.md", "docs/reference/human-attention.md"],
  ["references/presenting-and-proposing.md", "docs/reference/presenting-and-proposing.md"],
  ["references/llm-failure-modes.md", "docs/reference/llm-failure-modes.md"],
  ["references/test-authoring.md", "docs/reference/test-authoring.md"],
  ["references/adopting-an-existing-project.md", "docs/reference/adopting-an-existing-project.md"],
  ["references/graph.md", "docs/reference/graph.md"],
  ["references/runtimes.md", "docs/reference/runtimes.md"],
  ["references/step-acceptance.md", "docs/reference/step-acceptance.md"],
  ["references/invariant-contract.md", "docs/reference/invariant-contract.md"],
  ["references/multi-service.md", "docs/reference/multi-service.md"],
  ["references/multi-service.md", "docs/reference/multi-service.md"],
  ["references/how-google-tests-software-research.md", "docs/reference/how-google-tests-software-research.md"],
  ["references/critique-technique-sources.md", "docs/reference/critique-technique-sources.md"],
];
// Whole directories copied verbatim. The test-design skill ships as a unit — SKILL.md is useless
// without the strategy matrix, property catalog and schemas it dispatches to.
const EXTRA_DIR_COPIES = [
  ["onboarding-skills/harness-upgrade", "skills/harness-upgrade"],
  ["templates/test-design", "skills/test-design"],
  ["templates/feature-planning", "skills/feature-planning"],
  ["templates/business-journey", "skills/business-journey"],
  ["templates/quality-strategy", "skills/quality-strategy"],
];
for (const [src, destRel] of EXTRA_COPIES) {
  const dest = path.join(harnessRoot, destRel);
  if (exists(dest) && !FORCE) { skipped.push(path.relative(targetRoot, dest)); continue; }
  mkdirSync(path.dirname(dest), { recursive: true });
  writeFileSync(dest, readFileSync(path.join(skillRoot, src), "utf8"));
  written.push(path.relative(targetRoot, dest));
}
for (const [srcDir, destDir] of EXTRA_DIR_COPIES) {
  const walkDir = (rel) => {
    for (const name of readdirSync(path.join(skillRoot, srcDir, rel), { withFileTypes: true })) {
      const childRel = path.join(rel, name.name);
      if (name.isDirectory()) { walkDir(childRel); continue; }
      const destRel = path.join(destDir, childRel);
      const dest = path.join(harnessRoot, destRel);
      if (exists(dest) && !FORCE) { skipped.push(path.relative(targetRoot, dest)); continue; }
      mkdirSync(path.dirname(dest), { recursive: true });
      writeFileSync(dest, readFileSync(path.join(skillRoot, srcDir, childRel), "utf8"));
      written.push(path.relative(targetRoot, dest));
    }
  };
  walkDir(".");
}

// --- vendor provenance -------------------------------------------------------------------------
// Setup itself vendors skills/test-design, so setup itself must record where it came from. A
// scaffold that ships code the project did not write, with no upstream and no ref, is the exact
// thing gateVendor flags — and having the scaffolder create that state on day one would teach
// everyone to ignore the finding.
{
  const vm = path.join(harnessRoot, "vendor.manifest.json");
  const skillRef = (() => {
    const r = spawnSync("git", ["-C", skillRoot, "rev-parse", "--short", "HEAD"], { encoding: "utf8" });
    return r.status === 0 ? r.stdout.trim() : null;
  })();
  const entries = EXTRA_DIR_COPIES
    .filter(([, dst]) => exists(path.join(harnessRoot, dst)))
    .map(([src, dst]) => ({
      path: dst,
      upstream: `harness-loop skill, ${src}`,
      ref: skillRef || "unknown — the skill was not a git checkout at setup time",
      vendoredAt: new Date().toISOString().slice(0, 10),
      // A commit in THIS repo, which may not exist yet. The drift check stays off until it is set —
      // silence is right here, because there is nothing yet to have drifted from.
      vendoredCommit: null,
      localModifications: [],
    }));
  if (entries.length) {
    let man = { vendored: [] };
    if (exists(vm)) { try { man = JSON.parse(readFileSync(vm, "utf8")); } catch { /* rewrite */ } }
    man.$comment = "Provenance for code this project did not write. Without `ref` you cannot re-sync " +
      "or diff against the source; without `localModifications` a re-sync silently reverts a fix made " +
      "here, or silently keeps a stale one. Set `vendoredCommit` to the commit that added the " +
      "directory to THIS repo — that is what the drift check diffs against.";
    man.vendored = man.vendored || [];
    for (const e of entries) if (!man.vendored.some((v) => v.path === e.path)) man.vendored.push(e);
    if (!exists(vm) || FORCE) {
      writeFileSync(vm, JSON.stringify(man, null, 2) + "\n");
      written.push("vendor.manifest.json");
    }
  }
}

// --- .gitignore ------------------------------------------------------------------------------
// Three categories, and conflating them breaks the harness:
//
//   EPHEMERAL   run output. Always ignored — it is regenerated every run and only creates diff noise.
//   STATE       feature_list.json, progress.md, DECISIONS.md, session-handoff.md, memory/**, the
//               docs. NEVER ignored. This is the externalised memory the whole design rests on, and
//               gates read it out of git: `feature-field-lost` compares against
//               `git show HEAD:feature_list.json`, so ignoring it turns a blocker into a no-op.
//   MACHINERY   tools/, prompts/, the generated agent dirs, docs/reference/. Ignored only with
//               --gitignore-harness, because a clone that ignores them cannot run the loop until
//               the harness is re-installed.
{
  const gi = path.join(targetRoot, ".gitignore");
  const existing = exists(gi) ? readFileSync(gi, "utf8") : "";
  // Older scaffolds ignored the directory itself, which prevents a later negation from rescuing
  // durable state beneath it. Narrow that legacy rule before adding the exception.
  const normalized = existing.replace(/^trace\/\s*$/m, "trace/*");
  const want = [
    ["# --- harness: run output. Regenerated every run; committing it is pure diff noise.", null],
    [LAYOUT === "contained" ? "harness/trace/*" : "trace/*", "ephemeral"],
    [LAYOUT === "contained" ? "!harness/trace/adoption-baseline.json" : "!trace/adoption-baseline.json", "state"],
    [LAYOUT === "contained" ? "harness/loop/current.json" : "loop/current.json", "ephemeral"],
    [LAYOUT === "contained" ? "harness/loop/route-log.jsonl" : "loop/route-log.jsonl", "ephemeral"],
    [LAYOUT === "contained" ? "harness/env/local.json" : "env/local.json", "local-environment"],
    [LAYOUT === "contained" ? "harness/env/secrets.env" : "env/secrets.env", "secret"],
  ];
  if (IGNORE_MACHINERY) {
    want.push(
      ["", null],
      ["# --- harness: machinery (--gitignore-harness). Re-install before running the loop here.", null],
      ["tools/", "machinery"], ["prompts/", "machinery"], [".kiro/", "machinery"],
      [".claude/", "machinery"], [".codex/", "machinery"], ["docs/reference/", "machinery"],
      ["check-coverage.mjs", "machinery"], ["loop/*.mjs", "machinery"], ["loop/*.sh", "machinery"],
      ["!loop/goal.md", "machinery"],
    );
  }
  const lines = normalized.split("\n");
  const missing = want.filter(([l]) => l === "" || !lines.some((x) => x.trim() === l.trim()));
  if ((missing.length || normalized !== existing) && (!exists(gi) || FORCE || true)) {
    const add = missing.map(([l]) => l).join("\n");
    writeFileSync(gi, (normalized ? normalized.replace(/\n*$/, missing.length ? "\n\n" : "\n") : "") + add + "\n");
    written.push(".gitignore" + (IGNORE_MACHINERY ? " (+ machinery)" : ""));
  }
}

// --- Kubernetes layer ---------------------------------------------------------------------------
// Copying templates/k8s also ENABLES the agent: k8s-integration-tester is `optional` in the
// manifest, and gen-agents includes an optional agent exactly when its prompt file exists. So one
// decision here drives the tooling, the prompt, the memory dir and the generated agent together.
function hasChart(dir, depth = 3) {
  for (const name of readdirSync(dir, { withFileTypes: true })) {
    if (["node_modules", ".git", "target", "build", "dist"].includes(name.name)) continue;
    if (!name.isDirectory()) { if (/^Chart\.ya?ml$/.test(name.name)) return true; continue; }
    if (depth > 0 && hasChart(path.join(dir, name.name), depth - 1)) return true;
  }
  return false;
}
let k8sOn = K8S === "on";
if (K8S === "auto") {
  try { k8sOn = hasChart(targetRoot); } catch { k8sOn = false; }
}
// An integration target exists to run several services together; that is a cluster job by
// definition, so `auto` there means on regardless of whether a chart happens to sit in this
// directory (the charts live in the service repos, not here).
if (INTEGRATION && K8S !== "off") k8sOn = true;
if (k8sOn) {
  const k8sRoot = path.join(skillRoot, "templates", "k8s");
  const walkK8s = (rel) => {
    for (const e of readdirSync(path.join(k8sRoot, rel), { withFileTypes: true })) {
      const childRel = path.join(rel, e.name);
      if (e.isDirectory()) { walkK8s(childRel); continue; }
      const dest = path.join(harnessRoot, childRel);
      if (exists(dest) && !FORCE) { skipped.push(childRel); continue; }
      mkdirSync(path.dirname(dest), { recursive: true });
      // K8s files are templates too. Keeping this copy path outside substitute() leaked
      // {{PROJECT_NAME}} into every fresh K8s prompt and memory file (HI-063).
      writeFileSync(dest, substitute(readFileSync(path.join(k8sRoot, childRel), "utf8"), childRel));
      if (/\.(sh|mjs)$/.test(dest) && /init\.mjs$|\.sh$/.test(dest)) chmodSync(dest, 0o755);
      written.push(childRel);
    }
  };
  walkK8s(".");
}

// --- integration target: seed design and scope from the registry --------------------------------
// Collection is only worth doing if something downstream reads it. Here the registry becomes two
// things an agent actually uses: a design document it can read, and a feature whose verification
// is a real command that stays red while the registry has holes.
if (INTEGRATION) {
  const src = path.resolve(INTEGRATION);
  if (!exists(src)) {
    console.error(`error: --integration manifest not found: ${src}`);
    process.exit(2);
  }
  let reg;
  try { reg = JSON.parse(readFileSync(src, "utf8")); }
  catch (e) { console.error(`error: --integration manifest is not valid JSON — ${e.message}`); process.exit(2); }
  const svcs = Array.isArray(reg.services) ? reg.services : [];
  const dst = path.join(targetRoot, "services.manifest.json");
  if (!exists(dst) || FORCE) {
    writeFileSync(dst, JSON.stringify(reg, null, 2) + "\n");
    written.push("services.manifest.json");
  } else skipped.push("services.manifest.json");

  // The design surface. Generated, so it cannot drift from the registry — and it states what is
  // unanswered as prominently as what is known, because the unanswered fields are the ones that
  // make a cross-service test lie.
  const cell = (v) => (v === null || v === undefined || v === "" ? "**needs-human**" : `\`${String(v)}\``);
  const healthOf = (x) => (typeof x.health === "string" ? x.health : (x.health && x.health.command) || null);
  const deployable = svcs.filter((x) => x.kind === "service");
  const lines = [
    "# Services in scope",
    "",
    "**Generated from `services.manifest.json` by `setup-harness-loop.mjs --integration`. Do not",
    "hand-edit — edit the registry and re-run, or the two disagree and the agents read this one.**",
    "",
    `${deployable.length} deployable service(s) of ${svcs.length} registry entr(ies).`,
    "",
    "| Service | Kind | Chart | Image | Health | dependsOn |",
    "|---|---|---|---|---|---|",
    // A library is never deployed, so chart/image/health are not gaps in it — marking them
    // needs-human would manufacture work and bury the rows that are real.
    ...svcs.map((x) => x.kind !== "service"
      ? `| \`${x.id}\` | ${x.kind} | — | — | — | — |`
      : `| \`${x.id}\` | ${x.kind} | ${cell(x.chart)} | ${x.image ? "`yes`" : "**needs-human**"} | ${cell(healthOf(x))} | ${x.dependsOn === null || x.dependsOn === undefined ? "**needs-human**" : (x.dependsOn.length ? x.dependsOn.map((d) => `\`${d}\``).join(", ") : "`none`")} |`),
    "",
    ...(svcs.some((x) => x.ownRules) ? [
      "## Each service has its own rules — read them before you touch it",
      "",
      "You are loaded with THIS repo's `AGENTS.md`, not theirs. A service that carries its own is",
      "listed below by path. Read it before changing anything in that repo; do not copy it here,",
      "because a second copy of another repo's conventions goes stale and then misleads.",
      "",
      ...svcs.filter((x) => x.ownRules).map((x) => `- \`${x.id}\` → ${x.ownRules.map((r) => `\`${r}\``).join(", ")}`),
      "",
    ] : []),
    "## What **needs-human** means here",
    "",
    "These are the fields `collect-services.mjs` refuses to guess. A fabricated health check is worse",
    "than an empty one: the environment then reports ready and the test fails somewhere less obvious.",
    "",
    "- **health** — a command proving the service *serves*. `helm --wait` only proves the pod is Running.",
    "- **dependsOn** — install order. `[]` is an answer; `null` is a blank.",
    "- **image** — an absent Dockerfile is prerequisite engineering work, not a field to fill in.",
    "",
    "`node tools/services-check.mjs` exits non-zero while any of them is open.",
    "",
    "## Scope of this target",
    "",
    "Cross-service scenarios only. Anything provable inside one service belongs to that service's own",
    "harness — see `docs/reference/multi-service.md` for why the alternatives were rejected.",
    "",
  ];
  const sd = path.join(targetRoot, "docs", "services.md");
  if (!exists(sd) || FORCE) {
    mkdirSync(path.dirname(sd), { recursive: true });
    writeFileSync(sd, lines.join("\n"));
    written.push("docs/services.md");
  } else skipped.push("docs/services.md");

  // And the scope entry, so the loop cannot proceed past an incomplete registry by talking about it.
  const flPath = path.join(targetRoot, "feature_list.json");
  const fl = exists(flPath) ? JSON.parse(readFileSync(flPath, "utf8")) : null;
  if (fl && Array.isArray(fl.features) && !fl.features.some((f) => f.id === "feat-registry")) {
    fl.features.splice(1, 0, {
      id: "feat-registry",
      name: "Service registry is complete enough to stand the system up",
      kind: "prove",
      behavior: "Every deployable service in services.manifest.json has a chart, an image, a health command that proves it serves, and an explicit dependsOn",
      verification: "node tools/services-check.mjs",
      falsifier: "a registry where a service's health is null — the environment then reports ready on 'pod is Running' and a green cross-service test proves nothing",
      dependencies: ["feat-001"],
      status: "not-started",
      readyForCheck: false,
      evidence: "",
      checkerNotes: "Answers go in services.manifest.json, not here. Do not invent a health command to clear this gate; if the chart does not say, record that instead.",
      attempts: 0,
      maxAttempts: 3,
    });
    writeFileSync(flPath, JSON.stringify(fl, null, 2) + "\n");
    written.push("feature_list.json (+ feat-registry)");
  }
  const envPath = path.join(targetRoot, "business-environment.json");
  if (!exists(envPath) || FORCE) {
    writeFileSync(envPath, JSON.stringify({ schema: "business-environment/1",
      isolation: { mode: "namespace-per-run", runIdEnv: "HARNESS_RUN_ID",
        derivedResources: ["sit-${HARNESS_RUN_ID}", "account-${HARNESS_RUN_ID}", "consumer-${HARNESS_RUN_ID}"] },
      readiness: { serviceRegistry: "services.manifest.json",
        businessConditions: ["NEEDS HUMAN: reference data/session state/consumer readiness"] },
      seed: { command: "NEEDS HUMAN: public fixture/setup API command", publicBoundary: false },
      cleanup: { command: "tools/k8s-test-env.sh trap-owned namespace teardown", idempotent: true },
      telemetry: { metrics: ["deploymentDuration", "readinessDuration", "scenarioDuration",
        "eventWaitDuration", "retryCount", "diagnosticsCollected"], payloads: "redacted" } }, null, 2) + "\n");
    written.push("business-environment.json");
  }
  mkdirSync(path.join(targetRoot, "business-oracles"), { recursive: true });
  const fl2 = exists(flPath) ? JSON.parse(readFileSync(flPath, "utf8")) : null;
  if (fl2 && Array.isArray(fl2.features) && !fl2.features.some((f) => f.id === "feat-business-journey-contract")) {
    fl2.features.splice(2, 0, { id: "feat-business-journey-contract",
      name: "Business journey environment and distributed oracle are executable",
      kind: "prove",
      behavior: "A cross-service business journey uses per-run isolation, public setup/input/observation seams, bounded convergence invariants, idempotent cleanup and redacted telemetry",
      verification: "node skills/business-journey/scripts/check-business-journey.mjs --environment business-environment.json --oracles business-oracles && node skills/quality-strategy/scripts/check-quality-strategy.mjs --risk test-risk.json --oracles business-oracles",
      falsifier: "a journey that passes by querying a database, sleeps for convergence, reuses a fixed consumer group, or restarts a service without proving idempotent recovery",
      dependencies: ["feat-registry"], status: "not-started", readyForCheck: false, evidence: "",
      checkerNotes: "Start with one public happy-path tracer bullet; Cucumber is optional and belongs above the business driver, never around kubectl/SQL.", attempts: 0, maxAttempts: 3,
      context: { touches: ["business-environment.json", "business-oracles"], note: "Use skills/business-journey/SKILL.md; public boundaries pass the test, internal state is diagnostics only." } });
    writeFileSync(flPath, JSON.stringify(fl2, null, 2) + "\n");
    written.push("feature_list.json (+ feat-business-journey-contract)");
  }
}

// --- MCP, for BOTH runtimes from one source -------------------------------------------------------
// kiro reads .kiro/settings/mcp.json; Claude Code reads .mcp.json at the project root (verified by
// running `claude mcp add --scope project`). Same {mcpServers:{...}} shape, Claude adding a `type`.
// Generating only kiro's was a real hole: agents were generated for both runtimes and half of them
// had no connectors at all.
{
  const servers = {};
  if (k8sOn) {
    // Read-only by construction: the agent can diagnose a failed deploy and cannot change a cluster.
    servers["k8s-readonly"] = {
      command: "./tools/mcp-k8s-readonly-wrapper.sh",
      args: ["--read-only", "--disable-destructive"],
      env: {},
    };
  }
  const kiroPath = path.join(targetRoot, ".kiro", "settings", "mcp.json");
  const claudePath = path.join(targetRoot, ".mcp.json");
  const codexPath = path.join(targetRoot, ".codex", "config.toml");
  const note = "Generated by setup-harness-loop.mjs. Both runtimes read the same server set — " +
    "kiro from here, Claude Code from .mcp.json at the repo root. Add servers to BOTH or the two " +
    "runtimes see different worlds; re-running setup regenerates them together.";
  if (RUNTIME === "all" || RUNTIME === "both" || RUNTIME === "kiro" || RUNTIME.split(",").map((x) => x.trim()).includes("kiro")) {
    if (!exists(kiroPath) || FORCE) {
      mkdirSync(path.dirname(kiroPath), { recursive: true });
      writeFileSync(kiroPath, JSON.stringify({ $comment: note, mcpServers: servers }, null, 2) + "\n");
      written.push(".kiro/settings/mcp.json");
    }
  }
  const wantsRuntime = (r) => RUNTIME === "all" || RUNTIME === r
    || (RUNTIME === "both" && r !== "codex")
    || RUNTIME.split(",").map((x) => x.trim()).includes(r);
  if (wantsRuntime("claude")) {
    if (!exists(claudePath) || FORCE) {
      const cc = {};
      for (const [k, v] of Object.entries(servers)) cc[k] = { type: "stdio", ...v };
      writeFileSync(claudePath, JSON.stringify({ mcpServers: cc }, null, 2) + "\n");
      written.push(".mcp.json");
    }
  }
  // Codex reads TOML, and its project config lives at .codex/config.toml. Same server set as the
  // other two — a connector one runtime has and another lacks means the same role reaches different
  // conclusions depending on who launched it (gate mcp-runtime-skew).
  if (wantsRuntime("codex")) {
    if (!exists(codexPath) || FORCE) {
      const toml = [
        `# ${note}`,
        "",
        ...Object.entries(servers).flatMap(([k, v]) => [
          `[mcp_servers.${k}]`,
          `command = ${JSON.stringify(v.command)}`,
          `args = ${JSON.stringify(v.args || [])}`,
          "",
        ]),
      ].join("\n");
      mkdirSync(path.dirname(codexPath), { recursive: true });
      writeFileSync(codexPath, toml.endsWith("\n") ? toml : toml + "\n");
      written.push(".codex/config.toml");
    }
  }
}

// Agent configs are generated, not templated: agents.manifest.json is the source and both runtimes
// are emitted from it. Hand-maintaining two formats guarantees drift, and a drifted agent config
// does not error — it silently runs as a different agent (HI-005).
{
  const gen = spawnSync(process.execPath,
    [path.join(harnessRoot, "tools", "gen-agents.mjs"), "--target", targetRoot,
      "--manifest", path.relative(targetRoot, path.join(harnessRoot, "agents.manifest.json")),
      "--receipt", path.relative(targetRoot, path.join(harnessRoot, "agents.generated.json")),
      "--tool-root", path.relative(targetRoot, path.join(harnessRoot, "tools")), "--runtime", RUNTIME],
    { encoding: "utf8" });
  if (gen.status === 0) {
    for (const line of (gen.stdout || "").split("\n")) {
      const m = line.match(/^\s+\+ (.+)$/); if (m) written.push(m[1]);
    }
  } else console.error(`  ! could not generate agent configs: ${(gen.stderr || "").trim().slice(0, 300)}`);
}

// The graph ships describing exactly these agents, but generation writes them after the copy, so
// their mtimes would make a brand-new scaffold report graph-stale on its first verify. Restamp it.
{ const g = path.join(harnessRoot, "docs", "reference", "graph.md");
  if (exists(g)) { const now = new Date(); try { utimesSync(g, now, now); } catch {} } }

// Generated, not templated: six agents load feature_list.digest.md as a resource — it is what
// keeps the full feature list out of every agent's context budget. Shipping those agents without
// generating it means each one starts missing a file kiro will not complain about
// (references/llm-failure-modes.md, and the agent-uri-broken gate that caught this).
const digestPath = path.join(harnessRoot, "feature_list.digest.md");
if (!exists(digestPath) || FORCE) {
  const gen = spawnSync(process.execPath,
    [path.join(harnessRoot, "tools", "feature-digest.mjs"), "--target", harnessRoot],
    { encoding: "utf8" });
  if (gen.status === 0 && exists(digestPath)) written.push("feature_list.digest.md");
  else console.error(`  ! could not generate feature_list.digest.md — run: node tools/feature-digest.mjs --target ${targetRoot}`);
} else skipped.push("feature_list.digest.md");

// Git cannot diff files that intentionally remain uncommitted. Record an installation receipt so
// one cheap command can still distinguish modified, missing and newly introduced harness files.
if (LAYOUT === "contained") {
  const installationPath = path.join(harnessRoot, "installation.json");
  if (exists(installationPath) && !FORCE) {
    skipped.push("harness/installation.json");
  } else {
  const files = {};
  const scan = (dir, rel = "") => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const child = rel ? path.join(rel, entry.name) : entry.name;
      if (child === "installation.json" || child.startsWith(`trace${path.sep}`) ||
          [path.join("env", "local.json"), path.join("env", "secrets.env")].includes(child) ||
          [path.join("loop", "current.json"), path.join("loop", "route-log.jsonl")].includes(child)) continue;
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) scan(abs, child);
      else files[child.split(path.sep).join("/")] = {
        sha256: createHash("sha256").update(readFileSync(abs)).digest("hex"),
        ownership: /^(prompts|docs|AGENTS\.md|agents\.manifest\.json|init\.mjs)/.test(child)
          ? "project-customizable" : "harness-owned",
      };
    }
  };
  scan(harnessRoot);
  writeFileSync(installationPath, JSON.stringify({
    schema: "harness-installation/1", installedAt: new Date().toISOString(), layout: "contained", files,
  }, null, 2) + "\n");
  written.push("harness/installation.json");
  }
}

// --- report ---------------------------------------------------------------------------------
console.log(`\nHarness loop scaffolded into: ${harnessRoot}`);
console.log(`  agent file: ${AGENT_FILE}   package manager: ${PM || "n/a (edit init.sh)"}\n`);
console.log(`  Written (${written.length}):`);
for (const f of written) console.log(`    + ${f}`);
if (skipped.length) {
  console.log(`\n  Skipped (${skipped.length}, already exist — re-run with --force to overwrite):`);
  for (const f of skipped) console.log(`    · ${f}`);
}
console.log(`\nNext steps — you do not have to memorise the order:`);
console.log(`  0. cd ${TARGET}`);
console.log(`  1. Fill the placeholders under ${LAYOUT === "contained" ? "harness/" : "the project root"}.`);
console.log(`     verify-harness reports every placeholder left behind as a blocker, so nothing is`);
console.log(`     silently skipped.`);
const hp = LAYOUT === "contained" ? "harness/" : "";
console.log(`  2. node ${hp}init.mjs                     # baseline green before any loop`);
console.log(`  3. node ${hp}check-coverage.mjs --target ${hp || "."}       # 13/13 lessons`);
console.log(`  4. node ${hp}tools/verify-harness.mjs --target ${hp || "."} --run-features`);
console.log(`  5. node ${hp}loop/route.mjs               # asks which agent runs next`);
console.log(`  6. node ${hp}loop/run-loop.mjs 1          # one supervised iteration`);
console.log(``);
console.log(`The router picks the node; you do not. It walks deeper-first — a fact only a human has`);
console.log(`(human-interview skill, without switching agents), then design, decomposition, the oracle, and code.`);
console.log(`Run it whenever you are unsure what to do next.`);
console.log(``);
console.log(`Runtimes: agents were generated for ${RUNTIME === "both" ? "kiro-cli AND Claude Code" : RUNTIME}.`);
console.log(`Set HARNESS_RUNTIME=kiro|claude|codex to force one; run-loop.mjs otherwise detects it.`);
console.log(`Regenerate agents through setup/upgrade; ${hp}agents.manifest.json is canonical.`);
console.log(``);
console.log(`Adopting a repo with history instead of starting fresh? Do NOT use this script directly —`);
console.log(`run scripts/install-onboarder.mjs against it, and read`);
console.log(`docs/reference/adopting-an-existing-project.md first. Existing code trips every gate at`);
console.log(`once, and the adoption baseline is what stops that being a wall you learn to ignore.`);
console.log("");
