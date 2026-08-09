# Knowledge layout — keeping every document inside an agent's working range

An agent reads a document the way it reads anything else: it pulls the whole thing into a finite
context and its attention thins as the file grows. Past roughly **300 lines** a knowledge document
stops being reliably *used* — it gets skimmed, the middle is silently dropped, and the agent acts
on a partial reading while believing it read everything. That failure is invisible: nothing errors,
the agent just quietly knows less than the file says.

So the harness treats document size as a hard budget, the same way it treats `AGENTS.md` (≤200
lines, Lesson 4) — except that rule covered only the router. This extends it to every knowledge
document, and adds the two things that make a budget survivable: **an index, and a splitting
method that matches how the document grows.**

## The budgets

| File | Budget | Enforced by |
|---|---|---|
| `AGENTS.md` (router) | 200 lines | `check-coverage.mjs` L4 |
| `memory/<agent>/MEMORY.md` (always-loaded index) | 200 lines | `verify-harness.mjs` gate `memory` |
| Every other knowledge doc (`docs/**`, requirements, decision logs) | **300 lines** | `verify-harness.mjs` gate `docs` (warn) |
| `docs/INDEX.md` | 300 lines, one line per document | gate `docs` |

Warn, never blocker: an oversized document is a comprehension risk, not a broken build, and a
false positive must never stop a loop.

## Two ways a document outgrows the budget — and the matching fix

Choosing the wrong one is why splitting often makes things worse.

### Pattern A — a *topic document* that grew (a requirement, an architecture doc, a design)
It has structure already: sections. Split **by section boundary into sibling files**, and leave the
original as a **map**, not a stub:

```
requirement.md            (was 506 lines)
  → requirement.md        20 lines: one line per section, each linking its file  ← the map
  → requirement/01-scope.md
  → requirement/02-components.md
  → requirement/14-acceptance-scenarios.md
```

Rules that keep this from becoming worse than the original:
- **The map keeps the original filename.** Every existing link and habit still resolves.
- **Split at real section boundaries only.** Never mid-argument — a half-argument in two files is
  worse than one long file.
- **One topic per file.** If a section would still exceed 300 lines, it was two topics.
- **The map line must say what's inside**, so an agent can decide *not* to open the file. A map of
  bare filenames saves nothing.

### Pattern B — an *append-only log* that grows forever (`DECISIONS.md`, `progress.md`)
Splitting by topic is wrong here; entries are chronological and new ones arrive forever. **Rotate**:

```
DECISIONS.md              recent entries (stays under budget) + a link to the archive index
DECISIONS/2026-07.md      closed period, never edited again
DECISIONS/2026-08.md
DECISIONS/INDEX.md        one line per archived entry: date — decision — where
```

Rules:
- **Recency lives in the live file.** The entries an agent needs most are the newest; those never
  move.
- **Archived periods are frozen.** An archived file is never edited — only read. This is what makes
  rotation safe for an audit log.
- **The archive index carries the one-line summary**, so a search hits the index and only then
  opens the year/month file. Same core-vs-archival tiering as
  [agent-memory.md](agent-memory.md).
- **An indexed archive directory is exempt from the budget.** You never read it end to end — the
  index sends you to one entry. `verify-harness.mjs` implements exactly that condition: a
  directory containing its own `INDEX.md` is skipped, an unindexed pile of split files is not.
  Splitting without a map is worse than one long file, so the exemption has to be earned.
- **Anything that greps the log must grep the archive too.** `verify-harness.mjs`'s
  `blocked-unjustified` check reads `DECISIONS.md` for a feature id — rotation must not silently
  hide a justification. Rotate, then re-run verify to prove nothing broke.

## `docs/INDEX.md` — the map of maps

One entry per knowledge document: what it is, and **when to open it**. This is the file an agent
reads to decide what else to read, so it is worth more than the sum of its links:

```markdown
| Document | Read it when |
|---|---|
| `docs/architecture.md` | You need the five Fresh-Session-Test answers |
| `docs/constraints.md` | Before writing code — the MUST / MUST NOT rules |
| `docs/assumptions.md` | Before trusting a design conclusion; a `needs-human` row stops the loop |
| `docs/cross-cutting.md` | Before choosing a mechanism for retry/identity/timeouts — someone may own it already |
| `docs/design/gap-reconcile.md` | Before touching bootstrap or gap-fill code |
```

"Read it when" is the load-bearing column. A list of filenames makes an agent open everything,
which is the problem this file exists to solve.

## When splitting is the wrong answer

If a document is over budget because it is **repetitive or padded**, cut it instead — two files of
filler is worse than one. Split only when the content is genuinely all needed and genuinely
separable. The budget is a prompt to ask "is all of this earning its place?", and often the honest
answer is no.
