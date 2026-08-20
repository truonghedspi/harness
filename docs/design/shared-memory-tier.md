# Design — a shared, evidence-gated memory tier (`memory/shared/`)

Session context: Loren asked for a shared-memory architecture (originally sketched as
`shared/`/`proposals/`/`private/` with a promotion gate) to sit alongside the existing per-agent
`memory/<agent>/` tier documented in `docs/reference/agent-memory.md`. That document's own "What
this doesn't solve" section already names the pain this addresses: two agents independently
re-learning the same fact, with no path between "fully private" and "human hand-writes it into
`docs/architecture.md`".

## Problem

`docs/reference/agent-memory.md` deliberately keeps `memory/<agent>/` private per agent, so a
checker never inherits a maker's own account of "I already checked this" (Lesson 9/13). That
isolation is correct and stays. But it leaves no mechanism for the case that isn't a
generator/evaluator pair at all: two *unrelated* agents (or the same agent, two sessions apart)
independently discovering the same project fact, or drifting on what to call it — each paying the
discovery cost separately, with no promotion path short of a human manually writing it into `docs/`.

## Decision — two options, argument maps, and why B was chosen

**Option A** — extend `docs/` (already read by every agent) with a mechanically-populated
`docs/glossary.md`, promoted by a script. Cheapest (zero `agents.manifest.json`/`gen-agents.mjs`
changes), but mixes auto-inserted lines into a human-curated prose file, and gives `confidence:
disputed`/`supersedes` provenance no natural home in prose.

**Option B** — a new, typed `memory/shared/` tier, written only by a mechanical promotion gate,
read via `resources` the same way `memory/<agent>/MEMORY.md` already is. Chosen because it makes
the "generator/evaluator may read a promoted *conclusion* with evidence, never a private
*reasoning trace*" boundary a directory boundary — grep-able and permission-scoped — rather than a
convention buried in prose.

**Spike that reshaped it:** the leading design assumed a script could mechanically detect "the same
fact, worded differently" the way `memory-consolidate.mjs --bootstrap` already detects recurrence
in short structured fields (`checkerNotes`, trace `detail`). Ran the actual `normalize()` +
80-char-prefix matcher (`harness-loop/scripts/memory-consolidate.mjs`) against three realistic
paraphrase pairs styled as free-text memory-entry bodies — **0 of 3 matched.** A script that can
match short templated fields cannot match free prose without semantic judgment, which is exactly
what a pure script (`verify-harness --promote`'s replay-and-flip pattern) does not do. This forced
a scope split: what is genuinely mechanical today, and what would need agent judgment tomorrow —
see v1/v2 below.

**Premortem + Devil's Advocacy (full argument: session transcript, `docs/reference/agent-memory.md`
neighbor doc going forward once summarized there):** the strongest case for Option A was that it
adds zero new surface area and reuses a curator (a human reviewing `docs/`) already trusted for
architecture calls. The strongest failure mode found for the full agent-confirmation design
(originally "Branch 2") was that unconfirmed proposals could sit forever with no second reader ever
crossing them, and that "≥2 agents agree" is a weaker independence signal than it looks when both
sessions read much of the same recent state. Both pushed the scope down to v1 below rather than
building the full confirmation pathway on an unproven premise.

## v1 — build now (mechanical only, no agent judgment)

This is **not** the agent-confirmation design; it is Option B's tier, seeded only by exactly the
recurrence `--bootstrap` already proves it can find.

**Components**
- **`memory/shared/facts.md`** — read-only tier, same frontmatter shape as a private memory entry,
  extended with `evidence: test|tool-output` (never `inference`) and `confidence: verified|disputed`.
- **`memory-promote.mjs`** (new, sibling to `memory-consolidate.mjs`) — reuses the exact detection
  `--bootstrap` already has (recurrence of the same normalized `checkerNotes` first line or trace
  `detail` across ≥2 features/occurrences) and, when at least one occurrence's source evidence is
  `test`/`tool-output`, mechanically writes an entry. No paraphrasing, no semantic matching beyond
  what's already proven — a `memory-promote.mjs` entry is templated from the source text plus a
  citation back to the feature id(s)/trace event(s), never freely authored.
- **`verify-harness.mjs` gate `memory-shared`** (mirrors gate `memory`) — warn-severity: flags any
  `memory/shared/*.md` entry with `evidence: inference` or missing evidence (defense in depth against
  a hand edit), and flags budget overrun the same way `memory-consolidate.mjs` already flags
  `MEMORY.md` (200-line index budget, `docs/reference/knowledge-layout.md` Pattern B — rotate once
  it fills, same as `DECISIONS.md`).
