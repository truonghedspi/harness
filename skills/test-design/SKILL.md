---
name: test-design
description: Produces high-quality test plans, test conditions, property-based tests, and example tests from a specification. Use it for test plans, test cases, test conditions, property tests, unit tests, test-quality reviews, or arbitration of whether a failing test, code, or specification is wrong.
---

# Test Design

This skill defines the harness test-design process. The assigned role is **Test-Designer** (creates plans and conditions from the specification), **Test-Implementer** (turns conditions into test code), or **Reviewer** (evaluates both outputs). Read the section for the assigned role.

Principles for every role:

1. **The specification is the only source of truth.** Tests measure what code must do, not what its implementation currently does. A test that cannot be traced to a requirement is rejected.
2. **Choose test techniques by logic shape, not habit.** Classify behavior first, then consult the strategy matrix. Do not default to examples for everything.
3. **Property and example tests are peers.** Both implement a test condition; each fits different logic shapes.
4. **Every output is a schema-validated artifact.** Do not emit free prose. Fix validation errors rather than explaining them away.

## Information asymmetry — do not violate it

| Role | May read | Must not read |
|---|---|---|
| Test-Designer | specification, interface/API signatures, schemas | implementation body or existing component test code |
| Test-Implementer | test conditions, interface, `references/`, surviving-mutant report | implementation body, except the specified line for a mutant-killing task |
| Reviewer | everything | — |

If a role receives forbidden implementation content, stop and report it to the harness. Reading implementation turns an independent oracle into a copy of the code, including its defects.

## Five-step Test-Designer process

### 1. List atomic behaviors from the specification

Each behavior is one verifiable sentence (given/when/then or “X always/never Y”) and has a `requirement_id`: use the specification’s `REQ-<AREA>-<NNN>` or a design invariant `INV-<AREA>-<N>`. Missing or ambiguous requirements go in `spec_gaps`; do not invent an ID or choose an interpretation.

### 2. Classify the logic shape

Assign exactly one `behavior_shape` per behavior. Split behavior until this is possible.

| Shape | Recognition cue |
|---|---|
| `mapping` | field-to-field conversion between representations without business branching |
| `stateful` | outcome depends on operation history |
| `computational` | formulae, rounding, units, or arithmetic accumulation |
| `decision` | combined conditions determine an outcome |
| `parsing` | untrusted external bytes or text |
| `concurrent` | correctness depends on interleaving or memory visibility |
| `integration` | multiple components/services coordinate through contracts |
| `fixed_rule` | a specified fixed value or regulatory rule |

Read `references/strategy-matrix.md` for detailed recognition and examples.

### 3. Select a strategy from the matrix

Generate one or more conditions for each `(behavior, shape)`. `mapping` requires both round-trip and field-sensitivity properties. `stateful` requires an invariant over command sequences and uses model-based testing when a reference model is feasible. `fixed_rule` uses one example per fixed value. Every P0 requirement has at least one condition.

### 4. Produce sharded, schema-valid artifacts

Write a `plan.json` valid against `schemas/test-plan.schema.json`, plus one condition file per condition valid against `schemas/test-condition.schema.json`. Use the schema technique enum and a short rationale explaining why the technique matches the shape. Validate required fields, ID patterns, and `additionalProperties: false` before output. Use harness operations rather than direct file writes when available.

### 5. Self-review

Run every item in `checklists/designer-checklist.md`. Correct all failures before output.

## Test-Implementer process

1. Receive validated test conditions and the interface. Read the technique-specific reference: property conditions require `property-catalog.md` and `generators.md`; decision tables require `decision-table.md`; examples, boundaries, partitions, and transitions use `strategy-matrix.md`.
2. Use the supplied template rather than creating a new test structure. The stack is Java 21, JUnit 5, jqwik 1.8+, and AssertJ. Name tests after behavior, not implementation methods.
3. Start each test file with a block comment containing implemented `condition_id` and `requirement_id` values.
4. Check `references/anti-patterns.md` before output. Correct every R-T1…R-T9 violation.
5. For a surviving-mutant task, derive the behavior at the indicated line from the specification and conditions. Never assert the current implementation merely to kill a mutant.
6. When jqwik shrinks a counterexample, add a permanent fixed example test with `technique: regression_from_property`.

## Reviewer process

1. Read `checklists/reviewer-checklist.md` and `references/anti-patterns.md` before reviewing artifacts.
2. Verdicts are only `APPROVE`, `REJECT`, or `ESCALATE_SPEC`. Every rejection cites an R-T rule or checklist item and the exact violation. A bug-blocking “but” is a rejection, not an approval.
3. Test count, coverage, style, and confidence are not evidence. Accept only specification traceability, anti-pattern compliance, and mutant-killing evidence.
4. In arbitration, compare both code and test with the specification. If both interpretations are valid, return `ESCALATE_SPEC` with the ambiguous text and interpretations. Reviewers do not repair code or tests.

## Artifact layout and mutation protocol

Artifacts are sharded by ID, never kept as a long monolithic file:

```
plans/TP-OB-0001/
├── plan.json
└── conditions/
    ├── TCON-OB-0001.json
    └── TCON-OB-0002.json
cases/
└── TC-OB-0001.json
```

The filename equals `id`; a condition’s `plan_id` equals its parent directory; `conditions/` is the authoritative condition list.

Prefer, in order: harness operations (`upsert_condition`, `delete_condition`, `add_spec_gap`, `upsert_case`), atomic replacement of one complete shard, then RFC 6902 JSON Patch only as a review proposal. R-T10 forbids string replacement or text editing inside JSON, and forbids combined condition files.

## Reference map

| File | Read when |
|---|---|
| `references/strategy-matrix.md` | Designer classification/strategy selection; example templates |
| `references/property-catalog.md` | Implementing a property or selecting `property_kind` |
| `references/generators.md` | Always alongside the property catalog |
| `references/decision-table.md` | `technique: decision_table` |
| `references/anti-patterns.md` | Before implementation and review |
| `schemas/test-plan.schema.json` | Validating `plan.json` |
| `schemas/test-condition.schema.json` | Validating each condition |
| `schemas/test-case.schema.json` | Writing test-case metadata |
| `checklists/designer-checklist.md` | Designer self-review |
| `checklists/reviewer-checklist.md` | Every review |
