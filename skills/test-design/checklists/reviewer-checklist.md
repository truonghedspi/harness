# Reviewer Checklist

Verdict: `APPROVE` | `REJECT` | `ESCALATE_SPEC`. Every rejection cites an R-T rule or checklist item plus an exact location. Do not approve with a bug-blocking caveat.

Test count, coverage percentage, style, and implementer confidence are not evidence. Evidence is traceability to the specification, compliance with R-T rules, and a killed relevant mutant.

## V1 — Review a test plan

- [ ] Independently run all of `checklists/designer-checklist.md`.
- [ ] Sample three P0/P1 requirements to detect missed specification reading.
- [ ] Confirm each `spec_gaps` location is genuinely ambiguous; invented gaps to avoid design are defects.
- [ ] Confirm sharded layout, atomic/operation mutation, and referential integrity (`plan_id` ↔ directory, `id` ↔ filename, case references exist). Violations reject under R-T10.

## V2 — Review test code

- [ ] Check every R-T1…R-T9 rule in `references/anti-patterns.md` and cite the rule on rejection.
- [ ] Every test file declares `Conditions | Requirements`, and its condition IDs exist in an approved plan.
- [ ] Assertions implement the condition behavior, not merely a technically plausible test.
- [ ] Property generators meet G1–G4: collision-prone values, explicit business boundaries, intentional valid/invalid mix, and long enough sequences.
- [ ] Field-sensitivity enumerates every schema/SBE field.
- [ ] A model-based reference model comes from an independent author or task, not the same engine diff.

## V3 — Gate outputs

- [ ] A PIT survivor in the diff rejects unless it is a reviewer-approved equivalent mutant.
- [ ] A new mutant-killing test kills its intended mutant.
- [ ] No test was disabled, commented out, or otherwise hidden to make the run green.

## V4 — Information boundary audit

- [ ] Inspect Designer/Implementer file-access logs. Any access outside the role allowlist rejects the artifact because oracle independence has failed.

## V5 — Arbitration

1. Quote the relevant specification sentence and location.
2. Compare code behavior with it.
3. Compare the test assertion with it.
4. Route a code defect to the coder or a test defect to Test-Implementer. If both readings are valid, return `ESCALATE_SPEC` with both interpretations.
5. Do not edit code or tests; classify, cite, and route only.
6. Escalate to a human if the same failure returns for a third non-converging cycle.
