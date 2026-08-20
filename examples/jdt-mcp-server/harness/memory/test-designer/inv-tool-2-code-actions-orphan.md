# INV-TOOL-2's write-opt-in half is unowned for java_apply_code_action

Confirmed twice now, independently: once while designing TP-TOOL-0002 (rename side), again
while designing TP-CA-0001 (code-actions side). Both times via the same check — read
feat-prove-code-actions' own `falsifier` text and `node loop/route.mjs --json`'s uncovered list —
neither ever names INV-TOOL-2.

A-002 (human-confirmed) names both `java_rename` and `java_apply_code_action` as the tools
INV-TOOL-2 governs (mutating tools return the proposed edit as data; write only on explicit
`apply: true`). `feat-prove-rename` owns the rename half. No prove feature owns the
code-actions half — `feat-prove-code-actions`'s falsifier is scoped entirely to INV-CA-1/INV-CA-2
(handle staleness and cross-workspace wiring), never apply or disk writes.

Don't "fix" this by adding INV-TOOL-2 conditions into a code-actions test plan anyway — a
plan's conditions should trace to what the *owning feature's falsifier* cites, and falsifier
scope is feature-planner's call, not test-designer's. Record it in `spec_gaps` and move on.
If a future feature-planner pass adds INV-TOOL-2 to feat-prove-code-actions' falsifier (or spins
up a dedicated prove feature for it), that's when a test-designer should pick it up.

See also: `tests/design/plans/TP-TOOL-0002/plan.json#spec_gaps[0]` (first sighting) and
`tests/design/plans/TP-CA-0001/plan.json#spec_gaps[0]` (this confirmation).
