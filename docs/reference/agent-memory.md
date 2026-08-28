# Agent memory — per-agent, file-based, self-reorganizing

Each agent this skill scaffolds (`maker`, `checker`, `harness-setup`, `feature-planner`,
`k8s-integration-tester`, and the skill-level `harness-improver`) gets its **own** persistent
memory: a place to write down
what it learned this run so the *next* run doesn't rediscover it from zero, and a mechanical way to
keep that memory from rotting into an unread pile. This is not a new subsystem bolted onto the
harness — it's Lesson 5 (External State) applied to a second kind of thing worth persisting:
not just *what state the project is in*, but *what the agent has already learned about working on
it*.

## Why file-based, not a memory library/vector DB

Every other piece of state in this skill (`progress.md`, `DECISIONS.md`, `feature_list.json`,
`trace/trace.jsonl`) is a plain file, git-diffable, readable without special tooling, and portable
across whatever runtime drives the loop (Kiro today, something else tomorrow — see
`references/runtimes.md`). A memory library (Mem0, a
vector store) would add a runtime dependency and an opaque store that breaks that pattern for no
benefit at this scale — an agent's memory here is dozens of entries, not millions; grep and a
markdown index are the right-sized tool. The *shape* of what's stored below is still grounded in
recognized agent-memory design, not invented from scratch:

- **Tiered retrieval** (MemGPT/Letta): a small, always-loaded "core" index vs. larger content
  fetched on demand. `MEMORY.md` is the core tier (loaded into every agent run via `resources`);
  the individual memory files are the archival tier (read on demand, via grep or an explicit link).
- **Post-episode reflection** (Reflexion, Shinn et al.): after a trial fails or succeeds
  informatively, the agent writes a short verbal reflection on *why*, and that reflection — not
  the raw transcript — is what future attempts get to read. A memory entry here is that reflection,
  not a session log.
- **Memory-stream + periodic reflection** (Generative Agents, Park et al.): raw observations
  accumulate cheaply, but a separate, periodic synthesis pass turns them into fewer, higher-level
  insights, and low-value entries stop being retrieved. `memory-consolidate.mjs` is that pass, made
  mechanical where it can be (see below).

## Layout (per agent)

```
memory/
  maker/
    MEMORY.md              # index — one line per entry, always loaded, small on purpose
    <slug>.md               # one memory entry per file
  checker/
    MEMORY.md
    <slug>.md
  <agent-name>/...
```

`harness-improver` is the one exception: it operates on the harness-loop **skill** itself, not on
a scaffolded target (see `references/harness-improvement-loop.md`), so its memory lives at the
skill repo's own root (`harness/memory/harness-improver/`), not inside any target's `memory/`.

## Memory types

Three, deliberately fewer than a general-purpose memory system needs, because an agent here has a
narrow job:

- **`lesson`** — the core type; this is what "rút kinh nghiệm" (learning from experience) actually
  produces. A mistake made and how it was actually caught/fixed, or a non-obvious approach that
  worked and why. Write one when: a checker rejects a maker's claim, evidence fails to reproduce
  and the real cause turns out to be non-obvious, a review comment recurs (this is the same trigger
  `docs/testing-standards.md`'s "Review Feedback Promotion" rule already names), or something that
  looked like a bug turned out to be environmental (see the k8s resource-contention example below —
  exactly this kind of thing is expensive to rediscover twice).
- **`fact`** — a durable, non-obvious technical fact about *this* project, discovered mid-work, that
  isn't worth promoting to `docs/architecture.md` but would waste time to re-derive (an API's real
  behavior vs. its docs, a naming convention, a gotcha in how two components interact).
- **`pointer`** — where something lives: a related file, an external system, a past decision's
  location in `DECISIONS.md`. Cheap, low-risk, avoid re-deriving "where do I even look for this."

## Entry format

Same frontmatter shape as this session's own memory system (not a coincidence — it's a proven,
minimal schema for exactly this job):

```markdown
---
name: short-kebab-case-slug
description: one line, specific enough to judge relevance without opening the file
metadata:
  type: lesson | fact | pointer
  date: YYYY-MM-DD
---

For `lesson`: the mistake/technique, then **Why:** (the reason, so future-you can judge edge
cases) and **How to apply:** (when this should change behavior).

For `fact`/`pointer`: the fact or location itself, kept short.
```

`MEMORY.md` (the index) has one line per entry: `- [Title](slug.md) — one-line hook`, nothing more
— this is the file that's loaded on every single run, so it has to stay cheap to read. Individual
entry files are the archival tier: read via grep, or when `MEMORY.md`'s one-liner says "read this."

