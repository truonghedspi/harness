---
name: routing-contract-contradiction
description: A green routing oracle can encode one side of a multi-module contract contradiction.
metadata:
  type: lesson
  date: 2026-08-21
---

A five-condition routing integration suite passed, including targeted mutants, yet approval was
invalid because the oracle asserted the outer reactor root while `INV-ROUTE-1` literally specifies
the nearest ancestor `pom.xml` directory. A module source file has both candidates.

**Why:** Mutant resistance shows that a test distinguishes wrong implementations of its chosen
reading; it cannot establish that the chosen reading is the approved contract.

**How to apply:** For multi-module routing reviews, compare every fixture's hierarchy against the
literal invariant and assumption wording. If a module pom makes two roots plausible, reject with
`NEEDS DESIGN` and require the invariant, feature behavior, and oracle to be aligned before replay.
