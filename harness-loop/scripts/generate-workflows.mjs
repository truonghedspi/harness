#!/usr/bin/env node
// generate-workflows.mjs — generates workflow-*.md from workflow-model.json.
//
// Single source of truth: workflow-model.json declares nodes, edges, layers, and contracts.
// This script reads the model and generates a Mermaid diagram and contract table for each workflow.
// check-workflow-diagram.mjs verifies that output matches the model rather than grepping names.
//
// Usage:
//   node scripts/generate-workflows.mjs                    generates and overwrites workflow-*.md
//   node scripts/generate-workflows.mjs --check            compares; exits 1 if different
//   node scripts/generate-workflows.mjs --dry-run          prints to stdout without writing
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REFS = path.join(__dirname, "..", "references");
const MODEL_PATH = path.join(REFS, "workflow-model.json");

const args = process.argv.slice(2);
const CHECK = args.includes("--check");
const DRY = args.includes("--dry-run");

let model;
try { model = JSON.parse(readFileSync(MODEL_PATH, "utf8")); }
catch (e) { console.error(`cannot read ${MODEL_PATH}: ${e.message}`); process.exit(2); }

if (model.schema !== "workflow-model/1") {
  console.error(`unexpected schema: ${model.schema}`);
  process.exit(2);
}

const nodeMap = new Map(model.nodes.map((n) => [n.id, n]));
const edgeMap = new Map(model.edges.map((e) => [e.id, e]));
const layerMap = new Map(model.layers.map((l) => [l.id, l]));

// ── Mermaid rendering ──────────────────────────────────────────────────────────

// Mermaid node ID: letters, digits, and underscores only.
const mid = (id) => id.replace(/[^a-zA-Z0-9]/g, "_");

function mermaidLabel(node) {
  const n = nodeMap.get(node);
  return n ? n.label : node;
}

function renderDevelopmentMermaid() {
  const wf = model.workflows.development;
  const edges = wf.edges.map((id) => edgeMap.get(id)).filter(Boolean);

  const lines = ["flowchart LR"];

  // Group edges by (from, to) to combine labels.
  const grouped = new Map();
  for (const e of edges) {
    const key = `${e.from}→${e.to}`;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(e);
  }

  // Declare nodes.
  const usedNodes = new Set();
  for (const e of edges) { usedNodes.add(e.from); usedNodes.add(e.to); }

  for (const nid of usedNodes) {
    const n = nodeMap.get(nid);
    if (!n) continue;
    const shape = n.kind === "terminal" ? `(["${n.label}"])` :
                  n.kind === "human"    ? `["${n.label}"]` :
                  n.kind === "code"     ? `["${n.label}"]` :
                                          `["${n.label}"]`;
    lines.push(`    ${mid(nid)}${shape}`);
  }

  // Edges.
  for (const [, group] of grouped) {
    const from = group[0].from;
    const to = group[0].to;
    const labels = group.map((e) => {
      const parts = [];
      if (e.layer && e.layer !== "-") parts.push(`LAYER: ${e.layer}`);
      if (e.mode) parts.push(`mode: ${e.mode}`);
      if (e.trigger) parts.push(e.trigger.length > 60 ? e.trigger.slice(0, 57) + "..." : e.trigger);
      return parts.join("\\n");
    });
    // When multiple edges share (from, to), join their labels with a newline.
    const combinedLabel = labels.join("\\n---\\n");
    lines.push(`    ${mid(from)} -->|"${combinedLabel}"| ${mid(to)}`);
  }

  return lines.join("\n");
}

function renderOnboardingMermaid() {
  // Onboarding is not driven by route.mjs — keep the diagram simple.
  return `flowchart LR
    U["human requirement"] -->|"decision contract\\nintent + known constraints"| O["orchestrator\\nfront door"]
    O --> E{"existing harness?"}
    E -- no --> S["setup-harness-loop.mjs"]
    E -- yes --> UP["upgrade plan\\nownership + drift"]
    S --> HI["human-interview\\nLAYER: spec\\nanswer receipt"]
    UP --> HI
    HI -->|"setup contract\\nanswers + environment facts"| HM["harness-manager\\ntoolchain + baseline"]
    HM -->|"verification contract\\ninit + coverage + verifier"| G{"gates green?"}
    G -- no, layer:harness --> HM
    G -- no, layer:project --> P["fix target configuration"]
    P --> G
    G -- yes --> R(["harness ready\\nenter delivery loop"])`;
}

function renderImprovementMermaid() {
  return `flowchart LR
    V["verify-harness\\nor trace insight"] -->|"issue contract\\nsignature + layer + evidence"| I["harness issue\\nappend-only record"]
    H["human feedback"] -->|"human issue contract"| I
    O["orchestrator proposal\\nhuman approved"] -->|"approved improvement contract"| I
    I --> L{"finding layer?"}
    L -- project --> P["target delivery loop\\nrouter chooses owner"]
    L -- harness --> HM["harness-manager\\ncanonical source repair"]
    HM -->|"proof contract\\ndemo + reverify"| R{"signature gone?"}
    R -- no --> I
    R -- yes --> U["upgrade contract\\ncontext + target propagation"]
    U --> D(["resolved"])`;
}

// ── Contract table rendering ───────────────────────────────────────────────────

