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
// --bootstrap is the same division of labor applied to a project that never wrote memory in the
// first place: the raw material for a lesson is usually already sitting in feature_list.json
// (checkerNotes) and trace/trace.jsonl (blocked/verdict events) long before anyone turns it into
// a memory entry. This mines those two sources for a REASON THAT RECURRED ACROSS >=2 FEATURES —
// a single occurrence is not a pattern, and this script does not judge whether a repeat is
// genuinely non-obvious, only that it repeated and isn't captured in memory/ yet. It never writes
// memory/ itself; the point is the same as the rest of this file — surface candidates, let the
// agent (or a human) decide what's actually worth a memory entry.
//
// Usage:
//   node memory-consolidate.mjs --target DIR [--json]
//   node memory-consolidate.mjs --target DIR --bootstrap [--json]
//
// Works against a target project's memory/ (maker, checker, feature-planner, ...) or the
// harness-loop skill's own memory/ (harness-improver) — pass --target . at the skill root.
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
const opt = (n, d = null) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const JSON_OUT = args.includes("--json");
const BOOTSTRAP = args.includes("--bootstrap");

const TARGET = opt("--target");
if (!TARGET) { console.error("error: --target DIR is required"); process.exit(2); }
const targetRoot = path.resolve(TARGET);
const memoryRoot = path.join(targetRoot, "memory");

const INDEX_MAX_LINES = 200;
const INDEX_MAX_LINE_CHARS = 150;

const exists = (p) => { try { statSync(p); return true; } catch { return false; } };
const isDir = (p) => { try { return statSync(p).isDirectory(); } catch { return false; } };

