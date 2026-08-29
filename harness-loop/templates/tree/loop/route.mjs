#!/usr/bin/env node
// route.mjs — the routing table, as executable code instead of prose.
//
// Before this existed, `run-loop.sh` dispatched three nodes (maker, --promote, checker) while the
// prompts described eleven. The other eight were reachable only by a human reading a report and
// typing `kiro-cli chat --agent …`. Worse, three of those unrouted edges composed into a livelock:
// a feature marked `NEEDS DESIGN:` is neither done nor blocked, so the loop's all-settled check
// never fires, and the maker is instructed to skip it — so every iteration spawned a paid session
// that changed nothing, and every log line looked healthy (references/graph.md).
//
// A rollback is not "go back one step". It names the LAYER the defect came from — decomposition,
// design, spec, implementation — and returns there. That attribution is what the marker carries.
//
// Usage:
//   node loop/route.mjs                 # print the next node + why (human-readable)
//   node loop/route.mjs --json          # same, machine-readable
//   node loop/route.mjs --agent         # print just the agent name, or nothing when it is code
//   node loop/route.mjs --rules         # the whole routing table, in precedence order
import { readFileSync, existsSync, readdirSync, statSync, writeSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
// A directory literally named "harness" is not proof of a contained layout (the harness-loop
// skill's own repo is named "harness" and is flat) — only the thin root AGENTS.md a contained
// scaffold writes is (HI-055). Require both.
const PROJECT_ROOT = path.basename(ROOT) === "harness" && existsSync(path.join(path.dirname(ROOT), "AGENTS.md"))
  ? path.dirname(ROOT) : ROOT;
process.chdir(ROOT);

// stdout on a pipe is async: process.exit() drops whatever has not flushed, so a payload
// past the pipe buffer (~8 KB on macOS) is silently truncated for any caller using
// spawnSync. Found when aeron-demo's report crossed that line and adoption-baseline
// started failing to parse its own input. writeSync is the fix everywhere --json exits.
const args = process.argv.slice(2);
const JSON_OUT = args.includes("--json");
const AGENT_ONLY = args.includes("--agent");
const read = (p) => { try { return readFileSync(p, "utf8"); } catch { return ""; } };
const readJSON = (p) => { try { return JSON.parse(readFileSync(p, "utf8")); } catch { return null; } };
const has = (p) => existsSync(p);
const lsSafe = (d) => { try { return readdirSync(d); } catch { return []; } };
// An agent exists if EITHER runtime has it — both are generated from agents.manifest.json.
// All three runtimes. Missing codex here meant that on a codex-only target every agent rule
// evaluated to false and the router fell through to `human` with work plainly available.
const hasAgent = (name) => existsSync(path.join(PROJECT_ROOT, `.kiro/agents/${name}.json`)) ||
  existsSync(path.join(PROJECT_ROOT, `.claude/agents/${name}.md`)) ||
  existsSync(path.join(PROJECT_ROOT, `.codex/agents/${name}.toml`));
// A NEEDS DESIGN: marker lives in feature_list.json, which the designer is forbidden to write — it
// may not write scope. So the node that answers the question cannot clear the flag that asked it,
// and a rule keyed only on "marker present" re-dispatches the designer forever (observed on
// aeron-demo: the designer settled feat-sit-2 in DECISIONS.md and the router kept naming it).
//
// The first fix keyed on "does a design document mention this feature, and when" — a proxy for
// "answered". Too loose: the test-designer then raised a NEW question on the same feature, the old
// answer still mentioned it, and the router escalated a live question to a human. A file mention
// cannot tell you WHICH question was answered.
//
// So route on what actually happened instead: dispatch history. loop/run-loop.mjs appends every
// (node, feature, marker) it dispatches to loop/route-log.jsonl, and the marker is identified by a
// hash of its own text — a new question is a new hash, and the ladder restarts for it.
const markerHash = (text) => createHash("sha1").update(String(text || "").trim()).digest("hex").slice(0, 12);
const ROUTE_LOG = (() => {
  const raw = read("loop/route-log.jsonl");
  if (!raw) return [];
  return raw.split("\n").filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
})();
const alreadyDispatched = (node, feature, hash) =>
  ROUTE_LOG.some((e) => e.node === node && e.feature === feature && e.hash === hash);
const requestDispatched = (requestId, node) =>
  ROUTE_LOG.some((e) => e.requestId === requestId && e.node === node);
// The test-designer's second output. A DIRECTORY is not an output: on aeron-demo tests/design/
// held a plan.json and an empty conditions/ folder, so this returned true, the router dispatched
// test-implementer, and it correctly refused — twice, two paid sessions for nothing. Count the
// condition FILES.
const conditionsExist = () => {
  const walk = (dir, depth = 4) => {
    if (depth < 0) return false;
    for (const e of lsSafe(dir)) {
      const p = `${dir}/${e}`;
      if (/^TCON-.*\.json$/.test(e)) return true;
      let isDir = false;
      try { isDir = statSync(p).isDirectory(); } catch { continue; }
      if (isDir && walk(p, depth - 1)) return true;
    }
    return false;
  };
  return walk("tests/design");
};
// Which INV- ids a falsifier cites — same pattern verify-harness.mjs's invariant-uncovered gate
// uses, so a falsifier and a design doc are read the same way everywhere in this codebase.
const citedInvariants = (text) => [...new Set([...String(text || "").matchAll(/\bINV-[A-Z]+-\d+\b/g)].map((m) => m[0]))];
// Every requirement_id any TCON-*.json anywhere under tests/design actually cites. Existence alone
// (conditionsExist()) answers "has this project designed ANY test, ever" — it does not answer
// "does THIS falsifier's citation have a condition behind it". Those diverge the moment a falsifier
// is amended (a design amendment adds an invariant, feature-planner cites it) after conditions were
// already written for the pre-amendment falsifier: conditionsExist() stays true, the router jumps
// straight to test-implementer, and the amendment ships with zero test coverage. Found live on
// examples/jdt-mcp-server.
const conditionCitations = () => {
  const ids = new Set();
  const walk = (dir, depth = 4) => {
    if (depth < 0) return;
    for (const e of lsSafe(dir)) {
      const p = `${dir}/${e}`;
      if (/^TCON-.*\.json$/.test(e)) {
        const j = readJSON(p);
        if (j && j.requirement_id) ids.add(j.requirement_id);
        continue;
      }
      let isDir = false;
      try { isDir = statSync(p).isDirectory(); } catch { continue; }
      if (isDir) walk(p, depth - 1);
    }
  };
  walk("tests/design");
  return ids;
};
const conditionIds = () => {
  const ids = new Set();
  const walk = (dir, depth = 4) => {
    if (depth < 0) return;
    for (const e of lsSafe(dir)) {
      const p = `${dir}/${e}`;
      if (/^TCON-.*\.json$/.test(e)) {
        const j = readJSON(p);
        if (j && j.id) ids.add(j.id);
        continue;
      }
      let isDir = false;
      try { isDir = statSync(p).isDirectory(); } catch { continue; }
      if (isDir) walk(p, depth - 1);
    }
  };
  walk("tests/design");
  return ids;
};
// Conditions are a feature-owned handoff. Conditions for another prove feature must not make
// this one eligible for implementation (HI-072).
const featureConditionsComplete = (feature) => {
  const ids = Array.isArray(feature.conditions) ? feature.conditions : [];
  if (!ids.length) return false;
  const available = conditionIds();
  const citations = conditionCitations();
  return ids.every((id) => available.has(id) || citations.has(id));
};

const fl = readJSON("feature_list.json");
const features = (fl && fl.features) || [];
const notes = (f) => String(f.checkerNotes || "").trim();
// The routing marker is the first line by contract. Diagnostic notes appended below it must not
// create a new request identity and restart an already-spent escalation ladder.
const marker = (f) => notes(f).split("\n")[0].trim();
const status = (f) => String(f.status || f.state || "");
const open = features.filter((f) => !["done", "passing"].includes(status(f)));
// A complete maker handoff is enough to unblock downstream implementation. Semantic acceptance
// is deliberately deferred until every remaining feature has been handed off, so the checker
// reviews the integrated delivery once instead of becoming an inner-loop hop after each feature.
const handedOff = (f) => ["done", "passing"].includes(status(f)) || f?.readyForCheck === true;
// A parallel maker iteration, if one has been planned and admitted (tools/work-split.mjs). The
// router reads the plan's own validation receipt rather than re-deriving disjointness here: the
// router is pure and cheap by contract, and disjointness needs the working tree. The receipt is
// written only by `work-split.mjs validate`, and every slice transition re-checks it, so a plan the
// router calls valid is one a code node said so about.
const workSplit = (f) => {
  const plan = readJSON(`loop/work-split/${f.id}.json`);
  if (!plan || plan.kind !== "work-split/1" || plan.validation?.status !== "valid") return null;
  const slices = Array.isArray(plan.slices) ? plan.slices : [];
  if (!slices.length) return null;
  // One status file per slice, written only by that slice's own worker — never a shared field in
  // the plan, which several workers would read-modify-write at once. Keep this in step with
  // tools/work-split.mjs's statusPath().
  const recorded = (s) => readJSON(`loop/work-split/${f.id}.${s.id}.json`) || { status: "pending" };
  const seen = slices.map((s) => ({ id: s.id, ...recorded(s) }));
  return { plan, slices,
    failed: seen.filter((s) => s.status === "failed"),
    outstanding: seen.filter((s) => !["complete", "failed"].includes(String(s.status || "pending"))) };
};
// Only a feature the maker could pick anyway may drive a fan-out: a marker or a blocked status
// outranks the split, exactly as it outranks a serial maker turn.
const splitEligible = () => open.filter((f) => f.readyForCheck !== true &&
  !/^NEEDS (DESIGN|RE-PLAN|ORACLE FIX):/.test(notes(f)) && status(f) !== "blocked");

const designDigest = () => {
  const parts = [];
  for (const f of lsSafe("docs/design").filter((x) => x.endsWith(".md") && x.toLowerCase() !== "readme.md").sort()) {
    parts.push(f, read(`docs/design/${f}`));
  }
  return parts.length ? createHash("sha256").update(parts.join("\0")).digest("hex").slice(0, 16) : "";
};

// Routing rules, highest precedence first. Each returns {node, kind, layer, why, feature}.
// Precedence is deliberate: a question about the SPEC outranks one about the DESIGN, which
// outranks one about the CUT, which outranks implementation — because answering the deeper one
// can dissolve the shallower ones, and doing it the other way round wastes the work.
const RULES = [
  {
    node: "feature-planner", kind: "agent", layer: "decomposition",
    when: "a done feature carries a FOLLOW-UP: marker that has not been planned",
    match: () => {
      const f = features.find((x) => status(x) === "done" && /^FOLLOW-UP:/.test(marker(x)) &&
        !requestDispatched(`follow-up:${x.id}:${markerHash(marker(x))}`, "feature-planner"));
      return f ? { why: `${f.id} was approved with actionable follow-up work; turn it into explicit scope or record why it is discarded`, feature: f.id, detail: marker(f), requestId: `follow-up:${f.id}:${markerHash(marker(f))}` } : null;
    },
  },
  {
    node: "maker", kind: "agent", layer: "baseline",
    when: "the recorded baseline is red and this exact failure has not had one repair turn",
    match: () => {
      const b = readJSON("loop/baseline-state.json");
      if (!b || b.status !== "red" || !b.evidenceDigest) return null;
      const requestId = `baseline:${b.evidenceDigest}`;
      if (requestDispatched(requestId, "maker")) {
        return { node: "human", kind: "human", layer: "baseline", why: "the baseline is unchanged after one bounded repair turn", requestId };
      }
      return { why: "the baseline is red — repair the gate before feature work", requestId };
    },
  },
  {
    node: "human", kind: "human", layer: "spec",
    when: "a docs/assumptions.md row is still needs-human",
    // The one condition that is supposed to STOP the loop. It could not, before this file.
    match: () => {
      const withoutExamples = read("docs/assumptions.md").replace(/<!--[\s\S]*?-->/g, "");
      const rows = withoutExamples.split("\n")
        .filter((l) => l.startsWith("|") && /needs-human/i.test(l));
      return rows.length ? { why: `${rows.length} assumption(s) are needs-human — continue in the current conversation with the user-scope human-interview skill; do not dispatch another agent`, detail: rows[0].slice(0, 160) } : null;
    },
  },
  {
    node: "design-facilitator", kind: "agent", layer: "design",
    when: "a feature's checkerNotes starts NEEDS DESIGN: and the design-facilitator has not had a turn on that marker",
    match: () => {
      // Only until the design-facilitator has had its turn on THIS marker. Its answer cannot clear
      // the marker, so "marker still present" is not evidence that it failed to answer.
      const f = open.find((x) => /^NEEDS DESIGN:/.test(marker(x)) &&
        !alreadyDispatched("design-facilitator", x.id, markerHash(marker(x))));
      return f ? { why: `${f.id} raised a design question the maker is forbidden to answer inline`, feature: f.id, detail: notes(f).split("\n")[0] } : null;
    },
  },
  {
    node: "design-facilitator", kind: "agent", layer: "design",
    when: "docs/design/*.md collectively state no observable seam or no invariants",
    // Same predicate as verify-harness's design-untestable gate. Without this rule the router
    // matched only the NEEDS DESIGN: marker, so a design that simply never said how anyone would
    // know the thing works did not register as a design problem at all — and the loop went
    // straight to the oracle layer to derive falsifiers from invariants nobody had written.
    // That is the router jumping its own deeper-first precedence (HI-014, found on aeron-demo).
    //
    // Checked across the WHOLE folder, not file-by-file: a design split into topic files (claims
    // table, components, critique) legitimately has files that mention neither word on their own —
    // e.g. a critique.md about premises and premortems has no reason to say "seam". Per-file
    // checking flagged a real, complete design as broken the first time a design-facilitator split
    // one across topic files (examples/jdt-mcp-server, found live). The `why` text already said
    // "nothing downstream can derive a falsifier from it" — that claim is about the design as a
    // whole, so the check now matches what it always claimed to test.
    match: () => {
      const SEAM = /\b(seam|observable|observability|from outside|externally visible)\b/i;
      const INV = /\b(invariant|always|never|for every|conserv|idempoten|monotonic|round[- ]trip)\b/i;
      const files = lsSafe("docs/design").filter((x) => x.endsWith(".md") && x.toLowerCase() !== "readme.md");
      const substantive = files.filter((f) => (read(`docs/design/${f}`) || "").trim().length >= 200);
      if (!substantive.length) return null;                   // stubs are not designs
      const combined = substantive.map((f) => read(`docs/design/${f}`)).join("\n");
      const missing = [!SEAM.test(combined) && "no observable seam", !INV.test(combined) && "no invariants"].filter(Boolean);
      if (missing.length) {
        return { why: `docs/design/*.md collectively state ${missing.join(" and ")} — nothing downstream can derive a falsifier from it`, detail: substantive.join(", ") };
      }
      return null;
    },
  },
  {
    // Replaces what used to be two rules: `designer` bounced off a typed `rejected` verdict from
    // `design-reviewer`, and back again, each round burning a paid session and neither agent having
    // the business context to know when the design was actually done — a design that changed even
    // slightly got a new digest, which reset the one-bounded-retry counter, so the loop never
    // reliably converged and never reliably escalated either. There is no retry counter here because
    // there is no auto-loop to bound: this rule always routes to `human`, never back to an agent, and
    // stays that way until a human writes the approval themselves.
    node: "human", kind: "human", layer: "design",
    when: "a design revision exists and has no human approval matching its current digest",
    match: () => {
      const digest = designDigest();
      if (!digest) return null;
      const approval = readJSON("loop/design-approval.json");
      // The digest match IS the invalidation mechanism: edit the design after it was approved, even
      // a one-line edit, and the digest changes, so a stale approval simply stops matching — no
      // separate "expire the old approval" step exists or is needed.
      if (approval && approval.status === "approved" && approval.designDigest === digest) return null;
      return { why: `docs/design/* revision ${digest} has no human approval on record — decomposition, the oracle layer, and implementation all stay blocked until loop/design-approval.json names this exact digest`, detail: digest };
    },
  },
  {
    node: "feature-planner", kind: "agent", layer: "decomposition",
    when: "a NEEDS DESIGN: marker the design-facilitator has already had a turn on — the planner must clear it",
    // The design-facilitator answered; someone has to retire the marker and re-cut if the answer
    // changed the scope. That is the planner: it is the one node downstream of design allowed to
    // write feature_list.json.
    match: () => {
      const f = open.find((x) => {
        const h = markerHash(marker(x));
        return /^NEEDS DESIGN:/.test(marker(x)) && alreadyDispatched("design-facilitator", x.id, h) &&
          !alreadyDispatched("feature-planner", x.id, h);
      });
      return f ? { why: `${f.id}'s NEEDS DESIGN: already went to the design-facilitator and the marker is still there — it cannot clear the marker itself. Consume the answer, re-cut if it changed the scope, and clear the marker`, feature: f.id, detail: notes(f).split("\n")[0] } : null;
    },
  },
  {
    node: "human", kind: "human", layer: "decomposition",
    when: "the same marker after both the design-facilitator and the planner have had a turn — nobody else can clear it",
    // Terminating case. Without it the previous rule is just a different livelock: the planner runs,
    // makes feature_list.json the newest file, does NOT clear the marker, and the answer is no
    // longer "newer" — so the design-facilitator rule takes over again. Nobody is left to route to,
    // so say so instead of spending another session.
    match: () => {
      const f = open.find((x) => {
        const h = markerHash(marker(x));
        return /^NEEDS DESIGN:/.test(marker(x)) && alreadyDispatched("design-facilitator", x.id, h) &&
          alreadyDispatched("feature-planner", x.id, h);
      });
      return f ? { why: `${f.id} still carries the SAME NEEDS DESIGN: marker after both the design-facilitator and the planner have had a turn on it. Nobody else can clear it. Clear it by hand, or say why it is still open.`, feature: f.id, detail: notes(f).split("\n")[0] } : null;
    },
  },
  {
    node: "feature-planner", kind: "agent", layer: "decomposition",
    when: "a feature's checkerNotes starts NEEDS RE-PLAN:",
    match: () => {
      const f = open.find((x) => /^NEEDS RE-PLAN:/.test(marker(x)));
      if (!f) return null;
      const requestId = `replan:${f.id}:${markerHash(marker(f))}`;
      if (requestDispatched(requestId, "feature-planner")) {
        return { node: "human", kind: "human", layer: "decomposition", why: `${f.id} still carries the same NEEDS RE-PLAN marker after the planner ran`, feature: f.id, requestId };
      }
      return { why: `${f.id} was ruled mis-cut by the checker; re-cutting is not the maker's job`, feature: f.id, detail: marker(f), requestId };
    },
  },
  {
    node: "feature-planner", kind: "agent", layer: "decomposition",
    when: "a design's ## Feature impact table marks change/new and is newer than feature_list.json",
    // A design that changes what a feature means, or implies new ones, leaves feature_list.json a
    // version behind — and nothing marks it, because the designer is (correctly) not allowed to
    // write scope. So route on what it CAN write: its own `## Feature impact` table. Without this
    // the router jumped decomposition and sent the oracle layer to write falsifiers for features
    // that were about to be re-cut.
    match: () => {
      // Narrow, deliberately: a blanket catch here once swallowed a ReferenceError (statSync was
      // unimported) and the rule silently never fired. Only a missing file is an expected miss.
      let fl = 0;
      try { fl = statSync("feature_list.json").mtimeMs; }
      catch (e) { if (e.code === "ENOENT") return null; throw e; }
      for (const f of lsSafe("docs/design").filter((x) => x.endsWith(".md") && x.toLowerCase() !== "readme.md")) {
        let st;
        try { st = statSync(`docs/design/${f}`); }
        catch (e) { if (e.code === "ENOENT") continue; throw e; }
        if (st.mtimeMs <= fl) continue;                 // planner already caught up
        const text = read(`docs/design/${f}`) || "";
        // Line-based, not a two-column regex: an id-then-verdict pattern broke the first time a
        // facilitator wrote `feat-002` (placeholder) | change (an annotation after the id) or
        // *(new)* `mcp-shim`, `daemon-supervisor`, ... | new (a bundle of many new components in
        // one row) — both real, reasonable ways to write this table that a strict per-cell regex
        // rejected. Found live on examples/jdt-mcp-server. A row only needs to: live under the
        // `## Feature impact` heading, start with `|`, not be the separator row, and say
        // change/new somewhere in it.
        const section = text.split(/^## /m).find((s) => /^Feature impact\b/i.test(s)) || "";
        const rows = section.split("\n").filter((l) => {
          const t = l.trim();
          return t.startsWith("|") && !/^[|\-\s]+$/.test(t) && /\b(change|new)\b/i.test(t);
        });
        if (rows.length) {
          const ids = [...new Set(rows.flatMap((l) => [...l.matchAll(/`([\w.-]+)`/g)].map((m) => m[1])))].slice(0, 6);
          return { why: `docs/design/${f} marks ${rows.length} feature(s) change/new and is newer than feature_list.json — the cut has not caught up with the design`, detail: ids.join(", ") || f };
        }
      }
      return null;
    },
  },
  {
    // The eighth implicit edge. A `prove` feature's oracle can be wrong — the assertion contradicts
    // the validated condition it was written from — and until now nothing could fix it. The
    // test-implementer rule below keys on empty `evidence` to tell "not written yet" from
    // "written", so a project that authors oracles BEFORE the implementation (and records the red
    // run, as it must) puts the feature permanently out of that rule's reach; the maker prompt
    // forbids the maker touching an oracle-layer test; and the checker may not write test files.
    // Observed on examples/jdt-mcp-server: the fix was a hand-written bounded edit permission in
    // checkerNotes, re-invented per occurrence. This makes it a state instead of a convention.
    node: "test-implementer", kind: "agent", layer: "oracle",
    when: "a feature's checkerNotes starts NEEDS ORACLE FIX: — the oracle contradicts its own condition",
    match: () => {
      if (!hasAgent("test-implementer")) return null;
      const f = open.find((x) => /^NEEDS ORACLE FIX:/.test(marker(x)) && status(x) !== "blocked");
      if (!f) return null;
      const hash = markerHash(marker(f));
      // Same bounded ladder as every other marker: one turn, then a human. An oracle the
      // implementer could not reconcile with its condition is a question about the condition.
      if (alreadyDispatched("test-implementer", f.id, hash)) {
        return { node: "human", kind: "human", layer: "oracle",
          why: `${f.id} still carries the same NEEDS ORACLE FIX marker after one test-implementer turn — the condition itself may be wrong`,
          feature: f.id };
      }
      return { why: `${f.id}: the checker ruled the red comes from the oracle, not the implementation`, feature: f.id };
    },
  },
  {
    node: "test-designer", kind: "agent", layer: "oracle",
    when: "an unfinished feature has no falsifier, or its falsifier cites an invariant no test condition covers",
    // Three outputs to check, not two: the `falsifier` in feature_list.json, whether ANY condition
    // files exist under tests/design/ at all, and — the newest of the three — whether the SPECIFIC
    // invariants this falsifier cites are the ones conditions were written against. The first two
    // were already learned the hard way (aeron-demo: falsifier missing entirely; a project deriving
    // falsifiers from the invariant contract never tripped the old rule, so tests/design/ was never
    // created and test-implementer hunted for conditions that did not exist). The third: a design
    // amendment adds an invariant, feature-planner cites it in the falsifier, but conditions written
    // BEFORE the amendment still only cover the original ones — conditionsExist() stays true (some
    // TCON-*.json exist, just not for the new citation), so the router jumped straight past
    // test-designer to test-implementer, which would have implemented tests for the old conditions
    // and silently shipped the amendment with zero coverage. Found live on examples/jdt-mcp-server.
    // A node handed a missing input does not fail; it improvises or stalls.
    match: () => {
      const missing = open.filter((x) => !String(x.falsifier || "").trim());
      if (missing.length && hasAgent("test-designer")) {
        return { why: `${missing.length} unfinished feature(s) have no falsifier — nobody has said what wrong implementation their verification catches`, feature: missing[0].id };
      }
      if (!hasAgent("test-designer")) return null;
      const candidates = open.filter((x) => x.kind === "prove" && String(x.falsifier || "").trim() &&
        !String(x.evidence || "").trim());
      if (!candidates.length) return null;
      const missingFeature = candidates.find((x) => !featureConditionsComplete(x));
      if (missingFeature) {
        const requestId = `test-design:${missingFeature.id}:${markerHash(String(missingFeature.falsifier))}`;
        if (requestDispatched(requestId, "test-designer")) {
          return { node: "human", kind: "human", layer: "oracle", why: `${missingFeature.id} still has no feature-linked validated conditions after one test-designer turn`, feature: missingFeature.id, requestId };
        }
        return { why: `${missingFeature.id} has no complete feature-linked condition plan yet`, feature: missingFeature.id, requestId };
      }
      // Guard against the livelock this rule could otherwise create: if test-designer has already
      // been sent here for this feature and tests/design/ is STILL absent, that is a human problem,
      // not another session. The marker is written below via `why`, and checkerNotes carries it.
      if (!conditionsExist()) {
        const f = candidates[0];
        const requestId = `test-design:${f.id}:${markerHash(String(f.falsifier))}`;
        if (requestDispatched(requestId, "test-designer")) {
          return { node: "human", kind: "human", layer: "oracle", why: `${f.id} still has no validated conditions after one test-designer turn`, feature: f.id, requestId };
        }
        return { why: `no validated test condition (TCON-*.json) exists yet, so ${f.id} has a falsifier but nothing to implement from`, feature: f.id, requestId };
      }
      const citedIds = conditionCitations();
      for (const f of candidates) {
        const uncovered = citedInvariants(f.falsifier).filter((id) => !citedIds.has(id));
        if (!uncovered.length) continue;
        const requestId = `test-design:${f.id}:${markerHash(String(f.falsifier))}`;
        if (requestDispatched(requestId, "test-designer")) {
          return { node: "human", kind: "human", layer: "oracle", why: `${f.id}'s falsifier still cites ${uncovered.join(", ")} with no matching test condition after one test-designer turn`, feature: f.id, requestId };
        }
        return { why: `${f.id}'s falsifier cites ${uncovered.join(", ")} but no test condition covers ${uncovered.length > 1 ? "them" : "it"} yet`, feature: f.id, requestId };
      }
      return null;
    },
  },
  {
    node: "test-implementer", kind: "agent", layer: "oracle",
    when: "a prove feature has a falsifier and validated conditions but no written, mutant-checked test",
    // The edge that was missing: test-designer fills the falsifier, its own rule stops matching,
    // and control fell straight through to the maker — which then wrote the test it was supposed
    // to be judged by. The oracle has to EXIST, not merely be specified. It also has to be PROVEN
    // to discriminate: a written test with no `mutant: true` red run is a test that might pass a
    // wrong implementation, and the checker is the one who pays for that after a full implement
    // cycle (feat-diag-open-on-query).
    match: () => {
      if (!hasAgent("test-implementer")) return null;
      // A falsifier alone is not enough to implement from — the validated conditions are the input,
      // and a plan with an empty conditions/ folder is not one.
      if (!conditionsExist()) return null;
      // `open` deliberately keeps blocked features visible, but this rule DISPATCHES action — a
      // blocked feature means a human needs to look, not that test-implementer should write its
      // test anyway. Without this exclusion a feature blocked for a real reason (e.g. waiting on a
      // not-started dependency) kept matching every iteration: found live on examples/jdt-mcp-server,
      // where the same feature was re-dispatched 19 times before this fix.
      const notWritten = (x) => !String(x.evidence || "").trim();
      const notMutantChecked = (x) => !(Array.isArray(x.evidence) && x.evidence.some((e) => e && e.mutant === true));
      const f = open.find((x) => x.kind === "prove" && featureConditionsComplete(x) && String(x.falsifier || "").trim() &&
        (notWritten(x) || notMutantChecked(x)) && !/^NEEDS /.test(notes(x)) && status(x) !== "blocked");
      return f ? { why: `${f.id} has a falsifier but no ${notWritten(f) ? "test" : "mutant-checked test"} yet — the oracle is specified, not proven`, feature: f.id } : null;
    },
  },
  {
    // Acceptance is a delivery boundary, not an inner-loop hop. All spec, design,
    // decomposition and oracle routes above this rule must be exhausted first.
    node: "checker", kind: "agent", layer: "final-acceptance",
    when: "every non-blocked open feature has a complete handoff — run one final acceptance batch",
    match: () => {
      const reviewable = open.filter((f) => status(f) !== "blocked");
      if (!reviewable.length || !reviewable.every((f) => f.readyForCheck === true)) return null;
      return { why: `all ${reviewable.length} remaining feature(s) are handed off; final acceptance now judges the integrated delivery`,
        features: reviewable.map((f) => f.id) };
    },
  },
  {
    // Level 3 of docs/testing-standards.md — this node's job is PROOF across a real service
    // boundary, not building the thing. It is a test-layer node, and the test-authoring discipline
    // applies to it (traceability, a red run, a named falsifier). It is deliberately NOT tagged
    // `oracle`: unlike test-designer/test-implementer it must read the implementation to diagnose
    // a failed deploy, so its independence comes from the boundary it tests across, not from
    // blindness to the code.
    node: "k8s-integration-tester", kind: "agent", layer: "integration",
    when: "the feature's verification deploys to a real cluster",
    match: () => {
      if (!hasAgent("k8s-integration-tester")) return null;
      const f = open.find((x) => x.readyForCheck !== true && /k8s-test-env|kubectl|helm |namespace/i.test(String(x.verification || "")) &&
        (x.dependencies || []).every((d) => handedOff(features.find((y) => y.id === d) || {})));
      return f ? { why: `${f.id} verifies against a real cluster — cluster lifecycle knowledge the maker does not carry`, feature: f.id } : null;
    },
  },
  {
    // Repair outranks both fan-out and fan-in: a failed slice is usually a split that was cut
    // wrong, and re-cutting it is cheaper than integrating around the hole. It is also the one
    // report a parallel worker can make about its own brief, so it must not be routed past.
    node: "maker", kind: "agent", layer: "implementation",
    when: "a validated work split has a failed slice — one maker re-cuts or absorbs it",
    match: () => {
      for (const f of splitEligible()) {
        const w = workSplit(f);
        if (w && w.failed.length) {
          return { why: `${f.id}: slice ${w.failed.map((s) => s.id).join(", ")} failed (${w.failed[0].note || "no note"}) — the split needs re-cutting before more parallel work`,
            feature: f.id, mode: "slice-repair", slices: w.failed.map((s) => s.id) };
        }
      }
      return null;
    },
  },
  {
    // The fan-out. WIP is still 1 — one FEATURE, one iteration — and the workers are confined to
    // disjoint files by tools/guard-write.mjs, so this is parallelism inside a step, not two
    // makers racing for the repo (references/p08-parallel-record.md).
    node: "maker", kind: "agent", layer: "implementation",
    when: "a validated work split has slices left — spawn one maker per slice, in parallel",
    match: () => {
      for (const f of splitEligible()) {
        const w = workSplit(f);
        if (w && w.outstanding.length) {
          return { why: `${f.id}: ${w.outstanding.length} of ${w.slices.length} slices outstanding; each is a self-contained brief over a disjoint file set`,
            feature: f.id, mode: "slice-fanout", slices: w.outstanding.map((s) => s.id) };
        }
      }
      return null;
    },
  },
  {
    // The fan-in, and it is deliberately ONE agent. Per-slice green does not compose into a
    // feature-level claim: the slices never ran together, and the suite that judges them may bind
    // a port, a database or a temp directory that N concurrent runs would fight over.
    node: "maker", kind: "agent", layer: "implementation",
    when: "every slice of a validated work split is complete — one maker runs the whole verification",
    match: () => {
      for (const f of splitEligible()) {
        const w = workSplit(f);
        if (w && !w.outstanding.length && !w.failed.length) {
          return { why: `${f.id}: all ${w.slices.length} slices landed — one maker now runs \`${w.plan.integration?.verification || "the feature verification"}\` and builds the review packet`,
            feature: f.id, mode: "integrate" };
        }
      }
      return null;
    },
  },
  {
    node: "maker", kind: "agent", layer: "implementation",
    when: "a feature is eligible: dependencies done or handed off, no blocking marker, within its attempts budget",
    match: () => {
      // Information asymmetry is only real if it is an ORDERING: a build feature whose prove
      // feature has no test written yet is not eligible, because the maker would write that test.
      // A prompt saying "don't rewrite the test" cannot hold when there is no test to not rewrite.
      // Same for a test that has never been proven to discriminate: a written-but-unmutant-checked
      // oracle lets the maker ship a mutant and the checker catches it only after a full implement
      // cycle (feat-diag-open-on-query). A BLOCKED prove feature must not count here: it is not
      // "test not ready yet", it is a human-owned decision, and counting it made an unrelated
      // build feature wait on it forever (same incident, found live on examples/jdt-mcp-server).
      const notWritten = (p) => !String(p.evidence || "").trim();
      const notMutantChecked = (p) => !(Array.isArray(p.evidence) && p.evidence.some((e) => e && e.mutant === true));
      const unproven = new Set(features.filter((p) => p.kind === "prove" && status(p) !== "blocked" &&
        (notWritten(p) || notMutantChecked(p))).flatMap((p) => p.dependencies || []));
      const eligible = open.filter((x) => x.readyForCheck !== true &&
        !/^NEEDS (DESIGN|RE-PLAN|ORACLE FIX):/.test(notes(x)) && status(x) !== "blocked" &&
        !(x.kind === "build" && unproven.has(x.id) && hasAgent("test-implementer")) &&
        (x.dependencies || []).every((d) => handedOff(features.find((y) => y.id === d) || {})));
      return eligible.length ? { why: `${eligible.length} feature(s) eligible; next is ${eligible[0].id}`, feature: eligible[0].id } : null;
    },
  },
];

// --rules: the routing table, in precedence order, without reading this file's source. An agent
// that wants to know "what happens after me" otherwise greps route.mjs and writes a parser — which
// is exactly what a designer did, and what I did twice while building this. When the tool's author
// needs a throwaway script to answer a question, the affordance is missing, not the user.
if (args.includes("--rules")) {
  const rows = RULES.map((r, i) => ({ n: i + 1, node: r.node, kind: r.kind, layer: r.layer, when: r.when || "—" }));
  if (JSON_OUT) { writeSync(1, JSON.stringify(rows, null, 2) + "\n"); process.exit(0); }
  const L = ["", "  Routing rules, in precedence order. The FIRST match wins, so a rule only fires when",
    "  every rule above it declined — deepest layer first: spec → design → decomposition → oracle →",
    "  integration → implementation.", ""];
  for (const r of rows) {
    L.push(`  ${String(r.n).padStart(2)}. ${r.node.padEnd(22)} [${r.layer}]`);
    L.push(`      when ${r.when}`);
  }
  L.push("");
  L.push("  Nothing matched at all → `exit` if every feature is settled, `human` if work is open.");
  L.push("  What the router would pick RIGHT NOW: node loop/route.mjs");
  L.push("");
  writeSync(1, L.join("\n") + "\n");
  process.exit(0);
}

let hit = null;
for (const r of RULES) {
  const m = r.match();
  if (m) { hit = { node: r.node, kind: r.kind, layer: r.layer, ...m }; break; }
}

// The dispatcher records what it ran; the router stays pure and just says what the marker is, so
// the two never disagree about which text was in play. Only markers matter here — a route driven by
// eligibility repeats legitimately and must not be treated as a lack of progress.
if (hit && hit.feature) {
  const f = features.find((x) => x.id === hit.feature);
  if (f && /^NEEDS (DESIGN|RE-PLAN|ORACLE FIX):/.test(marker(f))) hit.hash = markerHash(marker(f));
}

// Why a clean-looking feature cannot move. Naming the feature is not naming the cause: the cause is
// usually several links up its dependency chain, and reading the named features tells you nothing
// because they are all fine. Observed on examples/jdt-mcp-server — four not-started features with
// full dependencies and no markers, all dammed by one `blocked` prove feature three links away, and
// the router said only "4 feature(s) open but none routable". Walking the chain by hand was the
// whole diagnosis, and it is a walk this function can do.
const byId = new Map(features.map((f) => [f.id, f]));
function damFor(feature) {
  const seen = new Set([feature.id]);
  const queue = (feature.dependencies || []).map((d) => ({ id: d, path: [feature.id] }));
  while (queue.length) {
    const { id, path: chain } = queue.shift();
    if (seen.has(id)) continue;
    seen.add(id);
    const dep = byId.get(id);
    if (!dep) return { id, chain, reason: "declared as a dependency but absent from feature_list.json" };
    if (status(dep) === "blocked") {
      return { id, chain, reason: marker(dep) || "blocked with no reason recorded" };
    }
    if (handedOff(dep)) continue;
    for (const next of dep.dependencies || []) queue.push({ id: next, path: [...chain, id] });
  }
  return null;
}

// Nothing routable. Distinguish "finished" from "stuck", because they need opposite responses:
// finished exits 0 and the loop stops; stuck exits 3 and a human is told exactly what is stuck.
if (!hit) {
  const stuck = open.filter((f) => status(f) !== "blocked");
  if (stuck.length) {
    const dams = new Map();
    for (const f of stuck) {
      const dam = damFor(f);
      if (!dam) continue;
      if (!dams.has(dam.id)) dams.set(dam.id, { reason: dam.reason, dammed: [] });
      dams.get(dam.id).dammed.push(f.id);
    }
    const detail = dams.size
      ? [...dams.entries()].map(([id, d]) =>
          `${id} is blocked (${String(d.reason).slice(0, 90)}) and dams ${d.dammed.length}: ${d.dammed.slice(0, 4).join(", ")}`).join(" | ")
      : stuck.slice(0, 5).map((f) => f.id).join(", ");
    hit = { node: "human", kind: "human", layer: "unknown",
      why: dams.size
        ? `${stuck.length} feature(s) open but none routable — ${dams.size} blocked feature(s) upstream are damming them`
        : `${stuck.length} feature(s) open but none routable — every rule declined`,
      detail };
  } else {
    hit = { node: "exit", kind: "code", layer: "-", why: "every feature is done, or blocked with a recorded reason" };
  }
}

if (AGENT_ONLY) { console.log(hit.kind === "agent" ? hit.node : ""); process.exit(0); }
if (JSON_OUT) { writeSync(1, JSON.stringify(hit, null, 2) + "\n"); process.exit(0); }
console.log(`next node : ${hit.node}  (${hit.kind})`);
console.log(`layer     : ${hit.layer}`);
console.log(`why       : ${hit.why}`);
if (hit.feature) console.log(`feature   : ${hit.feature}`);
if (hit.mode) console.log(`mode      : ${hit.mode}`);
if (hit.slices) console.log(`slices    : ${hit.slices.join(", ")}`);
if (hit.detail) console.log(`detail    : ${hit.detail}`);
process.exit(hit.node === "exit" ? 0 : hit.node === "human" ? 3 : 0);
