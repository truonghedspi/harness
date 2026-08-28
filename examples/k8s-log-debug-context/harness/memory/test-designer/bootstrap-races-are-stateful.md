---
name: bootstrap-races-are-stateful
description: Classify external idempotent bootstrap races as stateful command-sequence invariants, not language-level concurrency tests
metadata:
  type: lesson
  date: 2026-08-28
---

An idempotent external-resource bootstrap can combine repeated calls with an already-exists race without becoming a `concurrent` behavior shape.

**Why:** The discriminating result is the resource state after different histories and caller orderings. The contract does not depend on JVM memory visibility or instruction reordering, so jcstress would target the wrong failure class.

**How to apply:** Represent create, repeat, and raced-create as command variants in a stateful sequence. Assert the fixed identities and singleton resource set as an invariant after each sequence; reserve `concurrent` for a spec that explicitly depends on thread interleavings or the language memory model.