// Unicode-aware on purpose. The old form stripped everything outside [a-z0-9], which turns a
// Non-ASCII-language entries into consonant rubble under the old normalization — so every text comparison in this
// file was silently comparing noise on any project that does not write in English.
function normalize(s) {
  return String(s || "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

// Content tokens for similarity. Short tokens carry almost no signal and inflate every pairwise
// score toward the middle, which is what makes a threshold impossible to set.
const STOP = new Set(["that", "this", "with", "from", "have", "does", "when", "then", "than",
  "which", "what", "will", "would", "there", "their", "been", "were", "into", "onto", "only"]);
function tokens(text) {
  return new Set(normalize(text).split(" ").filter((w) => w.length >= 4 && !STOP.has(w)));
}
function jaccard(a, b) {
  if (!a.size || !b.size) return 0;
  let shared = 0;
  for (const t of a) if (b.has(t)) shared += 1;
  return shared / (a.size + b.size - shared);
}
const stripFrontmatter = (content) => content.replace(/^---\n[\s\S]*?\n---\n?/, "");

// Calibrated on examples/jdt-mcp-server: 71 entries, 650 within-agent candidate pairs.
//   0.25 -> 45 pairs (a wall, and most share only a subject area)
//   0.30 -> 10 pairs
//   0.34 ->  4 pairs
//   0.40 ->  0 pairs — the real duplicate scores 0.374, so this is the hard ceiling
// 0.34 was the first choice and it was too tight: a second, independently written pair of entries
// about the same incident scored 0.300, and missing a duplicate costs a session while dismissing
// one costs a glance. The error is not symmetric, so the threshold sits on the forgiving side.
//
// Known limits, both real:
//   - a long general-purpose entry becomes a hub — on this corpus one mutant-mechanics write-up
//     pairs with three unrelated entries purely on shared vocabulary
//   - a duplicate written with no shared concrete nouns is still missed; this finds lessons that
//     describe the same incident, not lessons that happen to reach the same conclusion
const DUPLICATE_SIMILARITY = 0.30;

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
  // One finding per CLASS, with a count and a few examples — never one per occurrence. On a real
  // project the per-occurrence form produced 66 identical index-line-too-long warnings out of 68
  // findings, which is the wall review-digest.mjs exists to prevent and which AGENTS.md calls
  // worse than no gate: it photographs as coverage and teaches people to scroll past.
  const groups = new Map();
  const group = (id, example, symptom, remedy) => {
    if (!groups.has(id)) groups.set(id, { id, severity: "warn", examples: [], symptom, remedy });
    groups.get(id).examples.push(example);
  };
  const flushGroups = () => {
    for (const g of groups.values()) {
      const shown = g.examples.slice(0, 3).join(", ");
      const more = g.examples.length > 3 ? `, +${g.examples.length - 3} more` : "";
      findings.push({ id: g.id, severity: g.severity, count: g.examples.length,
        examples: g.examples, symptom: g.symptom(g.examples.length, `${shown}${more}`), remedy: g.remedy });
    }
  };

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
      group("index-line-too-long", `MEMORY.md:${i + 1} (${line.length} chars)`,
        (n, ex) => `${n} index line(s) over the ${INDEX_MAX_LINE_CHARS}-char budget — the index has stopped being skimmable: ${ex}`,
        "shorten the one-line hooks; move reasoning into the entry files");
    }
    if (!exists(path.join(dir, m[1]))) {
      group("broken-link", m[1],
        (n, ex) => `${n} MEMORY.md link(s) point at files that do not exist in memory/${agent}/: ${ex}`,
        "fix or remove the dangling MEMORY.md lines");
    }
  });

  const entryFiles = exists(dir)
    ? readdirSync(dir).filter((f) => f.endsWith(".md") && f !== "MEMORY.md")
    : [];
  for (const f of entryFiles) {
    if (!linkedSlugs.has(f)) {
      group("orphan-entry", f,
        (n, ex) => `${n} entry file(s) exist but MEMORY.md links none of them — unreachable, so nothing ever reads them: ${ex}`,
        "add an index line for each, or delete the ones no longer useful");
    }
  }

  const seenNames = new Map();
  const seenDescs = new Map();
  const bodies = [];
  for (const f of entryFiles) {
    const raw = readFileSync(path.join(dir, f), "utf8");
    const fm = parseFrontmatter(raw);
    bodies.push({ file: f, tokens: tokens(stripFrontmatter(raw)) });
    // The schema is not decoration: duplicate-name and duplicate-description below both key on it,
    // and memory-query.mjs prints `[?]` with an empty hook without it. An entry that skips the
    // frontmatter is an entry the tooling cannot see — it still costs a file, and it silently
    // switches off the check that would have stopped the same lesson being learned twice.
    if (!fm.name || !fm.description) {
      group("entry-missing-schema", f,
        (n, ex) => `${n} entry file(s) have no \`name:\`/\`description:\` frontmatter — duplicate detection and memory-query.mjs are blind to them: ${ex}`,
        "add the frontmatter documented in references/agent-memory.md; without it the entry is invisible to every check here");
    }
    if (fm.name) {
      if (seenNames.has(fm.name)) {
        group("duplicate-name", `${seenNames.get(fm.name)} = ${f}`,
          (n, ex) => `${n} pair(s) of entries declare the same name: ${ex}`,
          "merge each pair, or rename one side");
      } else seenNames.set(fm.name, f);
    }
    if (fm.description) {
      const key = normalize(fm.description);
      if (key && seenDescs.has(key)) {
        group("duplicate-description", `${seenDescs.get(key)} = ${f}`,
          (n, ex) => `${n} pair(s) of entries have near-identical descriptions: ${ex}`,
          "likely the same lesson written twice — merge them");
      } else if (key) seenDescs.set(key, f);
    }
  }

  // Two people describing one fact rarely choose the same words, so an exact-match check on the
  // description finds only copy-paste. This compares the entry BODIES by token overlap, which is
  // what catches the same lesson learned twice and written independently — the case that actually
  // costs a session, because the second author read the index, did not recognise the paraphrase,
  // and paid for the discovery again.
  for (let i = 0; i < bodies.length; i++) {
    for (let j = i + 1; j < bodies.length; j++) {
      const score = jaccard(bodies[i].tokens, bodies[j].tokens);
      if (score >= DUPLICATE_SIMILARITY) {
        group("likely-same-lesson", `${bodies[i].file} ~ ${bodies[j].file} (${score.toFixed(2)})`,
          (n, ex) => `${n} pair(s) of entries look like the same lesson written twice: ${ex}`,
          "read both; if they are one fact, merge them and keep the sharper reproduction");
      }
    }
  }

  flushGroups();
  return { agent, entryCount: entryFiles.length, indexLines: lines.length, findings };
}

// Reads every existing memory entry body once, so a bootstrap candidate already captured
// somewhere doesn't get suggested again — the whole point is finding what's NOT written down yet.
function existingMemoryText() {
  if (!isDir(memoryRoot)) return [];
  const texts = [];
  for (const agent of readdirSync(memoryRoot).filter((f) => isDir(path.join(memoryRoot, f)))) {
    const dir = path.join(memoryRoot, agent);
    for (const f of readdirSync(dir).filter((f) => f.endsWith(".md") && f !== "MEMORY.md")) {
      texts.push(normalize(readFileSync(path.join(dir, f), "utf8")));
    }
  }
  return texts;
}

