# Aeron Cluster Determinism Rules

Every cluster node replays the same log. If two nodes compute different state from the same
log, that is silent divergence — wrong positions and P&L on some nodes, detected late. These
rules are therefore hard gates, enforced by `tools/check-determinism.sh` and code review.

## Forbidden inside the ClusteredService

| Forbidden | Use instead |
|---|---|
| `System.currentTimeMillis()`, `Instant.now()`, `LocalDateTime.now()`, `new Date()` | The `timestamp` parameter of `onSessionMessage`/`onTimerEvent`, or `cluster.time()` |
| `Math.random()`, `new Random()` (unseeded), `UUID.randomUUID()`, `ThreadLocalRandom` | Monotonic counters in state; `UUID.nameUUIDFromBytes` for content-derived ids |
| `new Thread`, `Executors`, `CompletableFuture.*Async`, `parallelStream()` | The single service thread — use it fully |
| JDBC, HTTP, file I/O, Redis/Kafka calls in the message path | In-memory state only; side effects go out via egress/publications from the LEADER, post-commit |
| `float`/`double` for money or quantities | Fixed-point `long` ticks/lots with documented scale, or scaled decimal |
| `HashMap`/`HashSet` iteration when order affects logic | Agrona `Long2ObjectHashMap` etc., `LinkedHashMap`, or `TreeMap` |

Justified exceptions (e.g. `System.nanoTime()` for pure latency measurement) carry an inline
`// determinism-ok: <reason>` comment, which the scanner honors and the reviewer re-checks.

## TimesTen construct → Aeron replacement map

| TimesTen construct | Replacement in the cluster service |
|---|---|
| `SYSDATE` / `SYSTIMESTAMP` | Cluster timestamp from the log entry (decide TZ + granularity in docs/04) |
| `sequence.NEXTVAL` | Monotonic counter in service state, included in snapshots (gap semantics: docs/04) |
| Transactions, row locks, `SELECT … FOR UPDATE` | Total-order log + single-threaded service. Validate-then-apply per command: run ALL validations first, then mutate — a log entry must never leave state half-mutated |
| Triggers | Explicit calls inside the owning command handler |
| `NUMBER` arithmetic | Fixed-point `long` / scaled decimal; scale and rounding per unit, matched to captured vectors |
| Scheduled jobs (`DBMS_JOB` etc.) | `cluster.scheduleTimer(correlationId, deadline)`; timer registrations included in snapshots |
| Read/reporting queries | NOT in the cluster — build read models off egress events (CQRS) |
| Error handling (`RAISE_APPLICATION_ERROR`, exceptions) | Explicit rejection events with stable error codes |

## Snapshot completeness

A snapshot must capture **all** mutable state, or restore diverges:
business entities, every sequence/ID counter, timer registrations, per-session state,
deduplication sets, and derived indexes you don't recompute. The snapshot round-trip test
(state hash before == after restore) is mandatory for every new piece of state.

## Idempotency

Every command carries a `correlationId`; the service keeps a bounded dedup structure (also
snapshotted). Duplicate delivery must produce a duplicate-ack, never a double effect. This is
non-negotiable for financial commands.

## Review checklist (run before marking `implemented`)

- [ ] `tools/check-determinism.sh` clean
- [ ] No time, RNG, threads, blocking I/O in service code without `determinism-ok`
- [ ] All money/quantity fields fixed-point with documented scale
- [ ] Validate-then-apply: no partial mutation on any rejection path
- [ ] New state included in snapshot + restore + state hash
- [ ] External effects emitted only on the leader, after commit
- [ ] Determinism replay test passes: same message sequence twice → identical state hash
