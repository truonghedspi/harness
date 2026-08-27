# Session Handoff — Kubernetes Log Debug Context

Written mid-feature or on escalation (Lesson 12), so the next session — or the loop's next
iteration — can resume without an information cliff.

## Current Objective

- Goal: deliver the approved 11-feature Kubernetes Log Debug Context MVP through the router-selected loop.
- Current router task: resolve `feat-009`'s collector execution seam before implementing its
  independent collector-to-ingest oracle.
- Oracle gap resolved and owner-approved at digest `4ff1c56ce4b88469`: `McpServiceBootstrap.start`
  accepts `McpHttpServerConfig`, `IndexPort`, and `ServiceAccountJwtValidator`, while a closable
  `RunningMcpServer.endpoint()` exposes the ephemeral real HTTP boundary. It replaces neither
  HTTP behavior nor JWT policy with a test-only shortcut.
- Current status: all ten `TP-MCP-0007` conditions now have executable case metadata and one real
  loopback-HTTP contract suite; its named command is assertion-red because the MCP bootstrap is absent.
  Docker/OpenSearch remains unavailable for feat-005's real behavioral proof.
- Branch / commit: uncommitted scaffold worktree.

## Completed This Session

- [x] Added a checksum-pinned Maven 3.9.11 wrapper and Java 21 release build.
- [x] Added a bounded JUnit baseline test and proved an intentional mutant makes the suite red.
- [x] Captured the local environment and removed project constraint placeholders.
- [x] Reached 13/13 structural coverage and zero setup blockers.
- [x] Routed the approved schema answer into feat-003's falsifier and cleared its `NEEDS DESIGN` marker without changing scope.
- [x] Completed `TP-INGEST-0003`: scope, redaction, required metadata, additive-v1 compatibility, and unsupported-major rejection each have traceable P0 conditions.
- [x] Removed the resolved schema spec gap and linked all five `TCON-INGEST-*` conditions from feat-003.
- [x] Completed `TP-INDEX-0005` against the real OpenSearch seam: metadata/message round-trip, exact run-id isolation, and namespace/workload/time fallback conjunction.
- [x] Linked all three `TCON-INDEX-*` conditions from feat-005 with no spec gaps.
- [x] Added `TP-MCP-0007` conditions for the 15-minute, 200-record, 256-KiB, five-second, no-pagination, and zero-write/zero-Kubernetes contracts.
- [x] Opened spec gaps instead of falsely attributing JWT authorization or the exact two-tool surface to unrelated invariants.
- [x] Added `INV-AUTH-1`: valid Kubernetes ServiceAccount JWT reaches normal validation, while
  missing/invalid JWT is rejected before dispatch or index query.
- [x] Added `INV-TOOLS-1`: initialization offers only tools and `tools/list` is exactly
  `search_logs`/`get_failure_context`; an unlisted tool cannot query the index.
- [x] Recorded the design receipt without changing feat-007, its conditions, implementation, or
  the existing approval file.
- [x] Replaced the two resolved TP-MCP-0007 spec gaps with P0 conditions covering valid, missing,
  and invalid JWTs; the initialization capability; the exact two-tool list; and unknown-tool rejection.
- [x] Linked `TCON-MCP-0007` through `TCON-MCP-0010` from feat-007.
- [x] Completed `TP-JOURNEY-0011` with nine P0 conditions for the correlated happy path,
  redaction, decoy-run/namespace isolation, record/byte/interval/deadline bounds, MCP-only access,
  trapped cleanup, and an honest A-006 preflight outcome.
- [x] Linked `TCON-JOURNEY-0001` through `TCON-JOURNEY-0009` from feat-011 without reading
  product implementation or executable tests.
- [x] Resolved the feat-003 design gap by defining the exact serialized v1 JSON ingress object,
  admission fields (`optIn`, `environment`), string-valued `attributes`, correlation mapping, and
  stable validation outcomes at the public `IngestService`/`IndexPort` seam.