function bootstrapCandidates() {
  const existing = existingMemoryText();
  const alreadyCaptured = (text) => {
    const key = normalize(text).split(" ").slice(0, 8).join(" ");
    return Boolean(key) && existing.some((t) => t.includes(key));
  };
  const candidates = [];

  // Source 1: a checkerNotes reason that recurs across features. Routing markers (NEEDS DESIGN:,
  // NEEDS RE-PLAN:, FOLLOW-UP:) are excluded — those are scope/design questions with their own
  // owner (feature-planner / design-facilitator), not a lesson for an agent's own memory.
  const flPath = path.join(targetRoot, "feature_list.json");
  if (exists(flPath)) {
    let fl = null;
    try { fl = JSON.parse(readFileSync(flPath, "utf8")); } catch { /* unreadable — skip this source */ }
    const groups = new Map();
    for (const f of (fl?.features || [])) {
      const note = String(f.checkerNotes || "").trim().split("\n")[0].trim();
      if (!note || /^(NEEDS DESIGN:|NEEDS RE-PLAN:|FOLLOW-UP:)/.test(note)) continue;
      const key = normalize(note).slice(0, 80);
      if (!key) continue;
      if (!groups.has(key)) groups.set(key, { sample: note, features: [] });
      groups.get(key).features.push(f.id);
    }
    for (const { sample, features } of groups.values()) {
      if (features.length < 2 || alreadyCaptured(sample)) continue;
      candidates.push({
        source: "feature_list.json:checkerNotes", agent: "checker or maker", features, sample,
        suggestion: `the same checkerNotes reason recurred on ${features.length} features — not yet in memory/`,
      });
    }
  }

  // Source 2: a blocked reason or REJECT verdict that recurs, per actor, in trace/trace.jsonl.
  const tracePath = path.join(targetRoot, "trace", "trace.jsonl");
  if (exists(tracePath)) {
    const groups = new Map();
    for (const line of readFileSync(tracePath, "utf8").split("\n").filter(Boolean)) {
      let e; try { e = JSON.parse(line); } catch { continue; }
      if (e.event !== "blocked" && e.event !== "verdict") continue;
      if (e.event === "verdict" && !/^REJECT/.test(String(e.detail || ""))) continue;
      const detail = String(e.detail || "").trim();
      if (!detail || !e.actor) continue;
      const key = `${e.actor}\0${normalize(detail).slice(0, 80)}`;
      if (!groups.has(key)) groups.set(key, { actor: e.actor, sample: detail, features: new Set() });
      if (e.feature) groups.get(key).features.add(e.feature);
    }
    for (const { actor, sample, features } of groups.values()) {
      if (features.size < 2 || alreadyCaptured(sample)) continue;
      candidates.push({
        source: "trace/trace.jsonl", agent: actor, features: [...features], sample,
        suggestion: `${actor} hit the same reason on ${features.size} features — not yet in memory/${actor}/`,
      });
    }
  }

  return candidates;
}

if (BOOTSTRAP) {
  const candidates = bootstrapCandidates();
  if (JSON_OUT) {
    console.log(JSON.stringify({ target: targetRoot, bootstrapCandidates: candidates }, null, 2));
  } else {
    console.log(`Memory bootstrap candidates — ${targetRoot}\n`);
    if (!candidates.length) {
      console.log("  none — no reason recurred across >=2 features in feature_list.json or trace/trace.jsonl" +
        " that isn't already captured in memory/.");
    }
    for (const c of candidates) {
      console.log(`  [${c.source}] ${c.suggestion}`);
      console.log(`      sample: ${c.sample}`);
      console.log(`      seen on: ${c.features.join(", ")}`);
    }
    console.log(`\n${candidates.length} candidate(s). This does not write memory for you — read the` +
      ` evidence, judge whether it is genuinely non-obvious, and write memory/<agent>/<slug>.md yourself if so.`);
  }
  process.exit(0);
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
      console.log(`    warn  [${f.id}${f.count > 1 ? ` x${f.count}` : ""}] ${f.symptom}`);
      console.log(`          -> ${f.remedy}`);
    }
  }
  console.log(`\n${totalFindings} finding(s) across ${agents.length} agent(s).`);
}
process.exit(totalFindings > 0 ? 0 : 0); // report-only; never fails a build over memory hygiene
