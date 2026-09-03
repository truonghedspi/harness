# Designer Checklist — complete before outputting a test plan

If an item fails, return to the corresponding SKILL.md step, fix it, then restart the checklist.
Output only when every item passes.

## D1 — Traceability & coverage
- [ ] Every P0-priority requirement in the specification has at least one referenced condition.
- [ ] Every `requirement_id` in the plan exists in the declared spec_refs.
- [ ] No condition is orphaned: its behavior can be traced to a specification sentence.
      (If behavior is worth testing but the specification omits it, move it to `spec_gaps`; do not
      retain it as a condition.)

## D2 — Shape classification
- [ ] Every condition has exactly one `behavior_shape`; no behavior is forced into
      two shapes (split it if necessary).
- [ ] Do not assign `concurrent` to code running in a single-threaded event loop
      (Aeron Cluster logic → `stateful` + deterministic_replay).

## D3 — Technique fits shape (consult strategy-matrix.md)
- [ ] `mapping` has BOTH `round_trip` AND `field_sensitivity` conditions.
- [ ] `stateful` has at least one `property_kind: invariant` condition; include
      `model_based` when a reference model is feasible.
- [ ] `decision` has a `decision_table` condition; a Boolean expression with three or more
      operands has an added `mcdc` condition.
- [ ] `fixed_rule` uses `example`, without forced property testing.
- [ ] `property_kind` is present if and only if `technique = property`.

## D4 — Quality of each condition
- [ ] `behavior` is a testable sentence (subject, behavior, observable result), not a vague
      description such as "test order book".
- [ ] `rationale` explains why the technique fits the shape; it does not repeat `behavior`.

## D5 — Specification gaps
- [ ] Every ambiguous specification point encountered in design is recorded in `spec_gaps` with
      both interpretations; NEVER choose one yourself.
- [ ] `spec_gaps` exists even when empty (the schema requires it, forcing the Designer to consider it).

## D6 — Information boundary
- [ ] The entire plan was produced without referencing the implementation body. If implementation
      appeared in the context through misconfiguration, report it to the harness instead of using it.

## D7 — Schema and layout
- [ ] `plan.json` is valid against `schemas/test-plan.schema.json`; EVERY condition file is valid
      against `schemas/test-condition.schema.json`: required fields, correct ID pattern, no extras.
- [ ] The sharded layout is correct: filename equals `id`, each condition's `plan_id` matches its
      parent directory, and no file combines multiple conditions (R-T10).
- [ ] All mutations use harness operations or atomic shard replacement; never local text editing (R-T10).
