# Cross-cutting decision register — {{PROJECT_NAME}}

Cross-cutting concerns fail differently from assumptions, so they get their own register
(`docs/reference/design-engineering.md`):

- **Assumption** (`docs/assumptions.md`) = "I believe X but haven't checked" → if wrong, a
  conclusion **flips**. Cured by verifying it.
- **Cross-cutting decision** (this file) = "someone must choose a policy" → if unowned, it gets
  decided **by accident** by whichever feature touches it first, and every later feature inherits
  it. Cured by an owner plus a rule that enforces the choice mechanically.

A row counts as **closed** only when all three of these are filled: the chosen mechanism, who chose
it and when, and the rule or gate that stops a future feature from silently doing something else.
A stub row ("not yet decided") is tracked, not closed — `tools/cross-cutting-audit.mjs` reports it
as `open-decision`, which is a better state than unnoticed but is still open.

Find candidates with `node tools/cross-cutting-audit.mjs --target .`. That audit reads breadth
(AI-strong: it never tires of reading every file); **choosing the policy is a human trade-off**
(AI-weak) — the agent surfaces and enumerates, you decide.

| id | Concern | Chosen mechanism | Owner / date | Enforced by | Inherited by |
|---|---|---|---|---|---|

<!-- Example of a closed row (delete once the table has real content):
| X-001 | Message identity & de-duplication | (logPosition, indexWithinEntry) | Alice, 2026-08-09 | docs/constraints.md MUST rule + wire-format test | feat-a, feat-b |
-->
