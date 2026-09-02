#!/usr/bin/env node
// check-workflow-diagram.mjs — workflow file phải khớp workflow-model.json.
//
// Hai lớp kiểm tra:
//   1. GENERATED CHECK: workflow-*.md phải khớp output của generate-workflows.mjs.
//      Đây là kiểm tra chính — nếu model thay đổi mà không chạy generator, diagram drift.
//   2. MODEL CHECK: model phải chứa mọi agent, node, layer mà route.mjs + manifest khai báo.
//      Đây là kiểm tra model có đầy đủ, không phải kiểm tra diagram.
//
// Khác biệt quan trọng so với phiên bản cũ: script cũ grep tên trong Mermaid fence — nó chứng
// minh "tên xuất hiện" nhưng không chứng minh "cạnh đúng" hay "contract đúng". Phiên bản này
// kiểm tra cả hai: model khai báo edge + contract, generator vẽ chúng, checker so khớp.
//
// Usage:
//   node scripts/check-workflow-diagram.mjs [--dir references] [--json]
//   exit 0 = khớp; 1 = drift hoặc thiếu; 2 = không thể kiểm tra
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const args = process.argv.slice(2);
const opt = (n, d = null) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const JSON_OUT = args.includes("--json");
const skillRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DIR = path.resolve(opt("--dir", path.join(skillRoot, "references")));

const read = (p) => { try { return readFileSync(p, "utf8"); } catch { return null; } };

const findings = [];

// --- 1. Generated check: workflow files phải khớp generator output ----------------------------
const genScript = path.join(skillRoot, "scripts", "generate-workflows.mjs");
if (existsSync(genScript)) {
  const gen = spawnSync(process.execPath, [genScript, "--check"],
    { encoding: "utf8", maxBuffer: 8 * 1024 * 1024 });
  if (gen.status !== 0) {
    const driftFiles = (gen.stderr || "").split("\n")
      .filter((l) => l.startsWith("DRIFT:"))
      .map((l) => l.replace("DRIFT: ", "").trim());
    for (const f of driftFiles) {
      findings.push({ kind: "drift", name: f,
        why: "workflow file does not match generate-workflows.mjs output from workflow-model.json" });
    }
    if (!driftFiles.length) {
      findings.push({ kind: "drift", name: "generate-workflows.mjs",
        why: `generator --check failed: ${(gen.stderr || gen.stdout || "").slice(0, 200)}` });
    }
  }
} else {
  console.error(`generate-workflows.mjs not found at ${genScript} — cannot run generated check`);
}

// --- 2. Model check: model phải chứa mọi agent, node, layer ---------------------------------
const modelPath = path.join(DIR, "workflow-model.json");
let model;
try { model = JSON.parse(read(modelPath)); }
catch { console.error(`could not read ${modelPath}`); process.exit(2); }

const modelNodes = new Set(model.nodes.map((n) => n.id));
const modelLayers = new Set(model.layers.map((l) => l.id));
const modelEdgeLayers = new Set(model.edges.map((e) => e.layer).filter((l) => l && l !== "-"));

// 2a. agents from manifest
const manifestPath = path.join(skillRoot, "templates", "tree", "agents.manifest.json");
const manifest = (() => { try { return JSON.parse(read(manifestPath)); } catch { return null; } })();
if (!manifest) {
  console.error(`could not read ${manifestPath}`);
  process.exit(2);
}
for (const agent of manifest.agents || []) {
  if (agent.name && !modelNodes.has(agent.name)) {
    findings.push({ kind: "agent", name: agent.name,
      why: "agent in manifest but absent from workflow-model.json nodes" });
  }
}

// 2b. nodes and layers from route.mjs --rules
const routePath = path.join(skillRoot, "templates", "tree", "loop", "route.mjs");
const rules = spawnSync(process.execPath, [routePath, "--rules", "--json"],
  { encoding: "utf8", maxBuffer: 8 * 1024 * 1024 });
