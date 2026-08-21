---
name: baseline-gate-oracle-seam
description: A focused helper test can pass while never exercising the baseline gate the feature claims to prove.
metadata:
  type: lesson
  date: 2026-08-21
---

The `feat-001` oracle invoked `fetch-jdtls-fixture.mjs` directly. Its green result could not
falsify failures in `harness/init.mjs`, including skipped dependency installation, a skipped fixture
step, or swallowed command failures.

**Why:** A helper's correct behavior is not evidence that the production orchestration calls it or
propagates its failure.

**How to apply:** For a baseline-gate feature, inspect whether its recorded test invokes the
standard startup command and can make each claimed gate step fail. Treat helper-only coverage as a
test-design gap.
