# Anti-Patterns — rules R-T1…R-T9

Every rule has an ID the Reviewer cites on REJECT. The Implementer self-checks before output.
Each rule includes a statement, rationale, detection method (preferably mechanical), and violation example.

---

**R-T1 — A mapping-test fixture/generator must be pairwise distinct.**
Every base-object field has a value distinct from every other field.
*Rationale:* equal field values hide a field swap—both field sensitivity and recursive comparison are blind.
*Detection:* the generator has `.filter(x -> x.allFieldValuesPairwiseDistinct())`, or the fixture
factory asserts distinctness; absence is a violation.
*Typical violation:* `price = 100, stopPrice = 100`; `symbol = "VNM", isinCode = "VNM"` (lazy placeholders).

**R-T2 — A `mapping` test must compare the complete object.**
Use `usingRecursiveComparison()` (or record equality covering every field). Do not assert a
"significant" field subset.
*Rationale:* swap/omission bugs live exactly in unasserted fields.
*Detection:* a mapper test chains individual `assertThat(x.getA())...` calls without recursive comparison.

**R-T3 — Expected values must not be calculated with the logic under test (tautology).**
Calculate expected values manually from the specification (with a calculation comment), derive them
from an independent reference model, or use a metamorphic relation. Do not call production code, or
copy its formula, to create the expected value.
*Rationale:* wrong code produces the identical wrong expected value, so the test is permanently green.
*Detection:* the expected side calls the class/method under test or repeats the implementation formula.
*Mutant-killing note:* testing "the value code currently returns" only to kill a mutant is a subtle R-T3;
the behavior must trace back to the specification/condition.

**R-T4 — An assertion must reach a real outcome, not stop at a mock.**
`verify(mock).someCall()` may support an interaction contract; a test with no assertion over real
state, return value, or event is a violation.
*Rationale:* verifying only a mock proves "code calls a function," not "the result is correct"—all
mutants in real logic survive.
*Detection:* the test body has only `verify(...)`/`verifyNoMoreInteractions`, with no output `assertThat`.

**R-T5 — Do not write assertion-free or meaningless-assertion tests.**
Examples include a lone `assertDoesNotThrow`, a lone `assertNotNull(result)`, or calling a method and ending.
The sole exception is a `parsing` property of "does not crash on malformed input," which must also assert
a controlled rejection (a specific outcome/error code).

**R-T6 — A test that cannot trace to a requirement is automatically rejected.**
Every test file has a `Conditions: ... | Requirements: ...` block comment; every test-case metadata
entry has a `requirement_id` in the specification registry.
*Rationale:* this is the control that ensures tests measure what code must do rather than what it does.

**R-T7 — Do not use nondeterministic sources in tests or generators.**
No `Instant.now()`, `System.currentTimeMillis()`, `new Random()`, or `Thread.sleep` to "wait for
stability," and no dependency on another test's execution order. Pass time through injectable `Clock`;
pass randomness through jqwik.
*Rationale:* flaky tests undermine the gate—an irreproducible failure cannot be arbitrated.

**R-T8 — A property must have a generator satisfying G1–G4** (see `references/generators.md`).
In particular, a command-sequence property using a non-colliding full-domain generator (price across
the full long range, cancel by random ID) violates G1 and is REJECT.

**R-T9 — Tests must not inspect the implementation to choose cases.**
Cases arise from specification/conditions. A comment such as "cover else branch on line 142" proves
the Designer/Implementer read the body and violated the information boundary. Exception: a mutant-killing
task may provide class, line, and mutator, but the asserted behavior must still come from the specification.

**R-T10 — Do not edit JSON artifacts with text edits; mutate through an operation or atomic shard replacement.**
Artifacts (plan.json, conditions, and case metadata) may be changed only by: (1) a harness operation
(`upsert_condition`…), (2) regenerating and replacing one whole shard file, or (3) a JSON Patch in a
harness-applied review flow.
*Rationale:* string replacement in long JSON has non-unique anchors, can leave a file broken between
edits, and bypasses the validation layer—violating the write-side "must parse" principle.
*Detection:* a diff shows an in-place edit inside a JSON file, a combined multi-condition file, or JSON
that does not parse after the edit.

---

## Quick reference for Reviewers

| Diff symptom | Suspected rule |
|---|---|
| Fixture has many fields with `100`, `"TEST"`, `1L` | R-T1 |
| Mapper test asserts 3/12 fields | R-T2 |
| Expected = `calculator.fee(...)` or a copied formula | R-T3 |
| Test body is all `verify(...)` | R-T4 |
| Bare `assertDoesNotThrow` | R-T5 |
| No Conditions/Requirements comment | R-T6 |
| `Instant.now()`, `sleep(50)` | R-T7 |
| `Arbitraries.longs()` for price, cancel by random ID | R-T8 |
| Comment mentions implementation line number / branch | R-T9 |
| Diff edits within a JSON file or combines conditions | R-T10 |
