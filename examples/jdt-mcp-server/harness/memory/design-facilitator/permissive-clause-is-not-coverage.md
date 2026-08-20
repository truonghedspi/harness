---
name: permissive-clause-is-not-coverage
description: INV-PROV-2's "or an explicit user override" read as coverage of the JDTLS_HOME commitment but constrained nothing — a permissive clause inside an invariant is a hole that greps clean
metadata:
  type: lesson
  date: 2026-08-20
---

A test-designer pass on `feat-jdtls-provisioner` (TP-PROV-0001) hit a gap the design looked like it
had covered. `INV-PROV-2` reads:

> The JDT LS distribution actually used is always the pinned version the build recorded, **or an
> explicit user override** — never "whatever was already in the cache"

A-005 commits the provisioner to a `JDTLS_HOME` override that skips the network fetch entirely, and
to a clear offline error. Grepping for the override finds `INV-PROV-2` and it *looks* answered. It
is not: the override clause is a **permission** — it widens what `INV-PROV-2` tolerates — and states
nothing that could ever be false. No falsifier could be derived from it, which is exactly what the
test-designer reported instead of guessing.

**The general shape:** in an invariant, `always X` is a constraint; `always X or Y` weakens the
constraint by exactly Y, and Y itself is left unconstrained. If a commitment appears in an invariant
only on the permissive side of an `or`, it has no coverage no matter how prominently it is named.
Fixed additively as `INV-PROV-3`/`INV-PROV-4` rather than by rewriting `INV-PROV-2`, so the
already-derived TCON-PROV-0001..0003 kept their exact meaning.

**How to apply:** when auditing this project's invariant tables for coverage of an assumption, do not
accept a row that merely *mentions* the behaviour — check that the row would be false if the
behaviour were absent. Several rows here carry `or`/`either` clauses (`INV-READY-1`, `INV-SYNC-1`,
`INV-CA-2`); in those the disjunction is between two acceptable *outcomes* of one constrained event,
which is sound. `INV-PROV-2`'s was a disjunction between two *sources of truth*, which is the
unsound kind. That distinction is the thing worth carrying forward.
