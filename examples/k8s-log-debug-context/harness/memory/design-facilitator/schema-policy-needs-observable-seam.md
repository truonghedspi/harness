---
name: schema-policy-needs-observable-seam
description: X-008 required an index-boundary invariant before additive-v1 and unsupported-major cases could have an independent contract oracle.
metadata:
  type: lesson
  date: 2026-08-26
---

A policy row saying "allow additive fields and reject unsupported majors" is insufficient for this
project's prove feature: it does not state what an oracle can observe. `INV-SCHEMA-1` makes both
branches independently checkable through the index port—an additive v1 payload invokes it, while an
unsupported-major payload produces a validation error and zero invocations.

**Why:** schema compatibility is enforced before indexing, so acceptance alone cannot distinguish a
quietly ignored invalid record from a correctly normalized one.

**How to apply:** whenever a cross-cutting policy feeds a prove feature, write the policy's positive
and negative paths as one named invariant with a public or adapter-bound seam before the planner cuts
or retires the design marker.