- [x] Made the existing scope, redaction, metadata, and schema invariants observable through that
  seam without adding an unplanned invariant or product/test implementation.
- [x] Isolated red-first `contract` package tests from the default Maven baseline through the
  explicit `oracle-test` profile; prove-feature commands opt in without weakening either suite.
- [x] Re-ran the baseline green before the `feat-005` test-implementer turn.
- [x] Probed the real OpenSearch prerequisite and recorded the unavailable Docker daemon distinctly
  from an absent implementation; no fake or compile-only red was recorded.
- [x] Escalated the missing query-port API as `NEEDS DESIGN` instead of inventing signatures in the oracle.
- [x] Resolved that spec gap in design only: typed bounded `RunIdLogQuery` and
  `WorkloadWindowLogQuery`, `LogQueryResult`, exact/fallback filter semantics, and the
  `OpenSearchLogIndex` construction seam now give TP-INDEX-0005 a public storage boundary.
- [x] Kept the disconnected Docker/no-OpenSearch state as an environment checkpoint, not a fake
  test result; no implementation, test, feature-plan, or approval state changed.
- [x] Resolved feat-007's bootstrap oracle gap in design only: a real Streamable HTTP server can
  bind loopback port `0`, expose its actual endpoint, and accept captured `IndexPort` plus a
  deterministic `ServiceAccountJwtValidator` without reflection APIs.
- [x] Kept X-006 bounds server-owned and unchanged; `close()` releases the listener after
  black-box HTTP contract tests.
- [x] Added `McpHttpContractIT` covering all ten approved MCP conditions through the bootstrap,
  real HTTP requests, deterministic JWT validation, and a capturing `IndexPort`.
- [x] Added `mcp-tools.json` as the wire fixture and ten traceable `TC-MCP-*` metadata shards.
- [x] Recorded the exact assertion-red feature command: ten tests fail because the required public
  `McpServiceBootstrap` contract is absent, while the default baseline remains green.
- [x] Added and schema-validated `TP-COLLECTOR-0009` with four conditions covering one-object-per-request
  wire shape, metadata round-trip, field sensitivity, and the opt-in/environment decision table.
- [x] Audited the collector oracle's callable boundary without reading product implementation and
  escalated the missing launch/lifecycle contract as `NEEDS DESIGN`; no Docker command, image,
  environment variable, readiness convention, or fixture mount was invented by the test.

## Verification Evidence

