#!/usr/bin/env node
// dispatch-brief.mjs — typed context handoff from the loop to a worker agent.
//
// The dispatch message is the only junction between orchestrator knowledge and worker action.
// Before this existed, run-loop.mjs passed one prose sentence (next.why) and every worker re-read
// feature_list.json, checked baseline state, grepped for checker notes, and searched for relevant
// files — roughly 11 file reads and searches before doing any real work (measured in the Aeron A/B
// for context packets, references/context-packets.md).
//
// This module builds a bounded, schema-validated JSON brief from what the loop already knows. The
// worker parses it, reads only the mustRead paths, and starts. Validation runs at both ends: here
// (the producer) and inside the worker (the consumer, via the prompt's step 0) — so a malformed
// brief cannot cross the boundary (DeepSeek Ralph's double-decode pattern).
//
// Usage:
//   import { buildBrief, validateBrief, briefToMessage } from "./dispatch-brief.mjs";
//   const brief = buildBrief(routerOutput, { root: ROOT });
//   validateBrief(brief);  // throws on schema violation
//   const message = briefToMessage(brief);
//   await dispatch(agent, message, { runtime });
//
// CLI (for debugging):
//   node tools/dispatch-brief.mjs                  # build brief for current router output
//   node tools/dispatch-brief.mjs --json           # JSON only
//   node tools/dispatch-brief.mjs --validate <file> # validate a brief file
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const SCHEMA_VERSION = "dispatch-brief/1";
const MAX_BRIEF_BYTES = 8 * 1024;
const MAX_CHECKER_NOTES_BYTES = 2 * 1024;
const MAX_DIAGNOSIS_BYTES = 1024;
const MAX_RECENT_CHANGES = 5;
const MAX_MUST_READ = 5;

// --- schema validation -----------------------------------------------------------------------

const REQUIRED_FIELDS = ["schema", "node", "why", "baseline"];
const VALID_NODES = ["maker", "checker", "design-facilitator", "feature-planner",
  "test-designer", "test-implementer", "k8s-integration-tester", "harness-setup", "harness-improver"];

export function validateBrief(brief) {
  const errors = [];
  if (!brief || typeof brief !== "object") { errors.push("brief is not an object"); return errors; }
  if (brief.schema !== SCHEMA_VERSION) errors.push(`schema: expected "${SCHEMA_VERSION}", got "${brief.schema}"`);
  for (const f of REQUIRED_FIELDS) {
    if (brief[f] === undefined || brief[f] === null) errors.push(`missing required field: ${f}`);
  }
  if (brief.node && !VALID_NODES.includes(brief.node)) errors.push(`unknown node: ${brief.node}`);
  if (brief.feature) {
    if (typeof brief.feature !== "object") errors.push("feature must be an object");
    else if (!brief.feature.id) errors.push("feature.id is required when feature is present");
  }
  // Status-dependent invariants (Ralph pattern)
  if (brief.feature?.checkerNotes) {
    const marker = String(brief.feature.checkerNotes).split("\n")[0].trim();
    if (/^NEEDS (DESIGN|RE-PLAN|ORACLE FIX):/.test(marker) && !brief.diagnosis) {
      // diagnosis is recommended but not required for first dispatch on a marker
    }
  }
  if (brief.baseline && typeof brief.baseline !== "object") errors.push("baseline must be an object");
  if (brief.mustRead && !Array.isArray(brief.mustRead)) errors.push("mustRead must be an array");
  if (brief.mustRead && brief.mustRead.length > MAX_MUST_READ) errors.push(`mustRead exceeds ${MAX_MUST_READ} entries`);
  if (brief.recentChanges && !Array.isArray(brief.recentChanges)) errors.push("recentChanges must be an array");
  if (errors.length) throw new Error(`dispatch-brief validation failed:\n  ${errors.join("\n  ")}`);
  return [];
}

// --- brief builder ---------------------------------------------------------------------------

function readJSON(p) { try { return JSON.parse(readFileSync(p, "utf8")); } catch { return null; } }
function readText(p) { try { return readFileSync(p, "utf8"); } catch { return ""; } }
function truncate(s, max) {
  if (!s || s.length <= max) return s || null;
  return s.slice(0, max - 4) + " ...";
}

