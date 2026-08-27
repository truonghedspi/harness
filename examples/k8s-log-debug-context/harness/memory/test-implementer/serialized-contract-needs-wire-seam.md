---
name: serialized-contract-needs-wire-seam
description: A serialized contract oracle cannot be assertion-red until the wire shape and callable seam exist in approved artifacts.
metadata:
  type: lesson
  date: 2026-08-26
---

TP-INGEST-0003 specified semantic outcomes at the serialized-ingress/index-port boundary, but the
approved artifacts supplied neither the serialized scope/attribute shape nor an ingress/index-port
interface signature. The product classes were also absent, so the exact verification could only
fail because no matching test existed; inventing an API in the oracle would have turned the test
into an unapproved interface decision.

**Why:** A condition can be semantically complete while still lacking the observable protocol an
implementer needs. Reflection or a test-only adapter merely hides that invention, and a compile-red
test violates the harness requirement that red be an assertion failure for the intended behavior.

**How to apply:** Before implementing a serialized boundary condition, confirm the approved inputs
name the wire fields and a callable interface. If either is absent, return a spec gap to the
test-designer/design owner before writing test code. Also validate case-metadata IDs early: this
run's conditions use `INV-*`, while the copied test-case schema accepts only `REQ-*`.
