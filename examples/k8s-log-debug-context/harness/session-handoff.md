# Session Handoff — Kubernetes Log Debug Context

Written mid-feature or on escalation (Lesson 12).

## Current Objective

- Goal: deliver the approved 11-feature Kubernetes Log Debug Context MVP through the router-selected loop.
- Checker (standalone full-treatment pass, 2026-08-28) approved feat-001..004 and feat-012, rejected feat-005.

## Verdicts this session (checker, standalone — mechanical promote pass was broken by a harness cwd bug)

| Feature | Verdict | Verification result |
|---|---|---|
| feat-001 | APPROVE (done) | `node harness/init.mjs` exit 0, BaselineTest Tests run: 1, Failures: 0 |
| feat-002 | APPROVE (done) | `./mvnw -q -Dtest=IngestServiceTest test` exit 0, Tests run: 2, Failures: 0 |
| feat-003 | APPROVE (done) | `./mvnw -q -Poracle-test -Dtest=IngestContractTest test` exit 0, Tests run: 5, Failures: 0 |
| feat-004 | APPROVE (done) | `./mvnw -q -Dtest=OpenSearchLogIndexIT verify` exit 0, Tests run: 2, Failures: 0 |
| feat-005 | REJECT (in-progress, attempts 1/3) | `./mvnw -q -Poracle-test -Dtest=OpenSearchStorageContractIT verify` exit 0, Tests run: 7, Failures: 0 — but no bounded per-test timeout |
| feat-012 | APPROVE (done) | `env -u JAVA_HOME node harness/init.mjs` exit 0 — init.mjs auto-selects Homebrew OpenJDK 21 for `./mvnw` only; host Temurin 25 control goes red (exit 1) |

## feat-005 reject reason (concrete, actionable)

`OpenSearchStorageContractIT` is an integration test against real OpenSearch but carries no JUnit
`@Timeout` and no transport timeout configuration, unlike the sibling `McpHttpContractIT` (`@Timeout`
20s) and `CollectorIngestContractIT` (`@Timeout` 90s). A stalled store is bounded only by the implicit
30s socket / 1s connect transport defaults and 10s retry-loop deadlines, none of which is a
stack-appropriate per-test timeout. This violates `harness/docs/constraints.md` MUST lines 14-17.
Fix: add a JUnit `@Timeout` and re-claim.

## Open decision (resolved 2026-08-28)

- **OpenSearch provisioning** — the owner chose **local ephemeral OpenSearch via Colima**.
  Colima is running; OpenSearch 2.19.1 serves `http://localhost:9200` with security disabled and
  the ISM plugin (`opensearch-index-management`) present.
  Caveat: this proves the real-store boundary but does not probe the real scoped A-007 role grants —
  that remains a target-environment preflight.

## Verification Evidence

| Check | Command | Result | Notes |
|---|---|---|---|
| Baseline | `node harness/init.mjs` (JAVA_HOME=openjdk@21) | green | System-default Temurin 25 is rejected by the Java gate. |
| OpenSearch | `curl http://localhost:9200/` | HTTP 200 | OpenSearch 2.19.1, security disabled, ISM reachable. |
| feat-005 | `./mvnw -q -Poracle-test -Dtest=OpenSearchStorageContractIT verify` | 7 tests green | Runs against the live store. |

## Next Session Startup

1. Run `node harness/loop/route.mjs --json` and dispatch the named node.
2. Every Maven command needs `JAVA_HOME=/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home`.
3. feat-005 needs a JUnit `@Timeout` on `OpenSearchStorageContractIT` before it can be re-checked.
