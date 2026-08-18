# Document index — Harness

The map an agent reads to decide **what else to read**. One line per knowledge document; the
"Read it when" column is the load-bearing part — a bare list of filenames makes an agent open
everything, which is exactly what this file exists to prevent.

Every knowledge document stays under **300 lines** (`docs/reference/knowledge-layout.md`); when one
grows past that, split it by section (topic docs) or rotate it by period (append-only logs) and add
the new files here.

| Document | Read it when |
|---|---|
| `AGENTS.md` | Start of every session — the router, DoD, work rules |
| `docs/architecture.md` | You need the five Fresh-Session-Test answers about this project |
| `docs/constraints.md` | Before writing code — the MUST / MUST NOT rules |
| `docs/testing-standards.md` | Choosing which test tier a change needs |
| `docs/definition-of-done.md` | Deciding whether something is actually finished |
| `docs/assumptions.md` | Before trusting a design conclusion; a `needs-human` row stops the loop |
| `docs/cross-cutting.md` | Before picking a mechanism for retry / identity / timeouts — it may already be owned |
| `docs/design/` | Before changing a subsystem someone has already designed |
| `docs/reference/critique-technique-sources.md` | Writing or revising the `design-facilitator` role — primary sources for Socratic questioning, argument mapping, decision quality, cognitive bias, red teaming, and steelmanning |
| `DECISIONS.md` | "Why is it like this?" — decisions with their rejected alternatives |
| `progress.md` | "Where were we?" — cross-session state |