if (rules.status !== 0) {
  console.error(`could not read routing table from ${routePath}: ${rules.stderr || "no output"}`);
  process.exit(2);
}
let table = [];
try { table = JSON.parse(rules.stdout); } catch {
  console.error("routing table did not parse as JSON");
  process.exit(2);
}
const SKIP_NODES = new Set(["human", "exit"]);
for (const node of [...new Set(table.map((r) => r.node))]) {
  if (SKIP_NODES.has(node) || modelNodes.has(node)) continue;
  findings.push({ kind: "node", name: node,
    why: "a destination route.mjs can return that is absent from workflow-model.json nodes" });
}
for (const layer of [...new Set(table.map((r) => r.layer))]) {
  if (!layer || layer === "-" || modelLayers.has(layer)) continue;
  findings.push({ kind: "layer", name: layer,
    why: "a layer route.mjs can return that is absent from workflow-model.json layers" });
}

// 2c. edge layers phải nằm trong model layers
for (const l of modelEdgeLayers) {
  if (!modelLayers.has(l)) {
    findings.push({ kind: "layer", name: l,
      why: "an edge in workflow-model.json references a layer not declared in the layers array" });
  }
}

// 2d. edge from/to phải nằm trong model nodes
for (const e of model.edges) {
  if (!modelNodes.has(e.from) && e.from !== "router") {
    findings.push({ kind: "edge", name: `${e.id}.from=${e.from}`,
      why: "edge references a source node not declared in nodes" });
  }
  if (!modelNodes.has(e.to) && e.to !== "router") {
    findings.push({ kind: "edge", name: `${e.id}.to=${e.to}`,
      why: "edge references a target node not declared in nodes" });
  }
}

// --- 3. Legacy compat: mermaid fence presence check (giữ lại cho backward compat) -------------
const files = readdirSync(DIR).filter((f) => /^workflow[-.]/.test(f) && f.endsWith(".md"));
const drawn = files.map((f) => read(path.join(DIR, f)) || "")
  .flatMap((text) => [...text.matchAll(/```mermaid\n([\s\S]*?)```/g)].map((m) => m[1]))
  .join("\n");
const mentions = (name) => new RegExp(`(^|[^A-Za-z0-9-])${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^A-Za-z0-9-]|$)`).test(drawn);
const layersDrawn = new Set([...drawn.matchAll(/LAYER:\s*([a-z][a-z-]*)/g)].map((m) => m[1]));

for (const agent of manifest.agents || []) {
  if (agent.name && !mentions(agent.name)) {
    findings.push({ kind: "mermaid-missing-agent", name: agent.name,
      why: "agent not drawn in any mermaid fence — regenerate with: node scripts/generate-workflows.mjs" });
  }
}
for (const layer of [...new Set(table.map((r) => r.layer))]) {
  if (!layer || layer === "-" || layersDrawn.has(layer)) continue;
  findings.push({ kind: "mermaid-missing-layer", name: layer,
    why: "layer not in any mermaid fence — regenerate with: node scripts/generate-workflows.mjs" });
}

// --- report -------------------------------------------------------------------------------------
// Deduplicate: nếu drift đã bắt, mermaid-missing là hệ quả — chỉ giữ drift
const hasDrift = findings.some((f) => f.kind === "drift");
const deduped = hasDrift
  ? findings.filter((f) => !f.kind.startsWith("mermaid-missing"))
  : findings;

if (JSON_OUT) {
  process.stdout.write(JSON.stringify({
    schema: "workflow-diagram-check/2", dir: DIR, files, model: modelPath,
    green: deduped.length === 0, findings: deduped,
  }, null, 2) + "\n");
  process.exit(deduped.length ? 1 : 0);
}
if (!deduped.length) {
  console.log(`workflow check passed: ${files.length} file(s) match workflow-model.json, all nodes/layers/edges present.`);
  process.exit(0);
}
console.log(`workflow check failed — ${deduped.length} finding(s):\n`);
for (const f of deduped) console.log(`  [${f.kind}] ${f.name}\n      ${f.why}`);
if (hasDrift) {
  console.log(`\nFix: node scripts/generate-workflows.mjs`);
} else {
  console.log(`\nFix: update references/workflow-model.json, then: node scripts/generate-workflows.mjs`);
}
process.exit(1);
