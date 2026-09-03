# Reviewer Checklist

Verdict: `APPROVE` | `REJECT` | `ESCALATE_SPEC`. Every REJECT cites a rule (R-T*)
or checklist item (V*) and a specific location. Do not give vague feedback. Do not
"approve but suggest a fix"—if that fix prevents a bug, it is REJECT.

Remember the anti-sycophancy rule: test count, coverage percentage, tidy code, and an
Implementer's confident tone are NOT evidence. The only evidence is specification traceability,
no R-T* violation, and killing the corresponding mutant.

## V1 — Review the test plan (Designer output)
- [ ] Re-run all of `checklists/designer-checklist.md` as an independent reviewer.
- [ ] Check omission risk: choose three random P0/P1 requirements and verify they have conditions;
      this is an inexpensive way to find specification sections the Designer missed.
- [ ] `spec_gaps` are sound: open the specification at each gap's `location` and confirm it is real.
      An invented gap to avoid design work is also an error.
- [ ] Layout and mutation: artifacts use the sharded layout; mutation uses an operation or atomic
      shard replacement; referential integrity remains intact (plan_id ↔ directory, id ↔ filename,
      and the referenced condition_id exists)—a violation is REJECT with R-T10.

## V2 — Review test code (Implementer output)
- [ ] Check EVERY R-T1…R-T9 rule in `references/anti-patterns.md`, using its symptom table. Cite
      the rule ID when rejecting.
- [ ] Every test file has a `Conditions | Requirements` block comment; every metadata condition_id
      exists in the approved test plan.
- [ ] The test implements the condition's EXACT behavior: reread its `behavior` sentence and compare
      the assertion. A technically appropriate test that asserts different behavior is REJECT.
- [ ] Property tests: generators satisfy G1–G4 (`references/generators.md`). Check specifically:
      is the price domain narrow enough to match, does cancel use a local index, and are business
      boundaries deliberately mixed in?
- [ ] Field sensitivity: the `Field` enum lists EVERY message field—count fields in the schema/SBE
      XML and compare with the enum. A missing field is precisely the gap it creates.
- [ ] Model-based: confirm the reference model came from an independent author or separate task,
      not the same diff as the engine.

## V3 — Compare gate output (when available)
- [ ] A surviving mutant in the diff area → REJECT with the mutant list, unless the Implementer
      marked it equivalent and explained it and the Reviewer agrees with each one.
- [ ] Does a newly added test kill the mutant it targets (mutant-killing task)? Compare reports
      before and after.
- [ ] No test is disabled, `@Disabled`, or commented out merely to make the suite green.

## V4 — Audit the information boundary
- [ ] Read the Designer/Implementer file-access log supplied by the harness: no access outside the
      role allowlist. A violation rejects the full artifact regardless of quality, because the
      independent oracle has failed.

## V5 — Arbitration (when a failed test needs a decision)
Fixed workflow:
1. Quote the relevant specification sentence verbatim with its location.
2. Compare code behavior to it: does code match or diverge?
3. Compare the test assertion to it: does the test match or diverge?
4. Conclude:
   - Code diverges and test matches → code defect verdict; route to Coder with the specification
     citation and counterexample (including jqwik seed for a property).
   - Test diverges and code matches → test defect verdict; route to Test-Implementer and name the
     rule or divergence.
   - Both are valid readings → `ESCALATE_SPEC`; cite the ambiguity and both interpretations. NEVER choose.
5. The Reviewer does not fix code or tests—only classifies, cites, and routes.
6. The same failure returns for a third non-convergent loop → stop and escalate to a human.