function renderContractTable(edgeIds) {
  const edges = edgeIds.map((id) => edgeMap.get(id)).filter((e) => e && e.contract);
  if (!edges.length) return "";

  const lines = [
    "",
    "## Handoff contracts",
    "",
    "| Edge | From → To | Layer | Contract fields | Writer | Consumer |",
    "|---|---|---|---|---|---|",
  ];
  for (const e of edges) {
    const c = e.contract;
    const fields = Array.isArray(c.fields) ? c.fields.join(", ") : String(c.fields);
    lines.push(`| ${e.id} | ${e.from} → ${e.to} | ${e.layer || "-"} | ${fields} | ${c.writer} | ${c.consumer} |`);
  }
  return lines.join("\n");
}

// ── Layer table rendering ──────────────────────────────────────────────────────

function renderLayerTable() {
  const lines = [
    "",
    "## Layers — precedence order",
    "",
    "| Layer | Depth | Description |",
    "|---|---|---|",
  ];
  for (const l of model.layers) {
    lines.push(`| ${l.id} | ${l.depth} | ${l.description} |`);
  }
  lines.push("");
  lines.push("Deeper layers (lower depth) have higher routing priority.");
  lines.push("The router checks spec → baseline → design → ... → implementation.");
  return lines.join("\n");
}

// ── File generation ────────────────────────────────────────────────────────────

function generateOnboarding() {
  return `# Onboarding workflow — requirement to a green harness

<!-- GENERATED from workflow-model.json by scripts/generate-workflows.mjs. Do not hand-edit. -->

**Scope: Floor 1.** Do not start delivery until the harness is observable, verifiable, and green.
The development and self-repair maps are [workflow-development.md](workflow-development.md) and
[workflow-improvement.md](workflow-improvement.md).

\`\`\`mermaid
${renderOnboardingMermaid()}
\`\`\`

The human provides only decisions that tools cannot discover. \`harness-manager\` turns those answers
into a real baseline and verification commands; a target defect stays in the target, while a
\`layer:harness\` finding returns to canonical source repair.

For integration projects, collect the service inventory before setup. Unknown health, dependency,
or environment facts remain human-owned answers rather than guessed defaults.
`;
}

function generateDevelopment() {
  const wf = model.workflows.development;
  return `# Development workflow — one routed delivery contract at a time

<!-- GENERATED from workflow-model.json by scripts/generate-workflows.mjs. Do not hand-edit. -->

**Scope: Floor 2.** A green harness dispatches one phase selected by \`loop/route.mjs\`; no agent
chooses its successor. The visual companion is
[agent-interaction-contracts.svg](diagram/agent-interaction-contracts.svg).

\`\`\`mermaid
${renderDevelopmentMermaid()}
\`\`\`
${renderContractTable(wf.edges)}
${renderLayerTable()}

\`passing\` remains open while \`readyForCheck: true\`; only checker may set \`status: done\`. Kubernetes
work is the \`test-agent\` integration mode and deploys only through \`tools/k8s-test-env.sh\`. A red
baseline first routes a maker to diagnosis, so a repair is never made against a guessed cause.

The detailed contract graph and the compact five-agent overview remain available as
[agent-interaction-contracts.svg](diagram/agent-interaction-contracts.svg) and
[five-agent-workflow.svg](diagram/five-agent-workflow.svg).
`;
}

function generateImprovement() {
  return `# Improvement workflow — repair the harness, not one target

<!-- GENERATED from workflow-model.json by scripts/generate-workflows.mjs. Do not hand-edit. -->

Every repair starts with a reproducible finding and ends only after the detector no longer emits
that finding. Delivery work remains in [workflow-development.md](workflow-development.md).

\`\`\`mermaid
${renderImprovementMermaid()}
\`\`\`

\`harness-manager\` edits \`templates/tree/**\` or \`scripts/**\`, never only the target that exposed
the bug. A human-owned issue does not auto-resolve: no detector can prove a person's observation
has disappeared.
`;
}

// ── Main ───────────────────────────────────────────────────────────────────────

const outputs = [
  { file: "workflow-onboarding.md", content: generateOnboarding() },
  { file: "workflow-development.md", content: generateDevelopment() },
  { file: "workflow-improvement.md", content: generateImprovement() },
];

if (DRY) {
  for (const o of outputs) {
    console.log(`\n${"═".repeat(60)}\n${o.file}\n${"═".repeat(60)}`);
    console.log(o.content);
  }
  process.exit(0);
}

if (CHECK) {
  let drift = 0;
  for (const o of outputs) {
    const p = path.join(REFS, o.file);
    const current = existsSync(p) ? readFileSync(p, "utf8") : "";
    if (current !== o.content) {
      console.error(`DRIFT: ${o.file} does not match workflow-model.json output`);
      drift++;
    }
  }
  if (drift) {
    console.error(`\n${drift} file(s) drifted from workflow-model.json. Run: node scripts/generate-workflows.mjs`);
    process.exit(1);
  }
  console.log("workflow files match workflow-model.json — no drift.");
  process.exit(0);
}

// Write
for (const o of outputs) {
  const p = path.join(REFS, o.file);
  writeFileSync(p, o.content);
  console.log(`  + ${o.file}`);
}
console.log(`Generated ${outputs.length} workflow file(s) from workflow-model.json`);
