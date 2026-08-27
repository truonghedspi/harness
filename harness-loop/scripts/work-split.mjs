#!/usr/bin/env node
// work-split.mjs — the admission contract for a PARALLEL maker iteration.
//
// WIP = 1 (Lesson 7) forbids two makers on two FEATURES. It does not forbid two makers on two
// disjoint file sets inside ONE feature, and that is the only fan-out this tool authorises:
//
//     route.mjs → maker (lead, writes the plan) → N × maker (one slice each, in parallel)
//                                               → 1 × maker (integrate + run the verification)
//
// The fan-out is only as correct as its model of what the workers contend on
// (references/p08-parallel-record.md). Here they contend on FILES and on the shared state files,
// so this tool refuses a plan whose slices can touch the same path, refuses a slice that claims a
// state file, and refuses a slice whose brief is not self-contained — a worker that has to ask a
// question mid-run has no one to ask, and a worker that guesses is worse than one that never ran.
//
// Usage:
//   node tools/work-split.mjs validate <feat-id>          # typed admission report; exit 0 = fan out
//   node tools/work-split.mjs brief    <feat-id> <slice>  # the self-contained worker brief
//   node tools/work-split.mjs paths    <feat-id> <slice>  # allowed globs, one per line (guard-write)
//   node tools/work-split.mjs status   <feat-id>          # per-slice state
//   node tools/work-split.mjs start|complete|fail <feat-id> <slice> [--note "<text>"]
import { execFileSync } from "node:child_process";
import { appendFileSync, existsSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const args = process.argv.slice(2);
const JSON_OUT = args.includes("--json");
const [command, featureId, sliceId] = args.filter((a) => !a.startsWith("--"));
const noteAt = args.indexOf("--note");
const note = noteAt >= 0 ? args[noteAt + 1] || "" : "";

// Located from this file, not from cwd: a maker runs it from wherever it happens to be, and a
// contained layout puts the harness one level below the repo whose files the slices carve up.
const HOME = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PROJECT_ROOT = path.basename(HOME) === "harness" && existsSync(path.join(path.dirname(HOME), "AGENTS.md"))
  ? path.dirname(HOME) : HOME;
// "" on a flat layout, "harness" on a contained one. Slice paths are PROJECT-relative because that
// is what tools/guard-write.mjs compares against; the state files this tool protects are
// HARNESS-relative, so they need the prefix before the two can be compared at all.
const HOME_REL = path.relative(PROJECT_ROOT, HOME).replaceAll("\\", "/");
const P = (...p) => path.join(HOME, ...p);
// A cited source may live in the harness (docs/design/…) or in the product tree (src/…). Both are
// legitimate reading for a slice, so both roots count as "it exists".
const cited = (rel) => existsSync(path.join(PROJECT_ROOT, rel)) || existsSync(P(rel));
const planPath = (id) => P("loop", "work-split", `${id}.json`);
// One file per slice, written only by that slice's own worker. The obvious design — a `status`
// field inside the plan — is a read-modify-write on one file by every worker at once, which loses
// whichever completion lands second and then re-dispatches a slice that is already built. The
// whole point of this tool is to remove what the workers contend on, so the status they write is
// not allowed to be shared either.
const statusPath = (id, sid) => P("loop", "work-split", `${id}.${sid}.json`);
const sliceStatus = (id, sid) => {
  try { return JSON.parse(readFileSync(statusPath(id, sid), "utf8")); } catch { return { status: "pending", note: "" }; }
};

// State files are single-writer by construction (references/graph.md). A parallel worker that may
// write one turns "one owner per field" into a race whose loser is silently overwritten, so these
// are never claimable and never granted — the integrator writes them, alone, afterwards.
const RESERVED = ["feature_list.json", "progress.md", "session-handoff.md", "DECISIONS.md",
  "agents.manifest.json", "loop/**", "memory/**", "docs/assumptions.md", "docs/cross-cutting.md"]
  .map((g) => (HOME_REL ? `${HOME_REL}/${g}` : g));
// Granted to every worker regardless of its slice: append-only, per-event, no shared record.
// Project-relative, like every slice path, so a contained layout's harness/trace/** is named the
// way tools/guard-write.mjs will actually see it.
const ALWAYS_ALLOWED = [HOME_REL ? `${HOME_REL}/trace/**` : "trace/**"];

const die = (code, message) => { console.error(message); process.exit(code); };
const toRe = (g) => new RegExp("^" + g.split("**").map((s) =>
  s.split("*").map((x) => x.replace(/[.+^${}()|[\]\\]/g, "\\$&")).join("[^/]*")).join(".*") + "$");

// Two globs intersect when SOME path matches both — not only when a file that exists today does.
// Testing against the working tree alone passes a plan whose slices collide on the first file one
// of them creates, which is precisely when the collision costs a whole parallel iteration.
//
// Sampling witness paths out of one glob and testing them against the other is the obvious cheap
// version and it is wrong: `src/gen/**` and `src/**/model.ts` share `src/gen/model.ts`, and no
// witness of either pattern lands on it. So decide it exactly, by asking whether the two patterns
// can be satisfied by one string — segment by segment, with `**` free to consume any number of
// segments and `*` any number of characters inside one.
function segmentsIntersect(p, q) {
  const memo = new Map();
  const go = (i, j) => {
    const key = `${i},${j}`;
    if (memo.has(key)) return memo.get(key);
    let r;
    if (i === p.length && j === q.length) r = true;
    else if (i === p.length) r = [...q.slice(j)].every((c) => c === "*");
    else if (j === q.length) r = [...p.slice(i)].every((c) => c === "*");
    else if (p[i] === "*") r = go(i + 1, j) || go(i, j + 1);
    else if (q[j] === "*") r = go(i, j + 1) || go(i + 1, j);
    else r = p[i] === q[j] && go(i + 1, j + 1);
    memo.set(key, r);
    return r;
  };
  return go(0, 0);
}
function globsIntersect(a, b) {
  // `**` is only a segment wildcard when it IS the segment; anywhere else it is an ordinary `*`.
  const segs = (g) => g.split("/").map((x) => (x === "**" ? "**" : x.replaceAll("**", "*")));
  const A = segs(a), B = segs(b);
  const memo = new Map();
  const go = (i, j) => {
    const key = `${i},${j}`;
    if (memo.has(key)) return memo.get(key);
    let r;
    if (i === A.length && j === B.length) r = true;
    else if (i === A.length) r = B.slice(j).every((x) => x === "**");
    else if (j === B.length) r = A.slice(i).every((x) => x === "**");
    else if (A[i] === "**") r = go(i + 1, j) || go(i, j + 1);
    else if (B[j] === "**") r = go(i, j + 1) || go(i + 1, j);
    else r = segmentsIntersect(A[i], B[j]) && go(i + 1, j + 1);
    memo.set(key, r);
    return r;
  };
  return go(0, 0);
}

function treeFiles(dir = PROJECT_ROOT, prefix = "", out = []) {
  for (const entry of readdirSync(dir)) {
    if ([".git", "node_modules", "target", "build", "dist", ".venv"].includes(entry)) continue;
    const full = path.join(dir, entry), rel = prefix ? `${prefix}/${entry}` : entry;
    let s; try { s = statSync(full); } catch { continue; }
    if (s.isDirectory()) treeFiles(full, rel, out); else out.push(rel);
  }
  return out;
}

// The same notion of "a red run" verify-harness's evidence-no-red gate uses. Kept identical on
// purpose: a fan-out that recorded its red run in a shape only this tool recognised would satisfy
// the split gate and still trip the evidence gate later, which is worse than not checking.
const RED = /\b(red|fail(?:ed|ing|ure)?s?|exit(?:ed)? [1-9]|non-zero|assertion ?error|\u2717)\b/i;
function hasRed(f) {
  const runs = Array.isArray(f.evidence) ? f.evidence.filter((r) => r && typeof r === "object") : null;
  if (runs) return runs.some((r) => String(r.run || "").toLowerCase() === "red");
  return RED.test(String(f.evidence || ""));
}

function feature(id) {
  let list;
  try { list = JSON.parse(readFileSync(P("feature_list.json"), "utf8")); }
  catch (e) { die(2, `work-split: cannot read feature_list.json: ${e.message}`); }
  const f = (list.features || []).find((x) => x.id === id);
  if (!f) die(2, `work-split: unknown feature ${id}`);
  return f;
}

// The digest comes from review-contract.mjs rather than being recomputed here. One definition of
// "the feature contract" is the whole point: a second copy drifts, and a plan bound to a digest
// nobody else computes is bound to nothing.
function currentDigest(id) {
  // Exit 1 is the NORMAL case here: the feature has no reviewPacket yet, because the work that
  // would produce one has not been done. The digest is still on stdout, so read it from the throw
  // rather than treating a routine SUBMISSION_INCOMPLETE as "the digest cannot be computed".
  const parse = (out) => { try { return JSON.parse(out)[0]?.contractDigest || null; } catch { return null; } };
  try {
    return parse(execFileSync(process.execPath, [P("tools", "review-contract.mjs"), id, "--json"],
      { cwd: HOME, encoding: "utf8" }));
  } catch (e) { return parse(String(e.stdout || "")); }
}

function loadPlan(id) {
  const file = planPath(id);
  if (!existsSync(file)) die(4, `work-split: no plan at loop/work-split/${id}.json — run serially, or write one`);
  try { return JSON.parse(readFileSync(file, "utf8")); }
  catch (e) { die(2, `work-split: plan for ${id} is not valid JSON: ${e.message}`); }
}

function savePlan(id, plan) {
  writeFileSync(planPath(id), `${JSON.stringify(plan, null, 2)}\n`);
}

function validate(id) {
  const plan = loadPlan(id), errors = [], f = feature(id);
  const slices = Array.isArray(plan.slices) ? plan.slices : [];
  if (plan.kind !== "work-split/1") errors.push(`kind must be "work-split/1", got ${JSON.stringify(plan.kind)}`);
  if (plan.feature !== id) errors.push(`plan.feature is ${JSON.stringify(plan.feature)}, expected ${id}`);

  const digest = currentDigest(id);
  if (!digest) errors.push("cannot compute the feature contract digest — is tools/review-contract.mjs present?");
  else if (plan.contractDigest !== digest) {
    errors.push(`contractDigest is stale (plan ${String(plan.contractDigest).slice(0, 12)}, feature ` +
      `${digest.slice(0, 12)}). The behavior, verification, falsifier, dependencies or context changed ` +
      `after the split was drawn; re-cut the slices against what the feature says now.`);
  }

  // One slice is not a fan-out, it is a serial iteration with extra bookkeeping. Say so rather
  // than spawning a single worker and calling the machinery exercised.
  if (slices.length < 2) errors.push(`a fan-out needs at least 2 slices, got ${slices.length} — do this feature serially`);

  const shared = Array.isArray(plan.sharedContracts) ? plan.sharedContracts.filter((s) => String(s).trim()) : [];
  if (!shared.length) {
    errors.push(`sharedContracts must be a non-empty list: name every symbol the slices code against as ` +
      `"<symbol> @ <path>", or state "none: <why these slices share nothing>". Two agents building ` +
      `against an interface neither of them wrote down is the defect this field exists to prevent.`);
  }
  for (const entry of shared) {
    const text = String(entry);
    if (/^none:/.test(text)) continue;
    const at = text.split("@").pop().trim().split("#")[0];
    if (!at || !cited(at)) errors.push(`sharedContracts entry "${text}" cites ${at || "no path"}, which does not exist`);
  }

  const seen = new Set();
  for (const s of slices) {
    const sid = String(s?.id || "").trim();
    const tag = sid || "<unnamed slice>";
    if (!sid) errors.push("every slice needs an id");
    else if (seen.has(sid)) errors.push(`duplicate slice id ${sid}`);
    seen.add(sid);
    if (Array.isArray(s?.dependsOn) && s.dependsOn.length) {
      errors.push(`${tag}: dependsOn ${s.dependsOn.join(", ")} — slices run at the same time, so one that ` +
        `waits on another is not a slice. Sequence it inside one slice, or split the feature instead.`);
    }
    // Self-containment. Each missing field below is a question the worker would have to ask, and a
    // parallel worker has nobody to ask: it either stalls or invents an answer.
    for (const [field, ok] of [
      ["intent", String(s?.intent || "").trim().length >= 20],
      ["acceptance", String(s?.acceptance || "").trim().length >= 20],
      ["verification", String(s?.verification || "").trim().length > 0],
    ]) if (!ok) errors.push(`${tag}: ${field} is missing or too thin to work from without asking a question`);

    const mustRead = Array.isArray(s?.mustRead) ? s.mustRead : [];
    if (!mustRead.length) errors.push(`${tag}: mustRead is empty — name the sources that make this slice decidable`);
    for (const r of mustRead) {
      const file = String(r).split("#")[0];
      if (!cited(file)) errors.push(`${tag}: mustRead cites ${file}, which does not exist`);
    }

    const paths = Array.isArray(s?.paths) ? s.paths.map(String) : [];
    if (!paths.length) errors.push(`${tag}: paths is empty — a slice with no write surface cannot be confined`);
    for (const g of paths) {
      if (g.startsWith("/") || g.includes("..")) errors.push(`${tag}: path ${g} leaves the project`);
      const clash = RESERVED.find((r) => globsIntersect(g, r));
      if (clash) {
        errors.push(`${tag}: path ${g} reaches ${clash}, which is single-writer shared state. Parallel ` +
          `workers may not write it; the integrator records the whole feature's state afterwards.`);
      }
    }
  }

  // The load-bearing check. Everything above is hygiene; this is what makes the fan-out safe.
  const files = treeFiles();
  for (let i = 0; i < slices.length; i++) {
    for (let j = i + 1; j < slices.length; j++) {
      const [a, b] = [slices[i], slices[j]];
      for (const ga of (a?.paths || []).map(String)) {
        for (const gb of (b?.paths || []).map(String)) {
          const existing = files.filter((f2) => toRe(ga).test(f2) && toRe(gb).test(f2));
          if (existing.length) {
            errors.push(`${a.id} and ${b.id} both claim ${existing.slice(0, 3).join(", ")}` +
              `${existing.length > 3 ? ` (+${existing.length - 3} more)` : ""} — two makers editing one file ` +
              `is the merge conflict nobody asked for.`);
          } else if (globsIntersect(ga, gb)) {
            errors.push(`${a.id} (${ga}) and ${b.id} (${gb}) overlap for any file either one creates — ` +
              `no such file exists yet, which is why this has to be caught now and not at merge time.`);
          }
        }
      }
    }
  }

  // The red run has to happen BEFORE the fan-out, because after it there is nowhere left to put it:
  // the slices each run their own narrower command, and the integrator's first run of the feature
  // verification is green by construction. A feature that reaches done having never been seen to
  // fail is the exact hole verify-harness's evidence-no-red gate exists to report.
  if (!hasRed(f)) {
    errors.push(`${id} has no red run on record. Run \`${f.verification || f.verify || "the feature verification"}\` ` +
      `now, while the behavior is still absent, and record the failure in evidence — then split. ` +
      `After the slices land nobody can produce that run any more: each worker verifies only its own ` +
      `slice, and the integrator arrives to code that already works. If it passes now, the behavior ` +
      `already exists and there is nothing to fan out.`);
  }

  const integration = plan.integration || {};
  if (!String(integration.verification || "").trim()) {
    errors.push(`integration.verification is missing — after the slices land, ONE maker runs the whole ` +
      `feature's verification. Per-slice green does not compose into a feature-level claim.`);
  } else if (integration.verification !== (f.verification || f.verify)) {
    errors.push(`integration.verification is ${JSON.stringify(integration.verification)} but the feature's ` +
      `verification is ${JSON.stringify(f.verification || f.verify || "")} — the fan-in must run the ` +
      `command the review contract will demand, not a cheaper one.`);
  }

  plan.validation = errors.length
    ? { status: "invalid", at: new Date().toISOString(), errors }
    : { status: "valid", at: new Date().toISOString(), contractDigest: digest, slices: slices.length };
  savePlan(id, plan);
  // A re-cut plan starts from pending. Leaving last round's statuses behind would mark a slice
  // complete against a brief that no longer exists.
  if (!errors.length) for (const s of slices) rmSync(statusPath(id, s?.id), { force: true });

  if (JSON_OUT) { process.stdout.write(JSON.stringify({ feature: id, ...plan.validation }, null, 2) + "\n"); }
  else if (errors.length) {
    for (const e of errors) console.error(`SPLIT_REJECTED: ${e}`);
    console.error(`\n${errors.length} problem(s). Fix the plan, or drop it and advance ${id} serially — ` +
      `a serial iteration is a normal outcome, not a failure.`);
  } else {
    console.log(`SPLIT_ADMITTED: ${id} — ${slices.length} disjoint slices, fan-in on \`${integration.verification}\``);
  }
  return errors.length ? 1 : 0;
}

function requireValid(id) {
  const plan = loadPlan(id);
  if (plan?.validation?.status !== "valid") {
    die(4, `work-split: the plan for ${id} has not passed validation — run: node tools/work-split.mjs validate ${id}`);
  }
  return plan;
}

function slice(plan, sid) {
  const s = (plan.slices || []).find((x) => String(x.id) === String(sid));
  if (!s) die(2, `work-split: ${plan.feature} has no slice ${sid} (have: ${(plan.slices || []).map((x) => x.id).join(", ")})`);
  return s;
}

function brief(id, sid) {
  const plan = requireValid(id), s = slice(plan, sid), f = feature(id);
  const L = [
    `# Slice ${s.id} of ${id} — you are one of ${plan.slices.length} makers running at the same time`,
    ``,
    `**Feature behavior:** ${f.behavior || "(none recorded)"}`,
    `**Your slice:** ${s.intent}`,
    `**Done when:** ${s.acceptance}`,
    ``,
    `## You may write ONLY these paths`,
    ...s.paths.map((p) => `- \`${p}\``),
    ``,
    `Every other path belongs to another slice or to shared state, and the guard will deny it. That`,
    `is not an obstacle to route around: a write outside your slice is a write into somebody else's`,
    `file while they are in it.`,
    ``,
    `## Read these before you start`,
    ...s.mustRead.map((r) => `- \`${r}\``),
    ``,
    `## Interfaces every slice codes against`,
    ...plan.sharedContracts.map((c) => `- ${c}`),
    ``,
    `## Verify your slice`,
    ``,
    `    ${s.verification}`,
    ``,
    `Red first, then green — the red run is the only cheap proof your test can fail at all. Someone`,
    `else runs \`${plan.integration.verification}\` for the whole feature after every slice lands;`,
    `that is the feature-level claim, and it is not yours to make.`,
    ``,
    `## Rules for a parallel worker`,
    ``,
    `- **Do not ask a question.** Nobody is listening; this brief is the whole context you get.`,
    `  If it genuinely does not decide something you need, stop and run:`,
    `  \`node tools/work-split.mjs fail ${id} ${s.id} --note "UNDERSPECIFIED: <the question>"\``,
    `  A recorded question is worth more than a guess that compiles.`,
    `- **Do not write \`feature_list.json\`, \`progress.md\` or anything under \`loop/\`.** The`,
    `  integrator records the feature's state once, after all slices are in.`,
    `- **Do not set \`readyForCheck\`, \`status\` or evidence.** Your slice is not the feature.`,
    `- **Do not run the feature-level verification.** N workers running one suite at once is how a`,
    `  shared port, a shared database or a shared temp directory turns a green feature red.`,
    `- When your slice is done and its own verification is green:`,
    `  \`node tools/work-split.mjs complete ${id} ${s.id} --note "<what landed, in one line>"\``,
    ``,
  ];
  process.stdout.write(L.join("\n"));
  return 0;
}

function transition(id, sid, next) {
  slice(requireValid(id), sid);            // the slice must exist in an admitted plan
  const at = new Date().toISOString();
  const record = { feature: id, slice: sid, status: next, note, at };
  writeFileSync(statusPath(id, sid), `${JSON.stringify(record, null, 2)}\n`);
  appendFileSync(P("loop", "work-split-log.jsonl"), `${JSON.stringify(record)}\n`);
  console.log(`${id}/${sid} → ${next}${note ? ` (${note})` : ""}`);
  return 0;
}

function status(id) {
  const plan = loadPlan(id);
  const rows = (plan.slices || []).map((s) => {
    const st = sliceStatus(id, s.id);
    return { id: s.id, status: st.status || "pending", note: st.note || "" };
  });
  const counts = rows.reduce((acc, r) => ({ ...acc, [r.status]: (acc[r.status] || 0) + 1 }), {});
  const out = { feature: id, validation: plan.validation?.status || "unvalidated", counts, slices: rows };
  if (JSON_OUT) { process.stdout.write(JSON.stringify(out, null, 2) + "\n"); return 0; }
  console.log(`${id}: ${plan.validation?.status || "unvalidated"} — ` +
    Object.entries(counts).map(([k, v]) => `${v} ${k}`).join(", "));
  for (const r of rows) console.log(`  ${r.status.padEnd(9)} ${r.id}${r.note ? `  ${r.note}` : ""}`);
  return 0;
}

switch (command) {
  case "validate": if (!featureId) die(2, "usage: work-split.mjs validate <feat-id>"); process.exit(validate(featureId));
  case "brief": if (!sliceId) die(2, "usage: work-split.mjs brief <feat-id> <slice-id>"); process.exit(brief(featureId, sliceId));
  case "paths": {
    if (!sliceId) die(2, "usage: work-split.mjs paths <feat-id> <slice-id>");
    const s = slice(requireValid(featureId), sliceId);
    process.stdout.write([...s.paths, ...ALWAYS_ALLOWED].join("\n") + "\n");
    process.exit(0);
  }
  case "status": if (!featureId) die(2, "usage: work-split.mjs status <feat-id>"); process.exit(status(featureId));
  case "start": case "complete": case "fail":
    if (!sliceId) die(2, `usage: work-split.mjs ${command} <feat-id> <slice-id> [--note "<text>"]`);
    process.exit(transition(featureId, sliceId, { start: "running", complete: "complete", fail: "failed" }[command]));
  default:
    die(2, "usage: work-split.mjs validate|brief|paths|status|start|complete|fail <feat-id> [<slice-id>]");
}