function featureEntry(routerOutput, root) {
  const fl = readJSON(path.join(root, "feature_list.json"));
  if (!fl) return null;
  const features = fl.features || [];
  const id = routerOutput.feature;
  if (!id) return null;
  const f = features.find((x) => x.id === id);
  if (!f) return null;
  return {
    id: f.id,
    title: f.name || f.title || f.id,
    status: String(f.status || f.state || "not-started"),
    verification: f.verification || null,
    falsifier: f.falsifier || null,
    dependencies: f.dependencies || [],
    attempts: f.attempts || 0,
    maxAttempts: f.maxAttempts || 3,
    readyForCheck: f.readyForCheck || false,
    checkerNotes: truncate(String(f.checkerNotes || ""), MAX_CHECKER_NOTES_BYTES),
    kind: f.kind || null,
    evidence: Array.isArray(f.evidence) ? f.evidence.slice(-3) : [],
  };
}

function baselineState(root) {
  const b = readJSON(path.join(root, "loop", "baseline-state.json"));
  if (!b) return { status: "unknown", lastRun: null };
  return {
    status: b.status || "unknown",
    lastRun: b.checkedAt || b.reusedAt || null,
    evidenceDigest: b.evidenceDigest || null,
  };
}

function diagnosisFor(routerOutput, root) {
  if (!routerOutput.requestId && !routerOutput.feature) return null;
  const diagDir = path.join(root, "loop", "diagnosis");
  // Try requestId-based key first, then feature#attempts
  const keys = [];
  if (routerOutput.requestId) keys.push(routerOutput.requestId);
  if (routerOutput.feature) {
    const fl = readJSON(path.join(root, "feature_list.json"));
    const f = (fl?.features || []).find((x) => x.id === routerOutput.feature);
    if (f) keys.push(`${f.id}#${f.attempts || 0}`);
  }
  for (const key of keys) {
    const safe = key.replace(/[^A-Za-z0-9._-]/g, "-");
    const d = readJSON(path.join(diagDir, `${safe}.json`));
    if (d && d.schema === "diagnosis/1") {
      return truncate(JSON.stringify({
        key: d.key, cause: d.cause, layer: d.layer, provedBy: d.provedBy?.cmd,
        ruledOut: (d.ruledOut || []).map((r) => r.hypothesis).slice(0, 3),
      }), MAX_DIAGNOSIS_BYTES);
    }
  }
  return null;
}

function recentChanges(root) {
  const result = spawnSync("git", ["log", `--format=%h %s`, `-${MAX_RECENT_CHANGES}`, "--no-decorate"],
    { cwd: root, encoding: "utf8", timeout: 5000 });
  if (result.status !== 0) return [];
  return result.stdout.trim().split("\n").filter(Boolean);
}

function sessionContext(root) {
  const handoff = readText(path.join(root, "session-handoff.md")).trim();
  if (!handoff) return null;
  return truncate(handoff, 512);
}

function mustReadPaths(routerOutput, root) {
  const paths = [];
  const featureId = routerOutput.feature;
  if (!featureId) return paths;
  // Check for context packet mustRead
  const packetPath = path.join(root, "loop", "context-packets", `${featureId}.json`);
  const packet = readJSON(packetPath);
  if (packet && Array.isArray(packet.mustRead)) {
    for (const p of packet.mustRead.slice(0, MAX_MUST_READ)) {
      if (typeof p === "string" && existsSync(path.join(root, p))) paths.push(p);
      else if (p?.path && existsSync(path.join(root, p.path))) paths.push(p.path);
    }
  }
  // Check for diagnosis file
  if (routerOutput.mode === "diagnose") {
    const diagDir = "loop/diagnosis";
    if (routerOutput.requestId) {
      const safe = routerOutput.requestId.replace(/[^A-Za-z0-9._-]/g, "-");
      const diagPath = `${diagDir}/${safe}.json`;
      if (!paths.includes(diagPath)) paths.push(diagPath);
    }
  }
  return paths.slice(0, MAX_MUST_READ);
}

function verificationWarnings(routerOutput, root) {
  const warnings = [];
  const featureId = routerOutput.feature;
  if (!featureId) return warnings;
  const fl = readJSON(path.join(root, "feature_list.json"));
  if (!fl) return warnings;
  const f = (fl.features || []).find((x) => x.id === featureId);
  if (!f?.verification) return warnings;
  const cmd = String(f.verification);
  if (/verify-harness/.test(cmd) && /&&/.test(cmd)) {
    warnings.push(
      `verification command ghép verify-harness với lệnh khác qua &&. ` +
      `verify-harness kiểm tra trạng thái toàn repo (bao gồm chính feature này), ` +
      `có thể tạo phụ thuộc tuần hoàn. Cân nhắc tách thành lệnh chỉ kiểm tra behavior của feature.`
    );
  }
  return warnings;
}