| Check | Command | Result | Notes |
|---|---|---|---|
| Baseline | `node harness/init.mjs` | green | Maven verify ran one JUnit test using Java 21 release compatibility. |
| Red proof | `./mvnw -q test` with expected value changed 21→22 | red | One test failed; mutation was reverted immediately. |
| Coverage | `node check-coverage.mjs --target .` from `harness/` | green | 13/13 lessons. |
| Harness verification | `node tools/verify-harness.mjs --target . --run-features` from `harness/` | green | 0 blockers, 5 non-blocking warnings. |
| Feature plan | `node skills/feature-planning/scripts/check-plan.mjs --target . --json` from `harness/` | green | 11 features, 0 errors, 0 warnings; DAG unchanged. |
| Planner verification | `node tools/verify-harness.mjs --target . --skip-baseline --quiet` from `harness/` | green | No blocking planner or harness finding. |
| Oracle JSON | `jq empty harness/tests/design/plans/TP-INGEST-0003/plan.json harness/tests/design/plans/TP-INGEST-0003/conditions/*.json` | green | All six sharded artifacts parse; filenames, IDs, plan IDs, and schema fields were checked against the vendored schemas/checklist. |
| Oracle routing | `node harness/loop/route.mjs` | green | Router no longer reports an oracle gap for feat-003 and advances to feat-005. |
| Post-oracle baseline | `./harness/init.sh` | green | Maven verification and baseline remained green. |
| Storage oracle JSON | `jq empty harness/tests/design/plans/TP-INDEX-0005/plan.json harness/tests/design/plans/TP-INDEX-0005/conditions/*.json` | green | All four sharded artifacts parse and satisfy the vendored schema/checklist fields. |
| Storage oracle routing | `node harness/loop/route.mjs` | green | Router no longer reports an oracle gap for feat-005 and advances to feat-007. |
| MCP oracle JSON | `jq empty harness/tests/design/plans/TP-MCP-0007/plan.json harness/tests/design/plans/TP-MCP-0007/conditions/*.json` | green | The plan and six condition shards parse and satisfy the vendored schema/checklist fields. |
| MCP oracle routing | `node harness/loop/route.mjs` | green | Router selects design-facilitator for the two citable-invariant gaps on feat-007. |
| Revised design gate | `node tools/verify-harness.mjs --target . --skip-baseline --quiet` from `harness/` | green | 0 blockers; 6 pre-existing/non-blocking warnings, including expected uncovered-invariant warnings until test-designer adds feat-007 conditions. |
| Extended MCP oracle schema | `jq -e`/`jq -s -e` against the vendored plan and condition schema constraints | green | Plan plus `TCON-MCP-0007` through `TCON-MCP-0010` have exact allowed keys, valid IDs/enums, correct parent plan, and bounded strings. |
| Extended MCP traceability | `jq -e` over feat-007 conditions plus `node harness/loop/route.mjs` | green | All four new condition IDs are linked; router no longer reports `INV-AUTH-1` or `INV-TOOLS-1` uncovered and advances to feat-011. |
| Post-extension baseline | `node harness/init.mjs` | green | Maven verification and harness baseline remain green after the oracle update. |
| Journey oracle schema/layout | `jq -e` plus filename/id checks over `TP-JOURNEY-0011` | green | Plan and nine condition shards have exact schema keys, valid IDs/enums, bounded strings, matching parent plan, and matching filenames. |
| Journey traceability/routing | `jq -e` over feat-011 plus `node harness/loop/route.mjs` | green | All five falsifier invariants have P0 journey conditions; the router advances to test-implementer for feat-003. |
| Post-journey-oracle baseline | `./harness/init.sh` | green | Maven verification and the project baseline remain green after the feat-011 oracle update. |
| Reproduced lifecycle regression | `node harness/init.mjs` | red as diagnosed | Before isolation, Maven ran six tests and failed the five expected-red `IngestContractTest` cases because `IngestService` is not implemented. |
| Repaired baseline | `node harness/init.mjs` | green | Default Maven verification excludes only the red-first `contract` package and still requires/runs the implemented-feature baseline suite. |
| Explicit ingest oracle | `./mvnw -q -Poracle-test -Dtest=IngestContractTest test` | expected red | Exactly five tests ran and all five reached their assertions that the public `IngestService` contract is absent; the oracle was preserved. |
| Post-repair coverage | `node check-coverage.mjs --target .` from `harness/` | green | 13/13 lessons. |
| Post-repair verification | `node tools/verify-harness.mjs --target . --run-features` from `harness/` | green | Baseline green, 0 blockers, 5 non-blocking pre-existing warnings. |
| feat-005 startup baseline | `node harness/init.mjs` | green | Maven verification completed before oracle work. |
| OpenSearch environment probe | `docker info --format '{{.ServerVersion}}'` | checkpoint | Docker CLI exists, but the configured Colima socket does not exist; no OPENSEARCH environment is configured. This is not behavioral red evidence. |
| feat-007 startup baseline | `./harness/init.sh` | green | Maven verification completed before the test-implementer inspected the approved MCP conditions. |
| feat-007 callable-seam audit | `rg` over approved design, TP-MCP-0007, feature context, and service signatures | gap | Wire outcomes are specified, but no self-starting HTTP test seam or external-service lifecycle contract exists; therefore no honest assertion-level red run was recorded. |
| feat-007 case metadata | `jq empty service/src/test/resources/contracts/mcp-tools.json harness/tests/design/cases/TC-MCP-*.json` plus filename/id equality | green | Wire fixture and all ten case shards parse; IDs match filenames and every condition/requirement is traceable from the test header. |
| feat-007 explicit oracle | `./mvnw -q -Poracle-test -Dtest=McpHttpContractIT verify` | expected red | Ten tests compiled and reached the assertion that `io.harness.logcontext.mcp.McpServiceBootstrap` is absent; no compile error or missing fixture hid the behavior gap. |
| feat-007 post-oracle baseline | `./harness/init.sh` | green | The expected-red contract package remains isolated from the default implemented-feature baseline. |
| feat-009 startup baseline | `node harness/init.mjs` | green | Maven verification completed before the collector oracle audit. |
| feat-009 callable-seam audit | `rg` over approved design, `TP-COLLECTOR-0009`, feature context, and collector assets | gap | Conditions require the real collector configuration and a capture HTTP ingress, but no approved executable/image, launch arguments, fixture mount, readiness signal, or close protocol exists; assertion-red cannot be recorded honestly. |

