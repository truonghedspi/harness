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
import { readFileSync, existsSync, readdirSync, statSync, writeSync } from "node:fs";

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
const hasAgent = (name) => existsSync(`.kiro/agents/${name}.json`) || existsSync(`.claude/agents/${name}.md`);

const fl = readJSON("feature_list.json");
const features = (fl && fl.features) || [];
const notes = (f) => String(f.checkerNotes || "").trim();
const status = (f) => String(f.status || f.state || "");
const open = features.filter((f) => !["done", "passing"].includes(status(f)));

// Routing rules, highest precedence first. Each returns {node, kind, layer, why, feature}.
// Precedence is deliberate: a question about the SPEC outranks one about the DESIGN, which
// outranks one about the CUT, which outranks implementation — because answering the deeper one
// can dissolve the shallower ones, and doing it the other way round wastes the work.
const RULES = [
  {
    node: "context-interviewer", kind: "agent", layer: "spec",
    // The one condition that is supposed to STOP the loop. It could not, before this file.
    match: () => {
      const rows = read("docs/assumptions.md").split("\n")
        .filter((l) => l.startsWith("|") && /needs-human/i.test(l));
      return rows.length ? { why: `${rows.length} assumption(s) are needs-human — a fact the repo cannot contain is holding up a design`, detail: rows[0].slice(0, 160) } : null;
    },
  },
  {
    node: "designer", kind: "agent", layer: "design",
    match: () => {
      const f = open.find((x) => /^NEEDS DESIGN:/.test(notes(x)));
      return f ? { why: `${f.id} raised a design question the maker is forbidden to answer inline`, feature: f.id, detail: notes(f).split("\n")[0] } : null;
    },
  },
  {
    node: "designer", kind: "agent", layer: "design",
    // Same predicate as verify-harness's design-untestable gate. Without this rule the router
    // matched only the NEEDS DESIGN: marker, so a design that simply never said how anyone would
    // know the thing works did not register as a design problem at all — and the loop went
    // straight to the oracle layer to derive falsifiers from invariants nobody had written.
    // That is the router jumping its own deeper-first precedence (HI-014, found on aeron-demo).
    match: () => {
      const SEAM = /\b(seam|observable|observability|from outside|externally visible)\b/i;
      const INV = /\b(invariant|always|never|for every|conserv|idempoten|monotonic|round[- ]trip)\b/i;
      for (const f of lsSafe("docs/design").filter((x) => x.endsWith(".md") && x.toLowerCase() !== "readme.md")) {
        const text = read(`docs/design/${f}`);
        if (!text || text.trim().length < 200) continue;      // stubs are not designs
        const missing = [!SEAM.test(text) && "no observable seam", !INV.test(text) && "no invariants"].filter(Boolean);
        if (missing.length) {
          return { why: `docs/design/${f} states ${missing.join(" and ")} — nothing downstream can derive a falsifier from it`, detail: f };
        }
      }
      return null;
    },
  },
  {
    node: "feature-planner", kind: "agent", layer: "decomposition",
    match: () => {
      const f = open.find((x) => /^NEEDS RE-PLAN:/.test(notes(x)));
      return f ? { why: `${f.id} was ruled mis-cut by the checker; re-cutting is not the maker's job`, feature: f.id, detail: notes(f).split("\n")[0] } : null;
    },
  },
  {
    node: "feature-planner", kind: "agent", layer: "decomposition",
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
        // tolerate the markdown a designer actually writes: `id`, **id**, (new), **change** (note)
        const rows = [...text.matchAll(/^\|[\s`*(]*([\w-]+)[\s`*)]*\|[\s`*]*(change|new)\b/gim)];
        if (rows.length) {
          return { why: `docs/design/${f} marks ${rows.length} feature(s) change/new and is newer than feature_list.json — the cut has not caught up with the design`, detail: rows.slice(0, 4).map((m) => `${m[1]}:${m[2].toLowerCase()}`).join(", ") };
        }
      }
      return null;
    },
  },
  {
    node: "test-designer", kind: "agent", layer: "oracle",
    match: () => {
      const missing = open.filter((x) => !String(x.falsifier || "").trim());
      return missing.length && hasAgent("test-designer")
        ? { why: `${missing.length} unfinished feature(s) have no falsifier — nobody has said what wrong implementation their verification catches`, feature: missing[0].id }
        : null;
    },
  },
  {
    node: "test-implementer", kind: "agent", layer: "oracle",
    // The edge that was missing: test-designer fills the falsifier, its own rule stops matching,
    // and control fell straight through to the maker — which then wrote the test it was supposed
    // to be judged by. The oracle has to EXIST, not merely be specified.
    match: () => {
      if (!hasAgent("test-implementer")) return null;
      const f = open.find((x) => x.kind === "prove" && String(x.falsifier || "").trim() &&
        !String(x.evidence || "").trim() && !/^NEEDS /.test(notes(x)));
      return f ? { why: `${f.id} has a falsifier but no test yet — the oracle is specified, not written`, feature: f.id } : null;
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
    match: () => {
      if (!hasAgent("k8s-integration-tester")) return null;
      const f = open.find((x) => /k8s-test-env|kubectl|helm |namespace/i.test(String(x.verification || "")) &&
        (x.dependencies || []).every((d) => ["done", "passing"].includes(status(features.find((y) => y.id === d) || {}))));
      return f ? { why: `${f.id} verifies against a real cluster — cluster lifecycle knowledge the maker does not carry`, feature: f.id } : null;
    },
  },
  {
    node: "maker", kind: "agent", layer: "implementation",
    match: () => {
      // Information asymmetry is only real if it is an ORDERING: a build feature whose prove
      // feature has no test written yet is not eligible, because the maker would write that test.
      // A prompt saying "don't rewrite the test" cannot hold when there is no test to not rewrite.
      const unwritten = new Set(features.filter((p) => p.kind === "prove" && !String(p.evidence || "").trim())
        .flatMap((p) => p.dependencies || []));
      const eligible = open.filter((x) =>
        !/^NEEDS (DESIGN|RE-PLAN):/.test(notes(x)) && status(x) !== "blocked" &&
        !(x.kind === "build" && unwritten.has(x.id) && hasAgent("test-implementer")) &&
        (x.dependencies || []).every((d) => ["done", "passing"].includes(status(features.find((y) => y.id === d) || {}))));
      return eligible.length ? { why: `${eligible.length} feature(s) eligible; next is ${eligible[0].id}`, feature: eligible[0].id } : null;
    },
  },
];

let hit = null;
for (const r of RULES) {
  const m = r.match();
  if (m) { hit = { node: r.node, kind: r.kind, layer: r.layer, ...m }; break; }
}

// Nothing routable. Distinguish "finished" from "stuck", because they need opposite responses:
// finished exits 0 and the loop stops; stuck exits 3 and a human is told exactly what is stuck.
if (!hit) {
  const stuck = open.filter((f) => status(f) !== "blocked");
  hit = stuck.length
    ? { node: "human", kind: "human", layer: "unknown", why: `${stuck.length} feature(s) open but none routable — every rule declined`, detail: stuck.slice(0, 5).map((f) => f.id).join(", ") }
    : { node: "exit", kind: "code", layer: "-", why: "every feature is done, or blocked with a recorded reason" };
}

if (AGENT_ONLY) { console.log(hit.kind === "agent" ? hit.node : ""); process.exit(0); }
if (JSON_OUT) { writeSync(1, JSON.stringify(hit, null, 2) + "\n"); process.exit(0); }
console.log(`next node : ${hit.node}  (${hit.kind})`);
console.log(`layer     : ${hit.layer}`);
console.log(`why       : ${hit.why}`);
if (hit.feature) console.log(`feature   : ${hit.feature}`);
if (hit.detail) console.log(`detail    : ${hit.detail}`);
process.exit(hit.node === "exit" ? 0 : hit.node === "human" ? 3 : 0);
