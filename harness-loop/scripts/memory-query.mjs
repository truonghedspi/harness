#!/usr/bin/env node
// memory-query.mjs — queryable retrieval over agent memory (references/agent-memory.md).
//
// MEMORY.md (the index) is for a quick skim — it's not built for "find me every lesson about X."
// This script parses every entry's frontmatter + body and filters/searches across agents, the
// same way harness-issue.mjs's `list`/`stats` give structured access to the issue log instead of
// making you eyeball a JSONL file.
//
// Usage:
//   node memory-query.mjs --target DIR [--agent NAME] [--type lesson|fact|pointer]
//                          [--grep TEXT] [--since YYYY-MM-DD] [--json]
//
// Matches against a target project's memory/ (maker, checker, ...) or the harness-loop skill's
// own memory/ (harness-improver) — pass --target . at the skill root. Stateless: re-scans the
// (small, dozens-of-entries) memory tree on every call rather than maintaining a separate index
// file to keep in sync — see references/agent-memory.md for why file-based is the right size here.
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
const opt = (n, d = null) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const JSON_OUT = args.includes("--json");
const AGENT_FILTER = opt("--agent");
const TYPE_FILTER = opt("--type");
const GREP = opt("--grep");
const SINCE = opt("--since");

const TARGET = opt("--target");
if (!TARGET) { console.error("error: --target DIR is required"); process.exit(2); }
const targetRoot = path.resolve(TARGET);
const memoryRoot = path.join(targetRoot, "memory");

const isDir = (p) => { try { return statSync(p).isDirectory(); } catch { return false; } };
const exists = (p) => { try { statSync(p); return true; } catch { return false; } };

function parseEntry(content) {
  const m = content.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!m) return { frontmatter: {}, body: content };
  const frontmatter = {};
  let currentKey = null;
  for (const line of m[1].split("\n")) {
    const top = line.match(/^(\w+):\s*(.*)$/);
    if (top && !line.startsWith(" ")) { currentKey = top[1]; frontmatter[currentKey] = top[2].trim(); continue; }
    const nested = line.match(/^\s+(\w+):\s*(.*)$/);
    if (nested && currentKey) {
      if (typeof frontmatter[currentKey] !== "object") frontmatter[currentKey] = {};
      frontmatter[currentKey][nested[1]] = nested[2].trim();
    }
  }
  return { frontmatter, body: m[2].trim() };
}

if (!isDir(memoryRoot)) {
  console.error(`no memory/ directory under ${targetRoot}`);
  process.exit(0);
}

const agentDirs = readdirSync(memoryRoot).filter((f) => isDir(path.join(memoryRoot, f)));
let results = [];
for (const agent of agentDirs) {
  if (AGENT_FILTER && agent !== AGENT_FILTER) continue;
  const dir = path.join(memoryRoot, agent);
  for (const f of readdirSync(dir).filter((f) => f.endsWith(".md") && f !== "MEMORY.md")) {
    const raw = readFileSync(path.join(dir, f), "utf8");
    const { frontmatter, body } = parseEntry(raw);
    const type = frontmatter.metadata?.type || "";
    const date = frontmatter.metadata?.date || "";
    if (TYPE_FILTER && type !== TYPE_FILTER) continue;
    if (SINCE && date && date < SINCE) continue;
    if (GREP) {
      const haystack = `${frontmatter.name || ""} ${frontmatter.description || ""} ${body}`.toLowerCase();
      if (!haystack.includes(GREP.toLowerCase())) continue;
    }
    results.push({
      agent, file: `memory/${agent}/${f}`,
      name: frontmatter.name || f.replace(/\.md$/, ""),
      description: frontmatter.description || "",
      type, date, body,
    });
  }
}
// Recency first — the most common real query is "what's the latest relevant lesson," matching
// the retrieval-by-recency practice recognized agent-memory designs default to.
results.sort((a, b) => (b.date || "").localeCompare(a.date || ""));

if (JSON_OUT) {
  console.log(JSON.stringify(results, null, 2));
} else {
  if (!results.length) {
    console.log("no matching memory entries.");
  } else {
    for (const r of results) {
      console.log(`[${r.type || "?"}] ${r.agent}/${r.name}${r.date ? ` (${r.date})` : ""}`);
      console.log(`  ${r.description}`);
      console.log(`  ${r.file}`);
      console.log("");
    }
  }
  console.log(`${results.length} entr${results.length === 1 ? "y" : "ies"} matched.`);
}
