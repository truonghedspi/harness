# Designer Checklist — run all items before outputting a test plan

Correct every failed item in the relevant SKILL.md step, then run the checklist again. Output only when every item passes.

## D1 — Traceability and coverage

- [ ] Every P0 requirement has at least one referenced condition.
- [ ] Every `requirement_id` exists in declared `spec_refs`.
- [ ] No condition is orphaned from a specification sentence. Missing-but-testable behavior belongs in `spec_gaps`.

## D2 — Shape classification

- [ ] Every condition has exactly one `behavior_shape`; split mixed behavior.
- [ ] Do not label single-threaded event-loop code `concurrent`; Aeron Cluster logic is `stateful` plus deterministic replay.

## D3 — Technique matches shape

- [ ] `mapping` has both `round_trip` and `field_sensitivity` conditions.
- [ ] `stateful` has an invariant property and a feasible `model_based` condition.
- [ ] `decision` uses a decision table; boolean expressions with three or more terms also have MC/DC coverage.
- [ ] `fixed_rule` uses `example`, not a forced property.
- [ ] `property_kind` exists if and only if `technique = property`.

## D4 — Condition quality

- [ ] Each `behavior` is a verifiable sentence with a subject, action, and observable result.
- [ ] Each `rationale` explains technique-to-shape fit rather than restating behavior.

## D5 — Specification gaps

- [ ] Every discovered ambiguity appears in `spec_gaps` with both interpretations; none was chosen silently.
- [ ] `spec_gaps` is present even when empty.

## D6 — Information boundary

- [ ] The plan does not refer to implementation bodies. Report accidentally supplied implementation context instead of using it.

## D7 — Schema and layout

- [ ] `plan.json` and every condition validate against their schemas with required fields, matching IDs, and no unknown fields.
- [ ] The layout is sharded: filename equals `id`, `plan_id` equals its parent directory, and no file combines conditions (R-T10).
- [ ] Mutations use harness operations or atomic shard replacement, never local JSON text edits (R-T10).
