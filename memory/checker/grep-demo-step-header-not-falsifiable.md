---
name: grep-demo-step-header-not-falsifiable
description: a verification command that greps demo.sh's step() header text always matches, whatever the step's own assertions do — grep the OK/FAIL result or the exit code instead
metadata:
  type: lesson
  date: 2026-08-20
---

Caught on the `feat-shared-memory-*` features. Their `verification` field was
`bash harness-loop/scripts/demo.sh 2>&1 | grep -q "<phrase from the step title>"`. `step()` prints
its header before any assertion in that step runs, and `demo.sh` never exits early on a failure —
it runs every step regardless and only reports the accumulated `FAIL` flag at the very end. So the
header line prints, and the grep matches, whether the step's `expect()` calls inside it pass or
fail.

Confirmed by mutation: deliberately broke `memory-promote.mjs`'s evidence guard, re-ran the exact
verification command — exit 0, "verified," while the step itself printed two real `FAIL` lines.

**Why:** a maker/checker reading the verification field and the step title side by side sees them
as the same claim ("this step covers this behavior"), which is true — but the grep pattern doesn't
test the step's *result*, only that its *header ran*. The two look identical in a code review and
are not.

**How to apply:** when a feature's verification is `bash harness-loop/scripts/demo.sh 2>&1 | grep -q
"..."`, check what the pattern actually matches — a `step()` header line, or an `expect()`/`OK`/
`FAIL` line. If it's the header, reject and ask for either the plain exit code
(`bash harness-loop/scripts/demo.sh`) or a grep on the specific assertion text.