- **`gen-agents.mjs`** — every generated agent's `resources` gains `memory/shared/*.md`, computed the
  same way `subagentAllExceptSelf` computes the subagent roster (commit `b461933`): never hand-listed,
  never in any agent's `writes`/`allowedPaths` — `guard-write.mjs` keeps denying direct writes.

**Invariants**
| id | Invariant |
|---|---|
| INV-SHARED-1 | Every `memory/shared/*.md` entry has `evidence` ∈ {test, tool-output}. |
| INV-SHARED-2 | No writing agent's `writes`/`allowedPaths` includes `memory/shared/**`; only `memory-promote.mjs`, run outside any agent's own tool sandbox, writes there. |
| INV-PROMOTE-1 | A candidate promotes only when the same normalized checkerNotes-first-line or trace `detail` recurs across ≥2 features/occurrences, matching `--bootstrap`'s existing detection exactly. |
| INV-RES-1 | Every generated agent config's `resources` includes `memory/shared/*.md`, computed at generation time, not hand-maintained. |

**What v1 explicitly does not do:** match free-text `memory/<agent>/*.md` entries, require or model
"agent confirmation," or introduce `memory/proposals/`. Those are v2.

**Observable seams** — what is externally visible without reading any component's internals, i.e.
what a falsifier can be written against:
- `memory-promote.mjs`'s seam is its own exit code plus the diff it produces: given a fixture
  `feature_list.json`/`trace/trace.jsonl` with a recurring, evidence-typed reason, running it is
  externally observable to add exactly one file under `memory/shared/` whose frontmatter round-trips
  through the same parser `memory-consolidate.mjs`/`memory-query.mjs` already use — the same
  observable contract `memory-consolidate.mjs --bootstrap`'s own demo step (`demo.sh` step 44)
  already exercises from outside, on a fixture with no promotion.
- `verify-harness.mjs` gate `memory-shared`'s seam is `trace/verify-report.json`: a hand-planted
  `memory/shared/*.md` entry with `evidence: inference` is externally observable as a new finding
  with `id: memory-shared-*`, the same seam gate `memory` already has (demo step 18's pattern).
- `gen-agents.mjs`'s seam is a generated agent config file: `require('.claude/agents/<agent>.md')`'s
  resources (or the runtime-equivalent) is externally observable to list `memory/shared/*.md` after
  `--check`, without inspecting `gen-agents.mjs` itself — the same seam the `subagentAllExceptSelf`
  roster already proved observable (demo step 43's contained-layout checks read generated output,
  never the generator's source).
- `guard-write.mjs`'s seam for INV-SHARED-2 is a denied write: any agent attempting `Edit`/`Write` on
  a path under `memory/shared/**` is externally observable as a rejected tool call, the same seam
  `guard-write.mjs` already has for every other `writes`-restricted path.

No new observable mechanism is invented here — v1 reuses four seams the codebase already has
(`--bootstrap`'s fixture contract, the `memory` gate's finding shape, the generated-config contract,
`guard-write.mjs`'s deny contract) and points each at the one new path, `memory/shared/**`.

## v2 — named, not built

Agent-judged duplicate detection over free-text private entries, staged through `memory/proposals/`
before promotion, gated on ≥2 independently-confirming agents plus the same evidence-typing rule.
Deferred because: (1) the matching premise that motivated it was falsified by spike for the general
case, so its value is unproven until v1's narrower, already-proven mechanism has real operational
data; (2) retention/TTL for an unconfirmed proposal is an **unowned, fragmented cross-cutting
concern** (`node tools/cross-cutting-audit.mjs --target .` flags `retention` project-wide) that must
be decided in `docs/cross-cutting.md` before v2 ships, not settled inline here.

## Feature impact

Not yet cut into `feature_list.json` — that is `feature-planner`'s job once this design is locked
(`loop/design-approval.json`), not design-facilitator's.

## Open items this design does not resolve

- The exact evidence-typing rule for a trace `detail` event (unlike `checkerNotes`, a trace event has
  no `evidence` array to inherit `test`/`tool-output` from) needs a concrete rule at implementation
  time — flagged, not designed here.
- `docs/cross-cutting.md` row `X-` (retention/TTL) must close before v2 starts.
