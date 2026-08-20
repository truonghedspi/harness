# Assumption registry — Harness

Every **load-bearing** assumption a design rests on. This file exists because an unexamined
assumption is the most expensive defect in the loop: it makes a wrong design look right, and the
checker cannot catch it (the checker verifies implementation against the spec, never the spec
against reality). Contract: `docs/reference/design-engineering.md`.

**Status values**
- `verified` — with *how*: a `path:line` citation, a spike that ran, or a dated human statement.
  The design-facilitator's own confidence is never verification.
- `assumed` — plausible but unverified. The **If false** column is mandatory: without a stated
  blast radius nobody can judge the risk.
- `needs-human` — cannot be known from the repo (deployment fact, business intent, risk appetite).
  **This is the only status that stops the loop.**

Every `needs-human` row **must** carry a **Recommended answer** with its reasoning. Asking bare
("what should the retry policy be?") hands the work back and costs minutes of a person's thinking;
asking with a recommendation ("exponential capped at 30s, because X — agree?") costs seconds and
turns the job from *generating* an answer into *evaluating* one. It also exposes the answer the
agent would otherwise have assumed silently.

| id | Assumption | Status | If false | Recommended answer | Depended on by |
|---|---|---|---|---|---|
| A-001 | `memory-promote.mjs`'s v1 recurrence trigger (same normalized `checkerNotes`/trace `detail` across ≥2 features, `docs/design/shared-memory-tier.md`) fires often enough on a real, mature project to be worth the new tier at all | assumed | `memory/shared/` ships in the template but rarely populates — infrastructure with no payoff, the exact premortem failure the design already named for the deferred v2 path | Calibrate `memory-promote.mjs` against a real, mature onboarded target before treating v1 as validated, same discipline `AGENTS.md` already requires for any mechanical gate | v1 rollout of `docs/design/shared-memory-tier.md` |
| A-002 | A trace `detail` event (unlike `checkerNotes`) has a concrete, implementable rule for inheriting `evidence: test\|tool-output` from its source | assumed | `memory-promote.mjs` cannot type trace-sourced candidates and INV-SHARED-1 either blocks all trace-sourced promotion or is checked less strictly than intended | Scope v1's trace source to only events whose payload already carries a verification command/result (mirrors how `checkerNotes` inherits from the feature's own `evidence` array) | `memory-promote.mjs` implementation |
