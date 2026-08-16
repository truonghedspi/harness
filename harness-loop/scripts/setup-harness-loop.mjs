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
import path from "node:path";
import { fileURLToPath } from "node:url";

const args = process.argv.slice(2);
const opt = (name, def = null) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : def; };
const flag = (name) => args.includes(name);

const TARGET = opt("--target");
if (!TARGET) { console.error("error: --target /path/to/project is required"); process.exit(2); }
const targetRoot = path.resolve(TARGET);
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
  if (relPath === "AGENTS.md" && AGENT_FILE !== "AGENTS.md") return path.join(targetRoot, AGENT_FILE);
  return path.join(targetRoot, relPath);
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

// Copy the coverage checker into the target root so the loop/setup agent can run it locally.
const checkerDest = path.join(targetRoot, "check-coverage.mjs");
if (!exists(checkerDest) || FORCE) {
  writeFileSync(checkerDest, readFileSync(path.join(scriptDir, "check-coverage.mjs"), "utf8"));
  written.push("check-coverage.mjs");
} else skipped.push("check-coverage.mjs");

// Knowledge the agents' prompts cite, and tools they invoke, must live IN the target — a prompt
// pointing at harness-loop/references/... resolves to nothing in a scaffolded repo (the Fresh
// Session Test, Lesson 3, applied to this skill's own output). Copied, not referenced.
const EXTRA_COPIES = [
  ["scripts/verify-harness.mjs", "tools/verify-harness.mjs"],
  ["scripts/memory-query.mjs", "tools/memory-query.mjs"],
  ["scripts/memory-consolidate.mjs", "tools/memory-consolidate.mjs"],
  ["scripts/run-report.mjs", "tools/run-report.mjs"],
  ["scripts/loop-status.mjs", "tools/loop-status.mjs"],
  ["scripts/timeline.mjs", "tools/timeline.mjs"],
  ["scripts/cross-cutting-audit.mjs", "tools/cross-cutting-audit.mjs"],
  ["scripts/feature-digest.mjs", "tools/feature-digest.mjs"],
  ["scripts/feature.mjs", "tools/feature.mjs"],
  ["scripts/context-budget.mjs", "tools/context-budget.mjs"],
  ["scripts/review-digest.mjs", "tools/review-digest.mjs"],
  ["scripts/adoption-baseline.mjs", "tools/adoption-baseline.mjs"],
  ["scripts/gen-agents.mjs", "tools/gen-agents.mjs"],
  ["scripts/agent-context.mjs", "tools/agent-context.mjs"],
  ["scripts/context-plan.mjs", "tools/context-plan.mjs"],
  ["scripts/context-collection-eval.mjs", "tools/context-collection-eval.mjs"],
  ["scripts/telemetry.mjs", "tools/telemetry.mjs"],
  ["scripts/telemetry-calibrate.mjs", "tools/telemetry-calibrate.mjs"],
  ["scripts/guard-write.mjs", "tools/guard-write.mjs"],
  ["scripts/codex-dispatch.mjs", "tools/codex-dispatch.mjs"],
  ["scripts/replay-parallel.mjs", "tools/replay-parallel.mjs"],
  ["scripts/collect-services.mjs", "tools/collect-services.mjs"],
  ["scripts/survey-project.mjs", "tools/survey-project.mjs"],
  ["scripts/services-check.mjs", "tools/services-check.mjs"],
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
];
// Whole directories copied verbatim. The test-design skill ships as a unit — SKILL.md is useless
// without the strategy matrix, property catalog and schemas it dispatches to.
const EXTRA_DIR_COPIES = [
  ["templates/test-design", "skills/test-design"],
  ["templates/feature-planning", "skills/feature-planning"],
  ["templates/business-journey", "skills/business-journey"],
  ["templates/quality-strategy", "skills/quality-strategy"],
];
for (const [src, destRel] of EXTRA_COPIES) {
  const dest = path.join(targetRoot, destRel);
  if (exists(dest) && !FORCE) { skipped.push(destRel); continue; }
  mkdirSync(path.dirname(dest), { recursive: true });
  writeFileSync(dest, readFileSync(path.join(skillRoot, src), "utf8"));
  written.push(destRel);
}
for (const [srcDir, destDir] of EXTRA_DIR_COPIES) {
  const walkDir = (rel) => {
    for (const name of readdirSync(path.join(skillRoot, srcDir, rel), { withFileTypes: true })) {
      const childRel = path.join(rel, name.name);
      if (name.isDirectory()) { walkDir(childRel); continue; }
      const destRel = path.join(destDir, childRel);
      const dest = path.join(targetRoot, destRel);
      if (exists(dest) && !FORCE) { skipped.push(destRel); continue; }
      mkdirSync(path.dirname(dest), { recursive: true });
      writeFileSync(dest, readFileSync(path.join(skillRoot, srcDir, childRel), "utf8"));
      written.push(destRel);
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
  const vm = path.join(targetRoot, "vendor.manifest.json");
  const skillRef = (() => {
    const r = spawnSync("git", ["-C", skillRoot, "rev-parse", "--short", "HEAD"], { encoding: "utf8" });
    return r.status === 0 ? r.stdout.trim() : null;
  })();
  const entries = EXTRA_DIR_COPIES
    .filter(([, dst]) => exists(path.join(targetRoot, dst)))
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
  const want = [
    ["# --- harness: run output. Regenerated every run; committing it is pure diff noise.", null],
    ["trace/", "ephemeral"],
    ["loop/current.json", "ephemeral"],
    ["loop/route-log.jsonl", "ephemeral"],
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
  const lines = existing.split("\n");
  const missing = want.filter(([l]) => l === "" || !lines.some((x) => x.trim() === l.trim()));
  if (missing.length && (!exists(gi) || FORCE || true)) {
    const add = missing.map(([l]) => l).join("\n");
    writeFileSync(gi, (existing ? existing.replace(/\n*$/, "\n\n") : "") + add + "\n");
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
      const dest = path.join(targetRoot, childRel);
      if (exists(dest) && !FORCE) { skipped.push(childRel); continue; }
      mkdirSync(path.dirname(dest), { recursive: true });
      writeFileSync(dest, readFileSync(path.join(k8sRoot, childRel), "utf8"));
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
    [path.join(targetRoot, "tools", "gen-agents.mjs"), "--target", targetRoot, "--runtime", RUNTIME],
    { encoding: "utf8" });
  if (gen.status === 0) {
    for (const line of (gen.stdout || "").split("\n")) {
      const m = line.match(/^\s+\+ (.+)$/); if (m) written.push(m[1]);
    }
  } else console.error(`  ! could not generate agent configs: ${(gen.stderr || "").trim().slice(0, 300)}`);
}

// The graph ships describing exactly these agents, but generation writes them after the copy, so
// their mtimes would make a brand-new scaffold report graph-stale on its first verify. Restamp it.
{ const g = path.join(targetRoot, "docs", "reference", "graph.md");
  if (exists(g)) { const now = new Date(); try { utimesSync(g, now, now); } catch {} } }

// Generated, not templated: six agents load feature_list.digest.md as a resource — it is what
// keeps the full feature list out of every agent's context budget. Shipping those agents without
// generating it means each one starts missing a file kiro will not complain about
// (references/llm-failure-modes.md, and the agent-uri-broken gate that caught this).
const digestPath = path.join(targetRoot, "feature_list.digest.md");
if (!exists(digestPath) || FORCE) {
  const gen = spawnSync(process.execPath,
    [path.join(targetRoot, "tools", "feature-digest.mjs"), "--target", targetRoot],
    { encoding: "utf8" });
  if (gen.status === 0 && exists(digestPath)) written.push("feature_list.digest.md");
  else console.error(`  ! could not generate feature_list.digest.md — run: node tools/feature-digest.mjs --target ${targetRoot}`);
} else skipped.push("feature_list.digest.md");

// --- report ---------------------------------------------------------------------------------
console.log(`\nHarness loop scaffolded into: ${targetRoot}`);
console.log(`  agent file: ${AGENT_FILE}   package manager: ${PM || "n/a (edit init.sh)"}\n`);
console.log(`  Written (${written.length}):`);
for (const f of written) console.log(`    + ${f}`);
if (skipped.length) {
  console.log(`\n  Skipped (${skipped.length}, already exist — re-run with --force to overwrite):`);
  for (const f of skipped) console.log(`    · ${f}`);
}
console.log(`\nNext steps — you do not have to memorise the order:`);
console.log(`  0. cd ${TARGET}`);
console.log(`  1. Fill the placeholders. requirement*.md is yours to write; docs/architecture.md,`);
console.log(`     docs/constraints.md and docs/testing-standards.md must describe THIS project, and`);
console.log(`     loop/goal.md needs a real objective with a machine-checkable stopping condition.`);
console.log(`     verify-harness reports every placeholder left behind as a blocker, so nothing is`);
console.log(`     silently skipped.`);
console.log(`  2. ./init.sh                              # baseline green before any loop`);
console.log(`  3. node check-coverage.mjs                # 13/13 lessons`);
console.log(`  4. node tools/verify-harness.mjs --target . --run-features     # 0 blockers is the bar`);
console.log(`  5. node loop/route.mjs                    # asks the state which agent runs next, and why`);
console.log(`  6. loop/run-loop.sh 1                     # one supervised iteration, routed automatically`);
console.log(``);
console.log(`The router picks the node; you do not. It walks deeper-first — a fact only a human has`);
console.log(`(context-interviewer), then design, then decomposition, then the oracle, then the code.`);
console.log(`Run it whenever you are unsure what to do next.`);
console.log(``);
console.log(`Runtimes: agents were generated for ${RUNTIME === "both" ? "kiro-cli AND Claude Code" : RUNTIME}.`);
console.log(`Set HARNESS_RUNTIME=kiro|claude to force one; run-loop.sh otherwise detects it.`);
console.log(`Regenerate after editing agents.manifest.json: node tools/gen-agents.mjs --target .`);
console.log(``);
console.log(`Adopting a repo with history instead of starting fresh? Do NOT use this script directly —`);
console.log(`run scripts/install-onboarder.mjs against it, and read`);
console.log(`docs/reference/adopting-an-existing-project.md first. Existing code trips every gate at`);
console.log(`once, and the adoption baseline is what stops that being a wall you learn to ignore.`);
console.log("");
