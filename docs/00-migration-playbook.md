# Migration Playbook

## Why this shape

TimesTen holds the logic as PL/SQL + SQL over shared mutable tables, with concurrency managed
by locks and transactions. Aeron Cluster holds it as a single-threaded, deterministic,
replicated state machine fed by a total-order log. The migration is therefore not a
translation but a re-expression — and correctness cannot be argued from reading code. It must
be demonstrated, per unit, against captured behavior of the old system (golden master).

## Phases

### Phase 0 — Foundations (feat-001..feat-005)

Build the rigs before migrating anything:
inventory extraction, golden-master capture rig, Aeron service skeleton with determinism
tests, parity runner, per-unit feature generation. No unit migration starts before feat-004
is done — otherwise "done" has no meaning.

### Phase 1 — Inventory

Machine-extract every logic-bearing object from TimesTen and from application-side SQL into
`inventory/inventory.json` (see docs/01). Re-run extraction regularly: the old system keeps
changing during the migration, and source drift automatically reopens affected units.

### Phase 2 — Per-unit migration (the bulk of the work)

Each unit's feature carries a `pipeline` field. Exit criteria per state:

| State | Exit criteria |
|---|---|
| `inventoried` | Unit exists in inventory.json and is mapped to exactly one feature |
| `specced` | `specs/<unit-id>.md` complete enough that a different agent could implement from the spec alone; every ambiguity logged in docs/04 |
| `golden-mastered` | Vectors captured per docs/02 minimums; stored vectors replay green against the TimesTen reference instance |
| `implemented` | Java implementation + domain unit tests green; `tools/check-determinism.sh` clean |
| `parity-verified` | Parity runner green on ALL vectors including edge vectors |
| `done` | coverage-check passes; evidence recorded; checker approved |

Unit ordering: topological order over the inventory dependency graph — leaf utilities
(units nothing here depends on calling first) before their callers. `feat-005` encodes this
order into feature dependencies.

Rules of engagement inside a unit:
- Implement from the **spec and vectors**, not by transliterating PL/SQL line by line.
  Transliteration copies TimesTen's accidental structure; vectors pin its actual behavior.
- If a vector fails and the spec is wrong, fix the spec first (and re-check its other
  consumers), then the code.
- If a vector fails because TimesTen's behavior is a bug the business wants fixed: that is a
  docs/04 decision with human sign-off, and the vector gets an explicit `waived` marker with
  the decision id. Never delete a failing vector.

### Phase 3 — Integration parity

Multi-command scenarios (`scenarios/*.jsonl`) replayed through cluster ingress. Assert:
1. Egress event stream matches expectations derived from the old system.
2. Final state hash matches across runs — every scenario run twice from clean state must
   produce identical hashes (determinism gate).
3. Snapshot round-trip: snapshot mid-scenario, restore into a fresh node, continue — final
   hash equals the uninterrupted run.
4. Failover: kill leader mid-scenario on a 3-node test cluster; no lost or duplicated effects.

### Phase 4 — Shadow run & cutover (human-led)

Dual-run old and new against mirrored production traffic with a continuous diff on outputs
and end-of-day state. Agents build and improve the diff tooling; go/no-go decisions,
thresholds, and the cutover itself are human-owned.

## Unit sizing

One unit = one externally invokable behavior: a public procedure/function, a package entry
point, a materialized view's derivation, a scheduled job. Private helpers migrate with their
callers — list them in the same feature's `sourceUnits` so the coverage denominator still
counts them.

**Two-layer flows (Java → TimesTen):** where business logic spans a Spring Boot service
method orchestrating one or more procs, the migration unit is the **Java entry point** — in
the new system that whole flow collapses into one cluster command handler. The feature's
`sourceUnits` lists the `java-service` unit AND every proc it calls, so those procs are
covered exactly once. A proc called from multiple Java flows migrates as its own unit
(shared logic), referenced as a dependency by each flow's feature — never absorbed twice.
Capture for two-layer units happens at the Java service boundary (docs/02), because that is
the behavior the new command must reproduce; per-proc vectors are still worth capturing when
the proc carries branching of its own.
