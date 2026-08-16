#!/usr/bin/env node
// memory-consolidate.mjs — the mechanical half of "reorganize memory" (references/agent-memory.md).
//
// Reports, per agent under <target>/memory/<agent>/: index-budget violations (MEMORY.md too long
// or a line too long — an index that needs scrolling has stopped being "always loaded cheaply"),
// orphan entry files (on disk, not linked from MEMORY.md), broken links (linked, file missing),
// and likely-duplicate entries (same frontmatter `name:`, or near-identical `description:`).
//
// This is a REPORT, not a rewrite — same division of labor as verify-harness.mjs vs. the
// checker's semantic judgment: cheap structural signals here, deciding what to merge stays a call
// for the agent (or a human) that reads this report.
//
// Usage:
//   node memory-consolidate.mjs --target DIR [--json]
//
// Works against a target project's memory/ (maker, checker, feature-planner, ...) or the
// harness-loop skill's own memory/ (harness-improver) — pass --target . at the skill root.
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
const opt = (n, d = null) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const JSON_OUT = args.includes("--json");

const TARGET = opt("--target");
if (!TARGET) { console.error("error: --target DIR is required"); process.exit(2); }
const targetRoot = path.resolve(TARGET);
const memoryRoot = path.join(targetRoot, "memory");

const INDEX_MAX_LINES = 200;
const INDEX_MAX_LINE_CHARS = 150;

const exists = (p) => { try { statSync(p); return true; } catch { return false; } };
const isDir = (p) => { try { return statSync(p).isDirectory(); } catch { return false; } };

function normalize(s) {
  return String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function parseFrontmatter(content) {
  const m = content.match(/^---\n([\s\S]*?)\n---/);
  if (!m) return {};
  const out = {};
  for (const line of m[1].split("\n")) {
    const kv = line.match(/^(\w+):\s*(.*)$/);
    if (kv) out[kv[1]] = kv[2].trim();
  }
  return out;
}

function checkAgent(agent) {
  const dir = path.join(memoryRoot, agent);
  const indexPath = path.join(dir, "MEMORY.md");
  const findings = [];

  const indexRaw = exists(indexPath) ? readFileSync(indexPath, "utf8") : "";
  const lines = indexRaw.split("\n");
  if (lines.length > INDEX_MAX_LINES) {
    findings.push({ id: "index-over-budget", severity: "warn",
      symptom: `MEMORY.md is ${lines.length} lines (budget ${INDEX_MAX_LINES}) — no longer cheap to load every run`,
      remedy: "archive or merge the oldest/least-useful entries; keep the index to one line per entry" });
  }
  const linkedSlugs = new Set();
  lines.forEach((line, i) => {
    const m = line.match(/^-\s*\[.*?\]\(([^)]+)\)/);
    if (!m) return;
    linkedSlugs.add(m[1]);
    if (line.length > INDEX_MAX_LINE_CHARS) {
      findings.push({ id: `index-line-too-long:${i + 1}`, severity: "warn",
        symptom: `MEMORY.md:${i + 1} is ${line.length} chars (budget ${INDEX_MAX_LINE_CHARS}) — push detail into the linked file, not the index`,
        remedy: "shorten the one-line hook; move reasoning into the entry file" });
    }
    if (!exists(path.join(dir, m[1]))) {
      findings.push({ id: `broken-link:${m[1]}`, severity: "warn",
        symptom: `MEMORY.md links ${m[1]}, which does not exist in memory/${agent}/`,
        remedy: "fix or remove the dangling MEMORY.md line" });
    }
  });

  const entryFiles = exists(dir)
    ? readdirSync(dir).filter((f) => f.endsWith(".md") && f !== "MEMORY.md")
    : [];
  for (const f of entryFiles) {
    if (!linkedSlugs.has(f)) {
      findings.push({ id: `orphan-entry:${f}`, severity: "warn",
        symptom: `memory/${agent}/${f} exists but MEMORY.md has no line linking it — unreachable`,
        remedy: "add an index line, or delete the file if it's no longer useful" });
    }
  }

  const seenNames = new Map();
  const seenDescs = new Map();
  for (const f of entryFiles) {
    const fm = parseFrontmatter(readFileSync(path.join(dir, f), "utf8"));
    if (fm.name) {
      if (seenNames.has(fm.name)) {
        findings.push({ id: `duplicate-name:${fm.name}`, severity: "warn",
          symptom: `${seenNames.get(fm.name)} and ${f} both declare name: ${fm.name}`,
          remedy: "merge the two entries or rename one" });
      } else seenNames.set(fm.name, f);
    }
    if (fm.description) {
      const key = normalize(fm.description);
      if (key && seenDescs.has(key)) {
        findings.push({ id: `duplicate-description:${f}`, severity: "warn",
          symptom: `${seenDescs.get(key)} and ${f} have near-identical descriptions`,
          remedy: "likely the same lesson written twice — merge them" });
      } else if (key) seenDescs.set(key, f);
    }
  }

  return { agent, entryCount: entryFiles.length, indexLines: lines.length, findings };
}

if (!isDir(memoryRoot)) {
  console.error(`no memory/ directory under ${targetRoot} — nothing to consolidate`);
  process.exit(0);
}
const agents = readdirSync(memoryRoot).filter((f) => isDir(path.join(memoryRoot, f)));
const report = agents.map(checkAgent);
const totalFindings = report.reduce((n, r) => n + r.findings.length, 0);

if (JSON_OUT) {
  console.log(JSON.stringify({ target: targetRoot, agents: report }, null, 2));
} else {
  console.log(`Memory consolidation report — ${targetRoot}\n`);
  for (const r of report) {
    console.log(`  ${r.agent}: ${r.entryCount} entr${r.entryCount === 1 ? "y" : "ies"}, ${r.indexLines}-line index`);
    for (const f of r.findings) {
      console.log(`    warn  [${f.id}] ${f.symptom}`);
      console.log(`          -> ${f.remedy}`);
    }
  }
  console.log(`\n${totalFindings} finding(s) across ${agents.length} agent(s).`);
}
process.exit(totalFindings > 0 ? 0 : 0); // report-only; never fails a build over memory hygiene
