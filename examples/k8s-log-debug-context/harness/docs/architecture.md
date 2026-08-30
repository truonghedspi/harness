# Architecture — Kubernetes Log Debug Context

Structured around the **Fresh Session Test** (Lesson 3): a new agent session given only this repo
must be able to answer all five questions below. If it can't, the knowledge isn't in the repo yet
— add it here.

## What is this?

Collect Kubernetes pod logs, index searchable debugging context, and expose it through MCP for
AI-assisted test failure diagnosis. The primary user is an engineering agent investigating a test
failure; the public contract is a bounded, read-only context query rather than direct access to the
cluster or database. The source requirement is `../requirement.md`.

The owner-approved topology is a node-level OpenTelemetry Collector DaemonSet for opted-in test
workloads, a Java 21/Maven ingest and MCP service, and OpenSearch. The current unapproved design
revision makes both index seams explicit: collectors submit OTLP (the pinned stock image's only HTTP
egress), and the OTLP-decode adapter unwraps each admitted log record into the v1 JSON contract it
submits to `IngestService.ingest(String)`; `IndexPort.index(NormalizedLogRecord)` receives an accepted
sanitized document; and `IndexPort.search(LogQuery)` returns a typed, bounded result through the
real `OpenSearchLogIndex(OpenSearchClient, String)` adapter. Before that adapter writes, the public
`OpenSearchLogIndexBootstrap.ensureInstalled` seam installs the versioned ISM policy, template, and
current daily index described in `docs/design/opensearch-retention.md`. MCP accepts valid Kubernetes
ServiceAccount JWTs and publishes exactly `search_logs` and `get_failure_context`.
`McpServiceBootstrap.start(McpHttpServerConfig, IndexPort, ServiceAccountJwtValidator)` starts the
Streamable HTTP boundary and returns its bound endpoint; tests use loopback port `0` plus capturing
dependencies. The detailed boundaries and invariants are in `docs/design/log-debug-context.md`;
owner-confirmed constraints are in `docs/assumptions.md`. The concrete cluster-security facts —
collector RBAC verbs/resources, the single `-service` ServiceAccount with no project-defined
Kubernetes RBAC, locally verified ServiceAccount JWTs whose JWKS refresh uses that account's
projected token and Kubernetes' built-in issuer-discovery binding, the OpenSearch-location config knob, and the one
default-deny-ingress NetworkPolicy with the three edges (collector→ingest, service→OpenSearch via
IndexPort, callers→MCP) — are in `docs/design/cluster-access-policy.md`.

## How is it organized?

```
collector/       Kubernetes DaemonSet configuration and collector pipeline
service/         Java ingest/redaction, OpenSearch adapter, correlation and MCP modules
charts/          installation values and opt-in/retention policy assertions
tests/           unit, contract, and Kubernetes journey tests
harness/         workflow, design, and verification controls (not product code)
```

Dependencies flow collector → ingest → index and MCP → correlation → index. `RunIdLogQuery` is
exact-match only; `WorkloadWindowLogQuery` is the namespace/workload/half-open-time-window
conjunction. Only server-side adapters hold Kubernetes/OpenSearch credentials; MCP callers use neither.

## How do I run it?

```bash
./harness/init.sh          # install + verify + baseline gate
./mvnw verify              # compile for Java 21 and run the implemented-feature baseline
./mvnw -Poracle-test -Dtest=IngestContractTest test
                            # run a named red/green contract oracle explicitly
```

## How do I verify it?

The three-level hierarchy is in `harness/docs/testing-standards.md`. Fast path:

```bash
./mvnw test                # implemented-feature baseline; expected-red contract oracles excluded
# Use each feature's -Poracle-test verification command for its named contract oracle.
# tests/k8s/run-journey.sh is introduced with the Kubernetes journey feature
```

`./harness/init.sh` is the full baseline gate.

## Where are we now? (current state)

The owner approved the topology, MCP policy, schema policy, and the OpenSearch ISM retention
mechanism. The current revision adds the public retention bootstrap seam after the serialized
ingress and bounded storage-query seams; it invalidates the prior digest and requires the human to
bind the renewed digest before implementation continues.
The local Docker daemon is disconnected and no OpenSearch endpoint is configured, so feat-005's
real-store proof is an environment checkpoint rather than a fabricated red result. The Java
21-compatible Maven baseline is green; product features remain not started.
Live status is in `harness/progress.md` and `harness/feature_list.json`; day-to-day state does not
belong here.