export function buildBrief(routerOutput, { root = process.cwd() } = {}) {
  const brief = {
    schema: SCHEMA_VERSION,
    node: routerOutput.node,
    why: routerOutput.why,
    layer: routerOutput.layer || null,
    mode: routerOutput.mode || null,
    feature: featureEntry(routerOutput, root),
    baseline: baselineState(root),
    diagnosis: diagnosisFor(routerOutput, root),
    recentChanges: recentChanges(root),
    mustRead: mustReadPaths(routerOutput, root),
    sessionContext: sessionContext(root),
    warnings: verificationWarnings(routerOutput, root),
  };

  // Enforce byte budget — shed least-important fields first
  let json = JSON.stringify(brief);
  if (json.length > MAX_BRIEF_BYTES) {
    brief.sessionContext = null;
    json = JSON.stringify(brief);
  }
  if (json.length > MAX_BRIEF_BYTES) {
    brief.recentChanges = brief.recentChanges.slice(0, 2);
    json = JSON.stringify(brief);
  }
  if (json.length > MAX_BRIEF_BYTES && brief.feature) {
    brief.feature.evidence = brief.feature.evidence.slice(-1);
    json = JSON.stringify(brief);
  }
  if (!brief.warnings?.length) delete brief.warnings;

  return brief;
}

// --- message formatting ----------------------------------------------------------------------

const HEADLESS_PREAMBLE = "You are running HEADLESS under node loop/run-loop.mjs — no human can " +
  "answer questions, so commit directly instead of asking.";

export function briefToMessage(brief, { headless = true } = {}) {
  const lines = [];
  if (headless) lines.push(HEADLESS_PREAMBLE);
  lines.push("");
  lines.push("## Dispatch Brief");
  lines.push("```json");
  lines.push(JSON.stringify(brief, null, 2));
  lines.push("```");
  lines.push("");
  lines.push("Parse this brief before any other step. It contains the feature entry, baseline " +
    "state, checker notes, diagnosis, and recent changes — do not re-read feature_list.json for " +
    "these fields. Read only the paths in `mustRead`, then proceed with your instructions and " +
    "loop/goal.md. Honor every stop condition.");

  if (brief.mode === "diagnose") {
    lines.push("");
    lines.push("### Diagnosis schema");
    lines.push("Write `loop/diagnosis/<key>.json` where `<key>` is from the router path above. " +
      "The file MUST match schema `diagnosis/1` — the router rejects anything else. Required fields:");
    lines.push("```json");
    lines.push(JSON.stringify({
      schema: "diagnosis/1",
      key: "<featureId>#<attempts>",
      symptom: "<what was observed — the failure output, not your interpretation>",
      cause: "<the one explanation that survived>",
      layer: "<project | harness | host | external>",
      provedBy: { cmd: "<the spike command you ran>", exit: "<exit code>", result: "<output>" },
      ruledOut: [{ hypothesis: "<competing explanation>", killedBy: "<what disproved it>" }],
    }, null, 2));
    lines.push("```");
    lines.push("`ruledOut` must have at least one entry. See `loop/diagnosis/README.md` for details.");
  }

  if (brief.warnings?.length) {
    lines.push("");
    lines.push("### Warnings");
    for (const w of brief.warnings) lines.push(`- ${w}`);
  }

  return lines.join("\n");
}

// --- CLI -------------------------------------------------------------------------------------

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename)) {
  const argv = process.argv.slice(2);
  const JSON_OUT = argv.includes("--json");

  if (argv.includes("--validate")) {
    const file = argv[argv.indexOf("--validate") + 1];
    if (!file) { console.error("usage: node tools/dispatch-brief.mjs --validate <file>"); process.exit(2); }
    try {
      const brief = JSON.parse(readFileSync(file, "utf8"));
      validateBrief(brief);
      console.log("valid");
      process.exit(0);
    } catch (e) {
      console.error(e.message);
      process.exit(1);
    }
  }

  // Build a brief from the current router output
  const root = process.cwd();
  const result = spawnSync(process.execPath, [path.join(root, "loop", "route.mjs"), "--json"],
    { cwd: root, encoding: "utf8" });
  let routerOutput;
  try { routerOutput = JSON.parse(result.stdout); }
  catch { console.error("could not parse router output"); process.exit(1); }

  if (routerOutput.kind !== "agent") {
    console.error(`router says ${routerOutput.node} (${routerOutput.kind}) — no brief for non-agent nodes`);
    process.exit(0);
  }

  const brief = buildBrief(routerOutput, { root });
  try { validateBrief(brief); }
  catch (e) { console.error(e.message); process.exit(1); }

  if (JSON_OUT) {
    writeSync(1, JSON.stringify(brief, null, 2) + "\n");
  } else {
    console.log(briefToMessage(brief));
  }
  process.exit(0);
}
