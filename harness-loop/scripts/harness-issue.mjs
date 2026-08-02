#!/usr/bin/env node
// harness-issue.mjs — the memory of the improve step.
//
// When verify-harness.mjs says a failure is layer=harness, the skill itself is at fault. Chat
// forgets that; this log does not. It is an append-only event log (JSONL) folded into current
// state on read, so every sighting, fix and reversal stays auditable.
//
// Usage:
//   node harness-issue.mjs import   --report trace/verify-report.json [--include-project]
//   node harness-issue.mjs add      --gate G --symptom S [--remedy R] [--layer harness]
//                                   [--target DIR] [--severity blocker|warn]
//   node harness-issue.mjs list     [--status open|resolved|wontfix|all] [--json]
//   node harness-issue.mjs resolve  --id HI-003 --fix "templates/tree/init.sh: prefer ./mvnw"
//   node harness-issue.mjs wontfix  --id HI-003 --note "stack out of scope"
//   node harness-issue.mjs stats    [--json]
//
// Log location: harness-loop/harness-issues.jsonl (override with --log PATH).
import { readFileSync, writeFileSync, appendFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const args = process.argv.slice(2);
const CMD = args[0];
const opt = (n, d = null) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const flag = (n) => args.includes(n);

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.resolve(scriptDir, "..");
const LOG = path.resolve(opt("--log", process.env.HARNESS_ISSUE_LOG || path.join(skillRoot, "harness-issues.jsonl")));

const exists = (p) => { try { statSync(p); return true; } catch { return false; } };

function readEvents() {
  if (!exists(LOG)) return [];
  return readFileSync(LOG, "utf8").split("\n").filter((l) => l.trim())
    .map((l, i) => { try { return JSON.parse(l); } catch { console.error(`warning: ${LOG}:${i + 1} is not valid JSON — skipped`); return null; } })
    .filter(Boolean);
}
const emit = (ev) => appendFileSync(LOG, JSON.stringify({ ts: new Date().toISOString(), ...ev }) + "\n");

// Fold the event stream into the current set of issues.
function fold() {
  const issues = new Map(); // id -> issue
  const bySig = new Map();  // signature -> id
  for (const ev of readEvents()) {
    if (ev.type === "open") {
      issues.set(ev.id, {
        id: ev.id, signature: ev.signature, gate: ev.gate, layer: ev.layer,
        severity: ev.severity, symptom: ev.symptom, remedy: ev.remedy,
        firstSeen: ev.ts, lastSeen: ev.ts, targets: ev.target ? [ev.target] : [],
        occurrences: 1, status: "open", fix: null, note: null, evidence: ev.evidence || "",
      });
      bySig.set(ev.signature, ev.id);
    } else if (ev.type === "occurrence") {
      const it = issues.get(ev.id); if (!it) continue;
      it.occurrences += 1;
      it.lastSeen = ev.ts;
      if (ev.target && !it.targets.includes(ev.target)) it.targets.push(ev.target);
      // A resolved issue seen again is a regression — reopen it loudly.
      if (it.status !== "open") { it.status = "open"; it.regressed = true; }
    } else if (ev.type === "resolve") {
      const it = issues.get(ev.id); if (!it) continue;
      it.status = "resolved"; it.fix = ev.fix || null; it.note = ev.note || null; it.resolvedAt = ev.ts;
    } else if (ev.type === "wontfix") {
      const it = issues.get(ev.id); if (!it) continue;
      it.status = "wontfix"; it.note = ev.note || null;
    }
  }
  return { issues: [...issues.values()], bySig };
}

function nextId(issues) {
  const max = issues.reduce((m, i) => Math.max(m, Number(String(i.id).replace(/\D/g, "")) || 0), 0);
  return `HI-${String(max + 1).padStart(3, "0")}`;
}

// One signature per distinct harness defect, stable across targets and runs.
const signatureOf = (f) => `${f.gate}/${f.id}`;

function record({ gate, id, layer, severity, symptom, remedy, evidence, target }) {
  const { issues, bySig } = fold();
  const signature = signatureOf({ gate, id });
  const existingId = bySig.get(signature);
  if (existingId) {
    emit({ type: "occurrence", id: existingId, target, symptom });
    return { id: existingId, isNew: false };
  }
  const newId = nextId(issues);
  emit({ type: "open", id: newId, signature, gate, layer, severity, symptom, remedy, evidence, target });
  return { id: newId, isNew: true };
}

// ---------------------------------------------------------------------------------------------
switch (CMD) {
  case "import": {
    const reportPath = path.resolve(opt("--report", "trace/verify-report.json"));
    if (!exists(reportPath)) { console.error(`error: report not found: ${reportPath}`); process.exit(2); }
    const report = JSON.parse(readFileSync(reportPath, "utf8"));
    const wanted = (report.findings || []).filter((f) => flag("--include-project") || f.layer === "harness");
    if (!wanted.length) { console.log(`No ${flag("--include-project") ? "" : "harness-layer "}findings in ${reportPath} — nothing to record.`); break; }
    let created = 0, repeats = 0;
    for (const f of wanted) {
      const r = record({ ...f, target: report.target });
      r.isNew ? created++ : repeats++;
      console.log(`  ${r.isNew ? "opened " : "repeat "} ${r.id}  [${f.gate}] ${f.symptom}`);
    }
    console.log(`\n${created} new issue(s), ${repeats} repeat sighting(s) → ${LOG}`);
    console.log(`Next: node ${path.relative(process.cwd(), path.join(scriptDir, "improve-harness.mjs"))}`);
    break;
  }

  case "add": {
    const symptom = opt("--symptom");
    if (!symptom) { console.error("error: --symptom is required"); process.exit(2); }
    const gate = opt("--gate", "manual");
    const id = opt("--id", symptom.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 48));
    const r = record({
      gate, id, layer: opt("--layer", "harness"), severity: opt("--severity", "blocker"),
      symptom, remedy: opt("--remedy", ""), evidence: opt("--evidence", ""),
      target: opt("--target") ? path.resolve(opt("--target")) : null,
    });
    console.log(`${r.isNew ? "opened" : "repeat sighting of"} ${r.id} → ${LOG}`);
    break;
  }

  case "resolve":
  case "wontfix": {
    const id = opt("--id");
    if (!id) { console.error("error: --id is required"); process.exit(2); }
    const { issues } = fold();
    if (!issues.find((i) => i.id === id)) { console.error(`error: unknown issue ${id}`); process.exit(2); }
    emit({ type: CMD === "resolve" ? "resolve" : "wontfix", id, fix: opt("--fix"), note: opt("--note") });
    console.log(`${id} marked ${CMD === "resolve" ? "resolved" : "wontfix"}.`);
    if (CMD === "resolve") console.log("Confirm it: node improve-harness.mjs --reverify");
    break;
  }

  case "list": {
    const want = opt("--status", "open");
    const { issues } = fold();
    const rows = want === "all" ? issues : issues.filter((i) => i.status === want);
    if (flag("--json")) { console.log(JSON.stringify(rows, null, 2)); break; }
    if (!rows.length) { console.log(`No ${want} harness issues.`); break; }
    console.log(`\nHarness issues (${want}) — ${LOG}\n`);
    for (const i of rows.sort((a, b) => b.occurrences - a.occurrences)) {
      console.log(`  ${i.id}  ${i.status.toUpperCase().padEnd(8)} x${i.occurrences}  [${i.gate}] ${i.symptom}`);
      if (i.remedy) console.log(`         → ${i.remedy}`);
      if (i.targets.length) console.log(`         seen in: ${i.targets.map((t) => path.basename(t)).join(", ")}`);
      if (i.regressed) console.log(`         !! REGRESSED — was resolved, seen again`);
      if (i.fix) console.log(`         fix: ${i.fix}`);
    }
    console.log("");
    break;
  }

  case "stats": {
    const { issues } = fold();
    const by = (s) => issues.filter((i) => i.status === s).length;
    const stats = {
      total: issues.length, open: by("open"), resolved: by("resolved"), wontfix: by("wontfix"),
      regressed: issues.filter((i) => i.regressed).length,
      totalOccurrences: issues.reduce((n, i) => n + i.occurrences, 0),
      log: LOG,
    };
    console.log(flag("--json") ? JSON.stringify(stats, null, 2)
      : `\n  total ${stats.total}  open ${stats.open}  resolved ${stats.resolved}  wontfix ${stats.wontfix}  regressed ${stats.regressed}\n  ${stats.totalOccurrences} sighting(s) across all runs — ${LOG}\n`);
    break;
  }

  default:
    console.error("usage: harness-issue.mjs <import|add|list|resolve|wontfix|stats> [options]  (see header)");
    process.exit(2);
}
