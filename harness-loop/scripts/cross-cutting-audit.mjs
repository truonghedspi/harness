#!/usr/bin/env node
// cross-cutting-audit.mjs — "consistency archaeology": find cross-cutting decisions nobody owns.
//
// Why this is separate from the assumption registry: the two fail differently.
//   assumption      = "I believe X but haven't checked"  → if wrong, a conclusion FLIPS
//                                                          → cured by verifying it
//   cross-cutting   = "someone must choose a policy"     → if unowned, it gets decided BY ACCIDENT
//                     decision                             by whichever feature touches it first,
//                                                          and the next 40 features inherit it
//                                                          → cured by an owner + an enforced rule
//
// A cross-cutting concern is decided well when exactly one mechanism is used for it everywhere.
// So the mechanical signals are:
//   unowned     — the concern is all over the repo, but no MUST/MUST NOT rule and no
//                 docs/cross-cutting.md row governs it
//   fragmented  — two or more DIFFERENT mechanism terms for the same concern are each used in
//                 several places: the tell-tale of a policy that was never chosen, only drifted into
//
// This is a report, never a blocker. It is the AI-strong half (breadth: read everything, tire
// never) feeding the human-strong half (choose the trade-off) — see references/design-engineering.md.
//
// Usage: node cross-cutting-audit.mjs --target DIR [--json]
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
const opt = (n, d = null) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const JSON_OUT = args.includes("--json");
const TARGET = path.resolve(opt("--target", "."));

// Generic distributed/service concerns — deliberately NOT tailored to any one project. Each
// concern lists the competing *mechanism terms* a codebase might use for it; several of them
// in active use at once is the drift signal.
const CONCERNS = [
  { id: "identity-dedup", label: "message identity & de-duplication",
    terms: ["correlationid", "idempot", "dedup", "sequence number", "seqno", "logposition", "messageid", "requestid"] },
  { id: "retry", label: "retry & backoff policy",
    terms: ["retry", "retries", "backoff", "reattempt", "redeliver"] },
  { id: "timeout", label: "timeout & deadline policy",
    terms: ["timeout", "deadline", "--wait", "awaitility", "bounded wait"] },
  { id: "failure-reporting", label: "failure reporting & alerting",
    terms: ["alert", "eventsink", "escalate", "incident", "pagerduty", "notify"] },
  { id: "ordering", label: "ordering & delivery guarantees",
    terms: ["in order", "ordering", "total order", "at-least-once", "exactly-once", "at-most-once"] },
  { id: "retention", label: "data retention & purge",
    terms: ["retention", "purge", "prune", "ttl", "expiry"] },
  { id: "auth", label: "authentication & authorization",
    // NOT bare "token"/"permission": both are wildly overloaded (a "resume token" is a read
    // bookmark, a "syntax token" is a parser concept, a "tool permission" is agent config).
    // Measured on a real repo, bare terms made this concern a pure false positive.
    terms: ["authenticat", "authoriz", "credential", "rbac", "access control", "bearer token", "api key"] },
  { id: "observability", label: "observability & tracing",
    terms: ["trace", "metric", "telemetry", "instrument", "diagnostic"] },
  { id: "concurrency", label: "concurrency & threading model",
    terms: ["thread", "concurren", "lock", "synchroniz", "single-threaded"] },
  { id: "compat", label: "versioning & wire compatibility",
    terms: ["schema version", "backward compat", "wire format", "migration"] },
];

const exists = (p) => { try { statSync(p); return true; } catch { return false; } };
const read = (p) => { try { return readFileSync(p, "utf8"); } catch { return ""; } };

// Files that carry design intent or implementation — where a concern shows up in practice.
function scanFiles() {
  const out = [];
  // Scan ONLY the project's own domain artifacts. Harness plumbing (agent prompts, loop/,
  // tools/, docs/reference/) is about the HARNESS, not about this project's policy — v1 scanned
  // it and reported "auth" drift because a kiro agent prompt mentions tool "permission"/"token".
  const skip = new Set(["node_modules", ".git", "target", "trace", "build", "dist", "spikes",
    "prompts", "loop", "tools", "memory", ".kiro", "reference", "charts"]);
  const walk = (dir, depth = 0) => {
    if (depth > 5) return;
    for (const e of readdirSync(dir)) {
      if (skip.has(e) || e.startsWith(".")) continue;
      const abs = path.join(dir, e);
      let st; try { st = statSync(abs); } catch { continue; }
      if (st.isDirectory()) walk(abs, depth + 1);
      else if (/\.(md|java|mjs|js|ts|py|go|kt)$/.test(e) && e !== "check-coverage.mjs") out.push(abs);
    }
  };
  walk(TARGET);
  return out;
}

