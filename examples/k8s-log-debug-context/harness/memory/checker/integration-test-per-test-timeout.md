---
name: integration-test-per-test-timeout
description: A green integration test can still violate the bounded-timeout MUST; transport socket/connect defaults are mitigation, not a per-test timeout.
metadata:
  type: lesson
  date: 2026-08-28
---

`OpenSearchStorageContractIT` (feat-005, real-OpenSearch integration) reproduced green — 7 tests, 0 failures — yet violated `harness/docs/constraints.md` MUST lines 14-17: no JUnit `@Timeout` and no transport timeout configuration, while the sibling `McpHttpContractIT` (@20s) and `CollectorIngestContractIT` (@90s) both carry one.

**Why "it passed green" hides it:** the opensearch-java `ApacheHttpClient5TransportBuilder` sets implicit defaults (1s connect, 30s socket/response), and the test/impl add 10s retry-loop deadlines (`verifyAttachment`, `await`). Those bound each *request* or *loop*, not the *test*. A stalled store therefore fails loud within ~30s rather than hanging silently — which is mitigation, not the stack-appropriate per-test timeout the MUST names.

**How to apply:** when an integration/contract IT is in scope, grep the test for `@Timeout` (and `setRequestConfigCallback`/`setConnectionConfigCallback`) rather than trusting a green run. Transport defaults and retry deadlines do not satisfy the per-test-timeout MUST; flag the missing `@Timeout` even if the suite is green.
