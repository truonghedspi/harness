---
name: wording-drift-can-pass-oracles
description: A routing oracle and implementation can agree while a cited invariant states a different rule.
metadata:
  type: lesson
  date: 2026-08-21
---

The module-routing suite passed because both it and the implementation chose reactor-root routing,
but `INV-ROUTE-1` still said nearest POM. The mismatch only appeared when the checker compared the
literal invariant with the oracle.

**Why:** passing evidence proves the oracle's contract, not automatically the design rule named in
its traceability header.

**How to apply:** when a proof feature cites an invariant, read the invariant literally and compare
its quantifiers and exceptions with the fixture's reference model before treating a green run as
design confirmation.
