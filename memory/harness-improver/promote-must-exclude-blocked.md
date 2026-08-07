---
name: promote-must-exclude-blocked
description: verify-harness.mjs --promote must never flip a status:blocked feature to done, even when its verification command exits 0
metadata:
  type: lesson
  date: 2026-08-07
---

`promoteFeatures()` originally only excluded features already `status: done` from promotion. Any
`blocked` feature with a stale `readyForCheck: true` and a (possibly narrowed) verification command
that still exits 0 would get mechanically flipped to `done`, silently overriding a human/checker
decision that passing evidence wasn't actually sufficient.

**Why:** found via real dogfooding on aeron-demo, not a synthetic test — `feat-sit-7`/`feat-sit-8`
had exactly this shape: a SIT narrowed to assert only a provable subset of the original requirement,
documented as blocked pending a human design decision, with a command that still passes. A
synthetic feature list is unlikely to accidentally construct this exact combination, which is
probably why the original test suite (`demo.sh`) didn't catch it before real use did.

**How to apply:** any future change to promotion/auto-approval logic anywhere in this skill must
treat `blocked` as a hard exclusion, symmetric with `done` — never inferred solely from a passing
command. `demo.sh` step 16 is the regression test; keep it green. If a similar "does the mechanical
check assume evidence-passing implies status-worthy" pattern shows up elsewhere (e.g. a future
consolidation or auto-close feature), check it against this same failure shape first.
