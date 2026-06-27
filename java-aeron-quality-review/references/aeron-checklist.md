# Aeron Cluster correctness checklist

Aeron Cluster replicates a `ClusteredService` by feeding every node the *same ordered message
stream* and replaying it deterministically. Correctness rests on three pillars: **determinism**,
**snapshot completeness**, and **message/schema compatibility**. A violation of any of these is a
Critical finding — it can cause nodes to diverge, fail to recover, or break log replay, often
silently until a failover or a restart.

Use this to interpret `scan_nondeterminism.sh` output and when reviewing any code under the cluster
service package.

## 1. Determinism — service logic must be a pure function of (ordered input, cluster time)

Two replicas processing the same message in the same order MUST reach byte-identical state. Anything
that can differ between nodes or between original-run and replay is a defect **inside service logic**
(handlers, state mutation, timer callbacks). Cold paths (bootstrap, config) are exempt.

Forbidden in service logic:
- **Wall-clock / system time** — `System.currentTimeMillis()`, `System.nanoTime()`, `Instant.now()`,
  `new Date()`, `LocalDateTime.now()`, etc. Use the timestamp Aeron supplies (`timestamp` argument /
  cluster `Cluster.time()`), which is recorded in the log and identical on replay.
- **Randomness** — `Math.random()`, `new Random()` without a logged seed, `ThreadLocalRandom`,
  `UUID.randomUUID()`. If you need an id, derive it deterministically (e.g. from cluster time +
  session + a counter).
- **Threads / async / I/O** — `new Thread`, executors, `CompletableFuture` async work, file/network
  I/O, blocking calls. Service logic is single-threaded and must not block the agent.
- **Unordered iteration** — iterating a `HashMap`/`HashSet`/`Collectors.toMap` and producing output
  whose order matters. Iteration order can differ across JVMs/versions. Use ordered/`Linked` or
  Agrona `Object2ObjectHashMap` only where iteration order doesn't affect emitted state.
- **Identity hash / default `toString`** — anything depending on `Object.hashCode()` / object
  identity, which varies per run.
- **Locale/timezone-dependent formatting** in state-affecting paths.

Confirming a true positive: ask "can this value differ between two nodes, or between the live run and
a later replay of the same log?" If yes → real. If it's in startup/config or in a purely-logging path
that never feeds state → not a determinism bug (may still be a perf/style note).

## 2. Snapshot completeness — all state in, all state out

A snapshot must capture **all** mutable service state so a node can restart or a new node can join by
loading it. The classic bug: add a field to the service, forget to add it to snapshot save/load →
recovered node silently diverges.

Check:
- Every mutable field that affects future output is written in `onTakeSnapshot` and read in the
  snapshot-load path. Diff the field list against the (de)serialization code.
- Save and load are symmetric — same fields, same order, same encoding.
- Snapshot encoding is versioned, so an older snapshot can still be loaded after a state shape change
  (or there's an explicit migration).
- Snapshot size is bounded — no unbounded collection that grows forever with no eviction/compaction.
  Unbounded snapshot growth is a slow-motion outage.

## 3. Message / SBE schema evolution — don't break replay

The cluster log contains historical messages encoded with the schema as it was *then*. Replay must
still decode them.

Check:
- Schema changes are **backward-compatible evolutions**: add new fields as optional/at the end, bump
  `sinceVersion`, never renumber/reorder/retype/remove existing fields.
- Decoders tolerate older versions (act on `actingVersion`), and don't assume new fields exist when
  decoding old messages.
- A genuinely breaking change is treated as a new message type + an explicit migration/replay
  strategy, not an in-place edit.
- Buffer reads are bounds-checked — a malformed or truncated message from ingress (untrusted input)
  must not throw out of the handler and kill the node.

## 4. Service lifecycle hygiene
- `onStart`, `onTakeSnapshot`, `onRoleChange`, `onSessionOpen/Close`, timers — used correctly and
  without hidden state that escapes the snapshot.
- Timers scheduled via the cluster API (deterministic), not `ScheduledExecutorService`.
- No business state stored outside the service (e.g. in a static, a cache, an external store) that
  won't be replayed/snapshotted.

When in doubt about an Aeron API detail, the `aeron-cluster` skill (if available) has deeper
architecture, testing, and tuning guidance — defer to it for framework specifics.
