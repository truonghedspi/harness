# Decision Log — TimesTen ↔ Aeron semantic gaps

Every place where TimesTen behavior and the new system's behavior could legitimately differ
gets a decision here BEFORE implementation. Agents propose; decisions marked
`needs-human` block `done` for affected units until a human signs off.

## Template

```
## D-0NN: <title>
- Status: proposed | needs-human | decided
- Decided by: <human name or "pending">
- Affected units: <unit ids or "all">
- Context: <what differs and why it matters>
- Decision: <what the new system does>
- Parity impact: <how vectors/comparison rules encode this>
```

## Seeded decisions (resolve early — most units depend on them)

## D-001: Numeric scale and rounding mode
- Status: needs-human
- Context: TimesTen `NUMBER` is 38-digit decimal; the service uses fixed-point longs. The
  effective rounding mode of the old system is whatever its expressions actually did — the
  golden-master vectors reveal it. Do not assume HALF_UP.
- Decision: pending. Per-unit scale table to be recorded here as units are specced.

## D-002: NULL semantics
- Status: needs-human
- Context: SQL three-valued logic (NULL in comparisons, aggregates skipping NULLs) has no
  direct Java equivalent. Each unit's NULL vectors pin the observed behavior.
- Decision: pending. Explicit nullable types in SBE schema; per-unit notes in specs.

## D-003: String ordering and collation
- Status: needs-human
- Context: TimesTen NLS sort order vs Java `String.compareTo`. Matters anywhere logic sorts
  or range-compares strings.
- Decision: pending. Identify affected units from inventory; pin comparator per unit.

## D-004: Concurrency-dependent behavior
- Status: needs-human
- Context: the cluster serializes all commands; TimesTen allowed interleaved transactions.
  Any old behavior that depended on lock timeouts, deadlock handling, or read-committed
  anomalies has no equivalent. Enumerate such behaviors during spec; most become "cannot
  happen anymore" (document), some need explicit redesign.
- Decision: pending.

## D-005: Sequence gap semantics
- Status: needs-human
- Context: `NEXTVAL` produced gaps on rollback; monotonic counters in the service do not.
  If any downstream consumer infers meaning from gaps or exact values, it must be found now.
- Decision: pending.

## D-006: Time source, timezone, granularity
- Status: needs-human
- Context: `SYSDATE` (server-local TZ, seconds) vs cluster time (epoch ms, UTC). Every unit
  using SYSDATE must state required granularity and TZ handling.
- Decision: pending.

## D-009: Data acquisition paths (zero-PROD-access)
- Status: needs-human
- Context: the migration team has no PROD rights. Each PROD-derived artifact must come
  from an existing exported copy, requested from its owning team (log platform, compliance
  archive, DBA backups, back-office EOD reports — see docs/05 §Zero-PROD-access mode).
- Decision: pending — record per artifact: source system, owning team, request status,
  delivery cadence. Units with no obtainable real traffic are marked `synthesized-only`.

## D-008: Masking policy for captured PROD data
- Status: needs-human
- Context: tapes copied to staging are masked deterministically. Fields participating in
  business logic (amounts, tiers, fee keys, symbols) must NOT be masked or parity results
  are fabricated. The exact allow/deny field list needs compliance + business sign-off.
- Decision: pending. See docs/05-capture-replay.md §Masking.

## D-007: Reporting/read queries
- Status: needs-human
- Context: read-only queries and reports move to a read model fed by egress events (CQRS);
  they must NOT run inside the cluster service. Inventory units that are pure reads get
  mapped to read-model features, still counted in coverage.
- Decision: pending.