## Files Changed

- docs/design/log-debug-context.md
- docs/architecture.md
- DECISIONS.md
- memory/design-facilitator/
- harness/tests/design/plans/TP-INGEST-0003/
- harness/tests/design/plans/TP-INDEX-0005/
- harness/tests/design/plans/TP-MCP-0007/
- harness/tests/design/plans/TP-JOURNEY-0011/
- harness/tests/design/plans/TP-COLLECTOR-0009/
- harness/feature_list.json
- harness/session-handoff.md
- pom.xml
- harness/docs/constraints.md
- harness/docs/architecture.md
- harness/memory/harness-setup/MEMORY.md
- harness/memory/harness-setup/red-first-oracles-need-separate-maven-profile.md
- service/src/test/java/io/harness/logcontext/contract/McpHttpContractIT.java
- service/src/test/resources/contracts/mcp-tools.json
- harness/tests/design/cases/TC-MCP-0001.json through TC-MCP-0010.json

## Decisions Made (also log in harness/DECISIONS.md)

- Owner's five confirmations are logged in `DECISIONS.md`; the recommended topology is Option A.

## Blockers / Risks / Human Checkpoints Hit

- **feat-007 implementation dependency:** the oracle is intentionally red until feat-006 supplies
  the approved public MCP lifecycle, bounded query service, and IndexPort query contract.
- **feat-009 design gap:** the oracle has validated conditions but no approved way to start the real
  collector configuration, inject pod-log fixtures and capture ingress URI, await delivery, or stop
  it within a bounded timeout. The test-implementer stopped instead of encoding an accidental
  Docker/image/env contract into the oracle.
- **feat-005 real environment:** the local Docker daemon is unavailable and no external OpenSearch
  endpoint is configured. This is an environment checkpoint, not behavioral red evidence; the
  contract must run against ephemeral real OpenSearch before a red or green result is claimed.
- A-006 node-log access remains an environment assumption until a Kubernetes preflight runs.
- The configured Kubernetes MCP connector has not completed a protocol-level read in this setup
  session; direct `kubectl` access is sandbox-restricted and belongs to the later preflight feature.
- No unresolved product-policy checkpoint remains; A-006 is intentionally deferred to the
  environment preflight owned by the collector/Kubernetes journey.

## Next Session Startup

1. Read `AGENTS.md`.
2. Run `node harness/loop/route.mjs --json` and dispatch exactly the named node.
3. Preserve WIP=1 and the checker-owned status transitions.
4. Run `./harness/init.sh` before editing.

## Recommended Next Step

- Route `feat-009` to the design-facilitator to define a hermetic, bounded collector execution seam
  (executable/image identity, config and fixture inputs, capture-ingress injection, readiness and
  shutdown). After owner approval, implement `CollectorIngestContractIT` directly from
  `TP-COLLECTOR-0009`; do not substitute static YAML inspection for the real pipeline contract.
