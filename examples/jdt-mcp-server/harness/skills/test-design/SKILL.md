---
name: test-design
description: Produce high-quality test plans, test conditions, property-based tests, and example tests from a specification through a five-step workflow and a logic-shape strategy matrix. This skill is REQUIRED whenever asked to write a test plan, test case, test condition, property test, unit test, or review test quality—including requests such as "write tests for class X" or "add tests to kill surviving mutants." Also use it to arbitrate whether a failed test is caused by incorrect code, an incorrect test, or an ambiguous specification.
---

# Test Design

This skill defines the harness workflow for producing test plans and test cases. The harness
assigns the agent role: **Test-Designer** (produces test plans/conditions from the specification),
**Test-Implementer** (implements conditions as test code), or **Reviewer**
(evaluates the output of the other two roles). Read the section for your assigned role.

Foundational principles for every role:

1. **The specification is the only source of truth.** Tests measure what code MUST do
   according to the specification, not what the implementation DOES. A test that cannot be
   traced to a requirement is worthless and the harness rejects it.
2. **Choose test techniques by logic shape, not habit.** Classify behavior first, then consult
   the strategy matrix. Do not default everything to example-based testing.
3. **Property and example tests are peers**—both implement a test condition, and each suits a
   particular logic shape.
4. **Every output is a schema-backed artifact.** Do not output free prose. Output that fails
   schema validation is returned with an error; fix the error rather than reinterpreting it.

---

## Information boundary (information asymmetry) — MUST NOT BE VIOLATED

| Role | May read | Must not read |
|---|---|---|
| Test-Designer | specification, interface/API signature, schema | implementation body; existing test code for the component being designed |
| Test-Implementer | test conditions, interface, `references/`, surviving-mutant report | implementation body (except for a mutant-killing task, where read only the specified line) |
| Reviewer | everything | — |

Why: if the Designer reads the implementation, tests collapse into a copy of code behavior,
including incorrect behavior, and their independent-oracle value disappears. If implementation
content appears in a context where the role is not permitted to read it, stop and report it to the
harness rather than using it.

---

## Five-step workflow (Test-Designer role)

### Step 1 — List behaviors from the specification

Read the specification and break it into atomic behaviors. Each behavior:
- Is one testable sentence (given/when/then or "X always/never Y").
- Has a `requirement_id`: `REQ-<AREA>-<NNN>` if the specification has a requirements document,
  or `INV-<AREA>-<N>` if it is taken directly from the design invariant table
  (`docs/reference/invariant-contract.md`). Both are valid; use the one the specification actually
  provides. Put a behavior without a specification requirement ID in the test plan's `spec_gaps`;
  NEVER invent an ID.
- If the specification is ambiguous (two valid interpretations), record both in `spec_gaps`.
  Do not choose one interpretation and continue.

### Step 2 — Classify the logic shape

Assign exactly one `behavior_shape` to each behavior using the quick-recognition table below.
When a behavior shows more than one shape, split it until every behavior has one shape. For
recognition detail and examples, read `references/strategy-matrix.md`.

| behavior_shape | Quick recognition signal |
|---|---|
| `mapping` | Field-to-field conversion between representations (DTO↔SBE, entity↔message), without business branches |
| `stateful` | Result depends on operation history (order book, session, FSM) |
| `computational` | Formulae, rounding, units, or arithmetic accumulation (fee, interest, risk metric) |
| `decision` | Multiple conditions combine to decide output (validation, routing, classification) |
| `parsing` | Receives untrusted external bytes/text |
| `concurrent` | Correctness depends on thread interleaving or memory visibility |
| `integration` | Coordinates several components/services by sequence and contract |
| `fixed_rule` | "if X, then exactly Y"—fixed values or statutory rules |

### Step 3 — Look up a strategy in the matrix

For each `(behavior, shape)`, consult `references/strategy-matrix.md` for the primary and
supporting strategy, then produce one or more test conditions. Rules:
- `mapping` MUST include both a round-trip property and a field-sensitivity property
  (templates in `references/property-catalog.md`, section 2 and its companion section).
- `stateful` MUST include at least one invariant property over a command sequence; use a
  model-based property when the specification supports a reference model.
- `fixed_rule` uses example tests, one test case for every fixed value.
- Every P0-priority requirement needs at least one condition. No exceptions.

### Step 4 — Produce a test plan in the sharded layout

Output the sharded layout (see "Artifact layout & mutation protocol"): a `plan.json` valid
against `schemas/test-plan.schema.json`, plus one separate condition file valid against
`schemas/test-condition.schema.json`. Set `technique` from the schema enum and briefly explain
in `rationale` why it fits the shape. Validate every file before output (required fields present,
correct ID pattern, no extra fields—schemas set `additionalProperties: false`). Write through a
harness operation rather than directly to files (R-T10).

