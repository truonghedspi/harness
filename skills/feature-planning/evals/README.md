# Feature-planning capability evals

`run-fixtures.mjs` is the deterministic regression set. It proves the checker can go green on a
complete build/prove plan and red on two failures that previously passed planner self-review:
orphan builds and invented invariant citations.

The `inputs/ledger/` scenario is a behavioral pilot for paired with-skill/baseline runs. Assertions:

1. output parses and passes `scripts/check-plan.mjs`;
2. the two named components become build features;
3. both acceptance scenarios become prove features;
4. every build is consumed by independent proof;
5. `INV-LEDGER-1` and `INV-LEDGER-2` are cited by apt falsifiers;
6. every feature has a bounded implementation handoff and runnable Node command.

Pilot result, 2026-08-15, one run per configuration: both produced four features, but the skill run
passed all mechanical assertions while the no-skill baseline left `feat-transfer-validator` with no
prove feature depending on it (`build-unproven`). This is diagnostic evidence, not promotion: one
visible fixture cannot establish semantic competence or variance. Add parameterized/hidden domains
before graduating the planner to unattended use.

Legacy-target calibration: running the checker against `aeron-demo` found no missing `kind`
findings, but reported 192 findings dominated by fields that predate this capability contract
(`context`, attempts and other required state). That is not evidence that HI-017 is resolved:
older targets need an explicit adoption/upgrade path before this checker can judge them fairly.

Run the deterministic set:

```bash
node skills/feature-planning/evals/run-fixtures.mjs
```
