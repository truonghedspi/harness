---
inclusion: fileMatch
fileMatchPattern: "src/main/java/**"
---

# Cluster-service Java: determinism is a hard gate

You are editing code that runs inside (or next to) an Aeron Cluster ClusteredService.
Before writing, read `docs/03-aeron-determinism-rules.md` in full. Non-negotiables:

- No wall-clock time (`System.currentTimeMillis`, `Instant.now`, …) — use the log-entry
  timestamp or `cluster.time()`.
- No RNG (`Math.random`, `UUID.randomUUID`, unseeded `Random`) — monotonic counters in state.
- No threads, no blocking I/O (JDBC/HTTP/file) in the message path.
- No float/double for money or quantities — fixed-point longs with documented scale.
- Validate-then-apply: a command must never leave state half-mutated.
- Every new piece of mutable state goes into the snapshot, restore, and state hash.

`tools/check-determinism.sh` scans for violations and runs in `./init.sh`; justified
exceptions need an inline `// determinism-ok: <reason>` comment.
