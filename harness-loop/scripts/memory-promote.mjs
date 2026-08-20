#!/usr/bin/env node
// memory-promote.mjs — v1 of docs/design/shared-memory-tier.md: mechanically promote a
// recurring, evidence-typed reason into memory/shared/, so every agent stops re-learning it.
//
// v1 scope only (INV-PROMOTE-1): promotes exactly what memory-consolidate.mjs --bootstrap already
// proves it can find — the same normalized checkerNotes-first-line or trace `detail` recurring
// across >=2 features/occurrences. Free-text matching across memory/<agent>/*.md entries is v2,
// not this script — a spike during the design session (memory/design-facilitator/, 2026-08-20)
// showed this exact string-normalize matcher does not catch paraphrased free prose, so this script
// never attempts to.
//
// Never promotes from evidence:inference alone (INV-SHARED-1): a checkerNotes-sourced candidate
// needs at least one feature in its group whose own `evidence` array has a real command (`cmd`)
// recorded; a trace-sourced candidate needs a companion `verify-ran` trace event for the same
// actor+feature. Neither is present -> the candidate is skipped, never written with a weaker label.
//
// A promoted entry is templated, not authored: the recurring text plus a citation to its sources,
// never a paraphrase and never a copy of any agent's private memory/<agent>/*.md body.
//
// Usage:
//   node memory-promote.mjs --target DIR [--dry-run] [--json]
import { readFileSync, writeFileSync, mkdirSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
const opt = (n, d = null) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const JSON_OUT = args.includes("--json");
const DRY = args.includes("--dry-run");

const TARGET = opt("--target");
if (!TARGET) { console.error("error: --target DIR is required"); process.exit(2); }
const targetRoot = path.resolve(TARGET);
const sharedRoot = path.join(targetRoot, "memory", "shared");

const exists = (p) => { try { statSync(p); return true; } catch { return false; } };
const isDir = (p) => { try { return statSync(p).isDirectory(); } catch { return false; } };
const readJSON = (p) => { try { return JSON.parse(readFileSync(p, "utf8")); } catch { return null; } };

function normalize(s) {
  return String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}
function slugify(s) {
  return normalize(s).split(" ").slice(0, 6).join("-").replace(/-+/g, "-").slice(0, 60) || "fact";
}

// Same normalize/8-word-prefix check memory-consolidate.mjs uses to decide "already captured" —
// against memory/shared/, not memory/<agent>/, since that is what this script writes to.
function alreadyShared() {
  if (!isDir(sharedRoot)) return [];
  return readdirSync(sharedRoot).filter((f) => f.endsWith(".md"))
    .map((f) => normalize(readFileSync(path.join(sharedRoot, f), "utf8")));
}

function checkerNotesCandidates(fl) {
  const groups = new Map();
  for (const f of (fl?.features || [])) {
    const note = String(f.checkerNotes || "").trim().split("\n")[0].trim();
    if (!note || /^(NEEDS DESIGN:|NEEDS RE-PLAN:|FOLLOW-UP:)/.test(note)) continue;
    const key = normalize(note).slice(0, 80);
    if (!key) continue;
    if (!groups.has(key)) groups.set(key, { sample: note, features: [] });
    groups.get(key).features.push(f);
  }
  const out = [];
  for (const { sample, features } of groups.values()) {
    if (features.length < 2) continue;
    const withCmd = features.filter((f) => (f.evidence || []).some((e) => e && e.cmd));
    if (!withCmd.length) continue; // INV-SHARED-1: no real command behind any occurrence — skip
    out.push({
      source: "checkerNotes", sample, evidence: "test",
      featureIds: features.map((f) => f.id),
    });
  }
  return out;
}

function traceCandidates(traceLines) {
  const groups = new Map();
  const verifyRan = new Set(); // `${actor}\0${feature}` that had a verify-ran event
  for (const line of traceLines) {
    let e; try { e = JSON.parse(line); } catch { continue; }
    if (e.event === "verify-ran" && e.actor && e.feature) verifyRan.add(`${e.actor}\0${e.feature}`);
  }
  for (const line of traceLines) {
    let e; try { e = JSON.parse(line); } catch { continue; }
    if (e.event !== "blocked" && e.event !== "verdict") continue;
    if (e.event === "verdict" && !/^REJECT/.test(String(e.detail || ""))) continue;
    const detail = String(e.detail || "").trim();
    if (!detail || !e.actor) continue;
    const key = `${e.actor}\0${normalize(detail).slice(0, 80)}`;
    if (!groups.has(key)) groups.set(key, { actor: e.actor, sample: detail, features: new Set() });
    if (e.feature) groups.get(key).features.add(e.feature);
  }
  const out = [];
  for (const { actor, sample, features } of groups.values()) {
    if (features.size < 2) continue;
    const hasVerifyRan = [...features].some((f) => verifyRan.has(`${actor}\0${f}`));
    if (!hasVerifyRan) continue; // INV-SHARED-1: no companion tool-output evidence — skip
    out.push({
      source: "trace", sample, evidence: "tool-output",
      featureIds: [...features], actor,
    });
  }
  return out;
}

const fl = readJSON(path.join(targetRoot, "feature_list.json"));
const tracePath = path.join(targetRoot, "trace", "trace.jsonl");
const traceLines = exists(tracePath) ? readFileSync(tracePath, "utf8").split("\n").filter(Boolean) : [];

const shared = alreadyShared();
const alreadyCaptured = (text) => {
  const key = normalize(text).split(" ").slice(0, 8).join(" ");
  return Boolean(key) && shared.some((t) => t.includes(key));
};

const candidates = [...checkerNotesCandidates(fl), ...traceCandidates(traceLines)]
  .filter((c) => !alreadyCaptured(c.sample));

const written = [];
if (!DRY && candidates.length) mkdirSync(sharedRoot, { recursive: true });
for (const c of candidates) {
  const today = new Date().toISOString().slice(0, 10);
  const slug = slugify(c.sample);
  const file = `${slug}.md`;
  const entry = `---
name: ${slug}
description: ${c.sample.replace(/\n/g, " ").slice(0, 140)}
metadata:
  type: fact
  evidence: ${c.evidence}
  confidence: verified
  date: ${today}
  sources: [${c.featureIds.join(", ")}]
---

${c.sample}
`;
  written.push({ file: `memory/shared/${file}`, source: c.source, evidence: c.evidence, sources: c.featureIds });
  if (!DRY) writeFileSync(path.join(sharedRoot, file), entry);
}

if (JSON_OUT) {
  console.log(JSON.stringify({ target: targetRoot, dryRun: DRY, promoted: written }, null, 2));
} else {
  console.log(`memory-promote — ${targetRoot}${DRY ? " (dry run)" : ""}\n`);
  if (!written.length) {
    console.log("  nothing to promote — no recurring, evidence-typed reason found that isn't already in memory/shared/.");
  }
  for (const w of written) {
    console.log(`  ${DRY ? "would write" : "wrote"} ${w.file}  [${w.source}, evidence: ${w.evidence}]  sources: ${w.sources.join(", ")}`);
  }
  console.log(`\n${written.length} entr${written.length === 1 ? "y" : "ies"} ${DRY ? "would be " : ""}promoted.`);
}