### Step 5 — Self-check with the checklist

Work through every item in `checklists/designer-checklist.md`. If an item fails, return to the
corresponding step and fix it. Output only when the full checklist passes.

---

## Test-Implementer workflow

1. Receive validated JSON test conditions and the interface. For each condition, read the
   reference for its `technique`:
   - `property` → `references/property-catalog.md` (choose the property type from the condition's
     `property_kind`) + `references/generators.md`
   - `decision_table` → `references/decision-table.md`
   - `boundary_value`, `equivalence_partition`, `state_transition`, `example`
     → template in `references/strategy-matrix.md`
2. Fill in the template—do not invent a new test structure when a template exists.
   Stack: Java 21, JUnit 5, jqwik 1.8+, AssertJ. Name tests after behavior
   (`quantityIsConservedAcrossAnyCommandSequence`), not methods (`testApply1`).
3. Start every test file with a block comment listing the `condition_id` and `requirement_id`
   implemented by the file. This is the traceability link the Reviewer and harness compare.
4. Before output, check `references/anti-patterns.md` (rules R-T1…R-T9). A violation of any
   rule makes the Reviewer reject it with the rule ID, so fix it first.
5. **Surviving-mutant task:** input is a mutant report (class, line, mutator). Identify the
   behavior at that line *from the specification/conditions* and write a test asserting it. NEVER
   assert the code's current value merely to kill the mutant—that legitimizes a tautology (R-T3).
6. **Property failure → regression:** when jqwik shrinks a counterexample, add a permanent,
   fixed example test from that shrunk counterexample with `technique: regression_from_property`.

---

## Reviewer workflow

1. Read `checklists/reviewer-checklist.md` and `references/anti-patterns.md` BEFORE reading
   the artifact under review. Review compares against a checklist; it is not intuition.
2. There are only three verdicts: `APPROVE`, `REJECT`, `ESCALATE_SPEC`. Each REJECT must cite a
   rule ID (R-T*) or a specific checklist item and the violation location. Do not reject with
   vague feedback or approve with a "but should..."; a "but" that prevents a bug is REJECT.
3. Resist sycophancy: many tests, high coverage, and attractive code are NOT quality evidence.
   The only accepted evidence is tests traceable to the specification, without anti-patterns,
   that kill the corresponding mutant.
4. **Arbitration** (when a test fails): classify the cause by comparing both code and test to the
   specification—the side that diverges is wrong. If both are valid readings, return
   `ESCALATE_SPEC` and cite the ambiguous passage and both readings. Reviewers do NOT fix code or tests.

---

## Artifact layout & mutation protocol

Artifacts are **sharded by ID**—there is never one long monolithic file:

```
plans/TP-OB-0001/
├── plan.json                  # metadata + spec_gaps (test-plan.schema.json)
└── conditions/
    ├── TCON-OB-0001.json      # one condition per file (test-condition.schema.json)
    └── TCON-OB-0002.json
cases/
└── TC-OB-0001.json            # metadata for each test case (test-case.schema.json)
```

Invariants: the filename equals the `id` field; a condition's `plan_id` equals its parent
directory; `conditions/` is the source of truth for the condition list (do not maintain a duplicate
list in plan.json).

Mutation rules, in priority order:
1. **Harness operations** (when the tool is available): `upsert_condition`,
   `delete_condition`, `add_spec_gap`, `upsert_case`. Each operation validates schema and
   referential integrity before writing; errors are structured—fix the error and call it again,
   up to three times, then report to the harness.
2. **Atomic replacement of one shard** (when no operation is available): regenerate the ENTIRE
   small file and overwrite it; do not patch it locally.
3. **JSON Patch (RFC 6902)**—use only as the *proposal* language for changes in review flows
   (the Reviewer proposes; the harness applies and revalidates).

FORBIDDEN (R-T10): mutate artifacts by string replacement/text editing of JSON content, or output
a single file containing multiple conditions.

---

## Documentation map

| File | Read when |
|---|---|
| `references/strategy-matrix.md` | Designer steps 2–3; Implementer needs example-based templates |
| `references/property-catalog.md` | Implementer uses `technique: property`; Designer selects `property_kind` |
| `references/generators.md` | ALWAYS read with the property catalog—poor generators are the leading reason properties are useless |
| `references/decision-table.md` | A condition with `technique: decision_table` |
| `references/anti-patterns.md` | Implementer before output; Reviewer before review |
| `schemas/test-plan.schema.json` | Designer, step 4—validate `plan.json` |
| `schemas/test-condition.schema.json` | Designer, step 4—validate each condition file |
| `schemas/test-case.schema.json` | Implementer when outputting metadata for each test case |
| `checklists/designer-checklist.md` | Designer, step 5 |
| `checklists/reviewer-checklist.md` | Reviewer, always |
