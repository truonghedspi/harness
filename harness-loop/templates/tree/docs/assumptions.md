# Assumption registry — {{PROJECT_NAME}}

Every **load-bearing** assumption a design rests on. This file exists because an unexamined
assumption is the most expensive defect in the loop: it makes a wrong design look right, and the
checker cannot catch it (the checker verifies implementation against the spec, never the spec
against reality). Contract: `docs/reference/design-engineering.md`.

**Status values**
- `verified` — with *how*: a `path:line` citation, a spike that ran, or a dated human statement.
  Designer confidence is never verification.
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

<!-- Example of a filled row (delete this comment once the table has real content):
| A-001 | The Archive endpoint never changes address in this deployment | needs-human | scenario 7's premise returns and the design must handle it | Likely fixed — the deployment pins it; confirm? | feat-sit-7 |
-->