**Write memory in English — the index and the entries both.** This is deliberate even on a project
whose documentation language is not English. Memory is not project prose: it is an operational
record addressed to whichever agent runs next, in the same class as a log line or an identifier,
and the reader is rarely the writer. A mixed-language index also costs exactly the thing the index
exists to buy — a cheap skim — because a reader scanning for a relevant hook stops at every line
they have to switch languages for. Keep commands, error text and file paths verbatim regardless;
those are evidence, not prose.

Entries already written in another language stay as they are. Rewriting a precise technical record
risks losing the reproduction detail that made it worth keeping, and that loss is permanent while
the inconsistency is only untidy — so this rule governs what gets written from now on.

## Lifecycle — wired into the loop that already exists

1. **At the start of a run**, the agent's own prompt instructs it to read `memory/<agent>/MEMORY.md`
   (already in its `resources` list, so it's in context without an extra tool call) and, for any
   line that looks relevant to the task at hand, open the linked entry file.
2. **During the run**, nothing special — memory isn't written continuously, only when something is
   actually worth remembering (see the `lesson` triggers above). Writing a memory entry for routine,
   expected outcomes is noise, not learning — the same "corrections AND confirmations, not everything"
   discipline this session's own memory system uses.
3. **At the end of a run** (the `stop` hook already fires `trace.mjs`'s `session-end` event — the
   natural place to also prompt "was there anything this run that the next run of this same agent
   shouldn't have to rediscover?"), the agent writes the entry (new file + a new `MEMORY.md` line)
   if — and only if — it has one.
4. **Never let a memory write masquerade as project state.** A `lesson` about how `verify-harness`
   behaves does not replace a `DECISIONS.md` entry about a real architectural choice — they answer
   different questions ("how should I work" vs. "why does the project look like this") for
   different readers (this agent's future self vs. anyone reading the project cold, per Lesson 3).

## Querying — `MEMORY.md` is a skim, not a search index

`MEMORY.md` is deliberately too small and too flat to answer "find me every lesson about X" —
that's the point, it stays cheap to load every run. Once there's more than a handful of entries
(or you need to search *across* agents, or by type/date), use the actual query tool instead of
eyeballing files:

```bash
node scripts/memory-query.mjs --target DIR [--agent NAME] [--type lesson|fact|pointer]
                               [--grep TEXT] [--since YYYY-MM-DD] [--json]
```

It parses every entry's frontmatter + body across `memory/**` and returns matches sorted
newest-first (recency-first retrieval is the standard default in the designs this borrows from —
Reflexion and Generative Agents both surface the most recent relevant reflection ahead of older
ones). `--json` for another agent/script to consume the results, plain text for a human. Stateless
by design — it re-scans on every call instead of maintaining a separate index file that could drift
out of sync with the actual `.md` files, which is a real problem at dozens of entries and not one
worth solving with more state to keep consistent.

## Consolidation — the mechanical half of "reorganize memory"

`node scripts/memory-consolidate.mjs --target DIR` (or `--target .` for `harness-improver`'s own
skill-root memory) reports, per agent:

- **Index budget**: `MEMORY.md` line count and each line's length, flagged if either exceeds the
  same budget this session's own memory system uses (200 lines, ~150 chars/line) — an index that
  needs scrolling has stopped being "always loaded cheaply."
- **Orphans**: an entry file with no corresponding `MEMORY.md` line (unreachable — dead weight), or
  an `MEMORY.md` line pointing at a file that no longer exists (broken link).
- **Likely duplicates**: two entries with the same `name:` slug, or descriptions that are
  near-identical (cheap string-similarity check) — a candidate for merging by hand.

This is a **report**, not a rewrite — same division of labor as `verify-harness.mjs` vs. the
checker's semantic judgment: the script finds cheap, structural signals; deciding what two lessons
actually mean and how to merge them stays a judgment call for the agent (or a human) to make, the
next time that agent runs and reads its own consolidation report.

## What this doesn't solve

This gives an agent memory across runs of *itself*; it does not give agents a shared brain — a
`lesson` maker learns is not automatically visible to checker, deliberately, because they have
different jobs and a checker trusting maker's own account of "I already checked this" is exactly
the generator/evaluator failure this whole skill exists to prevent (Lesson 9/13). If two agents
keep re-learning the same fact independently, that is itself a signal the fact belongs in
`docs/architecture.md` or `docs/constraints.md` instead — project-wide truth, not one agent's
memory.