// "Owned" = a MUST/MUST NOT rule in constraints.md names it, or docs/cross-cutting.md has a row.
const constraintRules = read(path.join(TARGET, "docs", "constraints.md"))
  .split("\n").filter((l) => /\bMUST\b/.test(l)).join("\n").toLowerCase();
// A register row only counts as OWNED when it is actually complete: a chosen mechanism, a named
// owner+date, and the rule that enforces it. Dogfooding caught this immediately — a stub row
// ("not yet decided") silenced the audit, which would make the register a way to hide the problem
// rather than track it. An incomplete row is a DIFFERENT, better state than an unnoticed concern,
// so it gets its own softer flag.
const UNFILLED = /^(|—|-|\?|tbd|todo|none|n\/a|needs decision|not yet decided|\*\*needs decision\*\*.*)$/i;
function parseRegister() {
  const raw = read(path.join(TARGET, "docs", "cross-cutting.md"));
  const rows = [];
  for (const line of raw.split("\n")) {
    const t = line.trim();
    if (!t.startsWith("|") || /^\|[\s|:-]+\|$/.test(t)) continue;
    const c = t.split("|").slice(1, -1).map((x) => x.trim());
    if (c.length < 6 || /^id$/i.test(c[0])) continue;
    rows.push({ id: c[0], concern: c[1].toLowerCase(),
      complete: !UNFILLED.test(c[2]) && !UNFILLED.test(c[3]) && !UNFILLED.test(c[4]) });
  }
  return rows;
}
const registerRows = parseRegister();
const registerRaw = read(path.join(TARGET, "docs", "cross-cutting.md")).toLowerCase();

const files = scanFiles();
const corpus = files.map((f) => ({ rel: path.relative(TARGET, f), text: read(f).toLowerCase() }));

const results = [];
for (const c of CONCERNS) {
  const termHits = new Map();      // term -> Set(files)
  for (const t of c.terms) {
    const hits = new Set();
    for (const { rel, text } of corpus) if (text.includes(t)) hits.add(rel);
    if (hits.size) termHits.set(t, hits);
  }
  const allFiles = new Set([...termHits.values()].flatMap((s) => [...s]));
  if (!allFiles.size) continue;

  const ownedByRule = c.terms.some((t) => constraintRules.includes(t));
  const row = registerRows.find((r) => r.concern.includes(c.id) || c.terms.some((t) => r.concern.includes(t))
    || r.id.toLowerCase().includes(c.id));
  const ownedByRegister = !!(row && row.complete);
  const trackedOpen = !!(row && !row.complete);
  // Mechanism terms in real, repeated use (≥2 distinct files) — one is a policy, several is drift.
  const activeTerms = [...termHits.entries()].filter(([, s]) => s.size >= 2).map(([t]) => t);

  const flags = [];
  if (trackedOpen) flags.push("open-decision");            // known, tracked, waiting on a human
  else if (allFiles.size >= 3 && !ownedByRule && !ownedByRegister) flags.push("unowned");  // nobody has even noticed
  if (activeTerms.length >= 2 && !ownedByRegister && !ownedByRule) flags.push("fragmented");

  results.push({
    id: c.id, label: c.label, files: allFiles.size,
    activeTerms, ownedByRule, ownedByRegister, trackedOpen, flags,
    where: [...allFiles].slice(0, 6),
  });
}

const flagged = results.filter((r) => r.flags.length);
if (JSON_OUT) { console.log(JSON.stringify({ target: TARGET, scanned: files.length, results }, null, 2)); process.exit(0); }

console.log(`Cross-cutting audit — ${TARGET}`);
console.log(`Scanned ${files.length} files, ${CONCERNS.length} concerns\n`);
for (const r of results) {
  const owner = r.ownedByRegister ? "register" : r.flags.includes("open-decision") ? "register(open)"
    : r.ownedByRule ? "constraints.md" : "— nobody —";
  const mark = r.flags.length ? "!" : " ";
  console.log(`${mark} ${r.id.padEnd(18)} files:${String(r.files).padStart(3)}  owner: ${owner.padEnd(14)} ${r.flags.join("+")}`);
  if (r.flags.includes("fragmented")) console.log(`      competing mechanisms in active use: ${r.activeTerms.join(" / ")}`);
  if (r.flags.length) console.log(`      seen in: ${r.where.join(", ")}`);
}
console.log(`\n${flagged.length} concern(s) flagged. These are candidates for a human decision, not defects —`);
console.log(`record the choice + its enforcing rule in docs/cross-cutting.md to close one out.`);
