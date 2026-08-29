# Design — Kubernetes Log Debug Context

**Recommendation:** use an opt-in, node-level OpenTelemetry Collector DaemonSet that sends normalized records to a Java ingest/MCP service backed by OpenSearch; keep pod injection as a fallback for log sources unavailable from the node. This is a recommendation, not approval.

## Scope and evidence

This design covers the first vertical slice: selected test workload stdout/stderr reaches a searchable store and a read-only MCP server returns bounded diagnostic context. It excludes production tenancy, arbitrary application log-file collection, write tools, and an autonomous diagnosis agent.

| Claim | Evidence |
|---|---|
| The product must collect selected pods automatically without application log calls. | requirement.md:5-11,15 |
| A record must retain Kubernetes identity, timestamp, and correlation when available. | requirement.md:16-17 |
| MCP must be read-only and bounded, without direct database or unrestricted Kubernetes access. | requirement.md:19-21 |
| One Kubernetes journey must prove emit → collect → index → MCP context. | requirement.md:22-23 |
| Node-level collection, OpenSearch, seven-day opt-in scope/redaction, Java 21/Maven, and test.run_id preference were confirmed by the owner. | docs/assumptions.md:24-28; docs/cross-cutting.md:23-27 |
| Additive v1 fields must remain compatible and unsupported major versions must be rejected before indexing. | docs/cross-cutting.md:30 (X-008, project owner / 2026-08-26) |
| Cluster-internal MCP callers authenticate with a Kubernetes ServiceAccount JWT and the deployment restricts the path with NetworkPolicy. | docs/cross-cutting.md:29 (X-007, project owner / 2026-08-26) |
| The MCP proof must publish exactly `search_logs` and `get_failure_context`, including the valid, missing, and invalid JWT paths. | feature_list.json:56-62 (feat-007) |

## Decision frame (PrOACT)

**Problem.** A debugging agent needs relevant test logs through one constrained interface, but current test failures provide neither a searchable record nor safe cluster/database access.

**Objectives / trade-offs.** The owner values automatic selected-workload coverage, useful Kubernetes/test correlation, bounded read-only diagnostics, a Kubernetes proof, and a redacted non-production MVP. The axes are node-access acceptance, non-stdout coverage, per-pod overhead, footprint, and deployment simplicity; their weight remains the owner's choice (requirement.md:15-23, docs/cross-cutting.md:25-27).

## Options generated before applying the confirmed preference

### Option A — node-level collector, ingest boundary, search store (recommended)

selected pod stdout/stderr → OpenTelemetry Collector DaemonSet → Java ingest/redaction → OpenSearch → Java read-only MCP server

Argument map:

- **Conclusion:** use a node-level Collector DaemonSet for the first slice.
  - It covers selected pods automatically, as required (requirement.md:9-11,15).
  - It matches the confirmed node-level topology and reserves sidecars for unavailable node logs (docs/cross-cutting.md:23).
  - The ingest service is the single pre-index point at which scope and redaction can be proved (docs/cross-cutting.md:25).
- **Objection:** node-level collection needs permitted host-log access and does not capture an application-private path.
  - **Response:** record cluster access as A-006 and treat sidecar injection as a documented fallback, not a hidden exception.

### Option B — inject a sidecar or Java agent into every selected pod

selected pod + injected sidecar/agent → ingest/redaction → OpenSearch → MCP

Argument map:

- **Conclusion:** inject a per-pod collector where node-level collection cannot observe the relevant source.
  - It can collect an application-private file as well as stdout/stderr.
  - Its lifecycle is visibly coupled to the workload it observes.
- **Objection:** it changes every opted-in workload and introduces per-pod resources, failure modes, and injection policy.
  - **Response:** this conflicts with the confirmed node-level preference; retain it only as the exception path (docs/assumptions.md:24).

## Recommendation and rejected alternative

Recommend **Option A**: an OpenTelemetry Collector DaemonSet for the initial implementation. Its premises are the owner-confirmed node topology, bounded test-only data boundary, and repeatable end-to-end proof; Option B remains a later adapter. Host-log denial or file-only logs changes the recommendation for that workload class (A-006); the owner may instead prefer file-log coverage or stricter node isolation.

## Chosen shape and boundaries

The owner approved this shape and the X-007 credential boundary on 2026-08-26. The MCP server, not its callers, owns token validation; server-side adapters, not callers, own any Kubernetes or OpenSearch credentials. A later edit still requires a digest-bound human reapproval before downstream work resumes.

| Component | Boundary and responsibility | Observable seam |
|---|---|---|
| Eligibility policy | Reads configured namespace/workload opt-in metadata; accepts or rejects a candidate record before ingestion. | Accepted/rejected decision with reason and normalized Kubernetes identity. |
| Node collector | DaemonSet tails node-visible container stdout/stderr, enriches each eligible record with Kubernetes metadata, and sends it to ingest; its non-cluster oracle starts through `CollectorContractBootstrap`. | One serialized ingress request per record; `RunningCollector.awaitReady()`/`close()` lifecycle and collector delivery observation. |
| Ingest and redaction service | Parses the v1 serialized ingress record, verifies scope and metadata, applies configured redaction, normalizes correlation, then writes only sanitized documents. | `IngestService.ingest(String)` result and `IndexPort.index(NormalizedLogRecord)` invocation. |
| Log index adapter | Maps sanitized documents to OpenSearch and executes constrained searches; it exposes no database protocol to MCP callers. | `IndexPort.search(LogQuery)` result, including records and truncation status. |
| Correlation resolver | Resolves a failure request by test.run_id, or by namespace, workload, and caller-supplied bounded time window when the id is absent. | Resolved query plan or explicit insufficient-correlation result. |
| MCP query server | Validates the ServiceAccount JWT before dispatch; exposes exactly search_logs and get_failure_context; validates input bounds and maps results to diagnostic context. | `McpServiceBootstrap.start` lifecycle, initialization/tool-list and HTTP responses, plus captured validator/index calls. |
| Kubernetes journey fixture | Emits a unique test log from an opted-in workload and queries it through MCP; it is test-only. | Public MCP response containing emitted marker and Kubernetes/test context. |

Dependency direction is one-way: collector → ingest → index; MCP → correlation resolver → index. The MCP server never calls Kubernetes or OpenSearch directly, and the collector never invokes MCP.

## Data and query contract

### Serialized ingress v1

The collector's only HTTP egress is OTLP; the OTLP-decode adapter unwraps each admitted log record
into one UTF-8 schemaVersion-1 JSON object — the ingest module's black-box input, used by tests and
future adapters rather than a parser or normalization helper. See [collector-ingress-mechanism.md](collector-ingress-mechanism.md). These top-level members are required in v1:

```json
{
  "schemaVersion": 1,
  "observedAt": "2026-08-26T09:45:00Z",
  "message": "payment test failed",
  "namespace": "ci-payments",
  "pod": "payments-test-7dc9b",
  "container": "test-runner",
  "workload": "payments-test",
  "source": "stdout",
  "optIn": true,
  "environment": "test",
  "attributes": {
    "test.run_id": "run-8842",
    "log.level": "ERROR"
  }
}
```

`schemaVersion` is the JSON number `1`. `observedAt` is an RFC 3339 instant. `message`,
`namespace`, `pod`, `container`, and `workload` are non-blank strings. `source` is exactly
`stdout` or `stderr`. `optIn` is the JSON boolean `true`, and `environment` is the non-blank
configured non-production environment name; the MVP policy admits `test` only. `attributes` is
a JSON object with string keys and string values; it may be empty. `test.run_id` is optional and,
when present, is a non-blank attribute value. It becomes the normalized record's correlation
field, not a user-controlled replacement for any Kubernetes identity field.

The collector obtains `optIn` and `environment` from selected workload/namespace metadata before
serialization; they are admission facts, not searchable input. Ingest rejects missing/false opt-in
or an unallowed environment before indexing. It ignores additive v1 members without allowing one
to replace a named field; unsupported majors, non-object JSON, wrong types, and unknown sources
are validation rejections.

### Collector executable bootstrap

The owner-approved OCI launcher is in [`collector-contract-launch.md`](collector-contract-launch.md); the wire mechanism is in [`collector-ingress-mechanism.md`](collector-ingress-mechanism.md).

NormalizedLogRecord is the only document supplied to the index adapter. Its fields are
`schemaVersion`, `observedAt`, `message`, `namespace`, `pod`, `container`, `workload`, `source`,
optional `testRunId`, and redacted `attributes`. X-008 fixes the compatibility policy: an otherwise
valid `schemaVersion: 1` record must tolerate additive fields it does not recognize, while a record
with an unsupported major version is rejected before it reaches the index port. An additive input
field cannot overwrite a normalized field or bypass validation/redaction.

### Ingest module interface

`IngestService` is the public seam for the serialized contract: parsing, eligibility, normalization,
and redaction stay implementation detail while an independent oracle submits a wire payload and observes the index adapter.

```java
public record IngestPolicy(Set<String> allowedEnvironments,
                           List<String> redactionLiterals) {}

public interface IndexPort {
    void index(NormalizedLogRecord document);
    LogQueryResult search(LogQuery query);
}

public final class IngestService {
    public IngestService(IngestPolicy policy, IndexPort indexPort);
    public IngestResult ingest(String serializedJson);
}

public sealed interface IngestResult {
    record Accepted() implements IngestResult {}
    record Rejected(String code) implements IngestResult {}
}
```

`Accepted` means exactly one sanitized `NormalizedLogRecord` was submitted to `IndexPort`.
`Rejected(code)` means no `IndexPort.index` invocation occurred; its stable codes are
`INVALID_JSON`, `UNSUPPORTED_SCHEMA_VERSION`, `OUT_OF_SCOPE`, `INVALID_METADATA`, and
`INVALID_SOURCE`. `IngestPolicy` owns only the allowed environment names and literal secrets to
redact; v1 always requires `optIn: true`. Every occurrence of a configured literal in `message`
or an `attributes` value is replaced with the exact string `[REDACTED]`; non-matching text and
attribute keys are unchanged. The contract test supplies a capturing `IndexPort` and therefore
never needs to inspect private normalization code or an OpenSearch implementation.

The ingest service enforces this order for every accepted record:

1. Verify configured opt-in non-production scope.
2. Normalize required Kubernetes and timestamp fields; reject records that cannot satisfy the contract rather than inventing context.
3. Redact configured secrets from message and structured attributes.
4. Send only the sanitized normalized document to the index adapter.

### Index query module interface

`IndexPort.search(LogQuery)` is the only storage-query seam. It takes a typed, bounded query rather
than OpenSearch JSON, and returns only already-sanitized `NormalizedLogRecord` values. The real
OpenSearch adapter is constructed around the OpenSearch client and the one configured index name;
an oracle supplies the real client but never calls it directly.

```java
public record TimeWindow(Instant fromInclusive, Instant toExclusive) {}

public sealed interface LogQuery permits RunIdLogQuery, WorkloadWindowLogQuery {
    TimeWindow timeWindow();
    int maxRecords();
    Optional<String> messageContains();
}

public record RunIdLogQuery(String testRunId, TimeWindow timeWindow,
                            int maxRecords, Optional<String> messageContains)
        implements LogQuery {}

public record WorkloadWindowLogQuery(String namespace, String workload,
                                    TimeWindow timeWindow, int maxRecords,
                                    Optional<String> messageContains)
        implements LogQuery {}

public record LogQueryResult(List<NormalizedLogRecord> records, boolean truncated) {}

public final class OpenSearchLogIndex implements IndexPort {
    public OpenSearchLogIndex(OpenSearchClient client, String indexName);
    public void index(NormalizedLogRecord document);
    public LogQueryResult search(LogQuery query);
}
```

`fromInclusive` is inclusive and `toExclusive` is exclusive; `toExclusive` must be after
`fromInclusive`. Every query must name this interval, its interval must be no longer than 15
minutes, and `maxRecords` must be 1 through 200. A message term is optional; when present it is a
full-text conjunct, not a replacement for identity, correlation, or time predicates. There are no
cursor, page, offset, continuation, raw-query, or untyped filter members.

`RunIdLogQuery` requires a non-blank `testRunId` and returns only records with that exact value;
it never broadens to a fallback search. `WorkloadWindowLogQuery` requires non-blank `namespace`
and `workload` values and returns only records satisfying **all** of namespace, workload, and the
time interval. `records` contains no more than `maxRecords` matching normalized records;
`truncated` is true exactly when matching records remain outside that returned bounded result.
This gives `TP-INDEX-0005` a callable constructor and a public storage boundary for its
round-trip, exact-run, and fallback-conjunction conditions without inventing an OpenSearch request
format.

### Storage-test environment checkpoint

`TP-INDEX-0005` requires real OpenSearch. A disconnected Docker runtime or absent endpoint is an
environment checkpoint, never behavior (2026-08-26 probe: no Colima socket, no `OPENSEARCH` endpoint); its oracle uses an authorized ephemeral store, never an in-memory fake.

### OpenSearch retention lifecycle

Seven-day retention is enforced by the owner-approved ISM policy `log-debug-retention-v1`, not by
mapping metadata; its exact daily-index names, template, idempotent bootstrap, permissions, and
invariants are in [`opensearch-retention.md`](opensearch-retention.md). `feat-004` implements that
seam; `feat-005` proves it against real OpenSearch.

search_logs requires filters plus an explicit time interval. get_failure_context requires test.run_id when available; otherwise it requires namespace, workload, and an explicit interval. Both tools are read-only. X-006 fixes the server-enforced maximum interval/result/byte budgets, request deadline, truncation response, and no-pagination rule. The service admits a request with a valid Kubernetes ServiceAccount JWT to normal tool validation; it rejects a missing or invalid JWT before dispatch. Its initialized MCP surface offers only the tool capability and its tool list is exactly search_logs and get_failure_context—there are no prompt, resource, or extra tool capabilities. These constraints keep every MCP operation bounded without exposing database query syntax.

### MCP executable bootstrap

`McpServiceBootstrap` is the public lifecycle seam for the Streamable HTTP boundary and owns fixed
X-006 limits. `bindAddress` may use loopback port `0`; `endpoint()` returns the actual bound MCP URI,
so a contract test starts and closes a real server without reflection or a hard-coded port. It injects
a capturing `IndexPort` and deterministic JWT validator; HTTP responses and captured calls are observed.

```java
public record McpHttpServerConfig(InetSocketAddress bindAddress) {}
public sealed interface JwtValidation permits JwtValidation.Valid, JwtValidation.Invalid { record Valid() implements JwtValidation {} record Invalid() implements JwtValidation {} }
public interface ServiceAccountJwtValidator { JwtValidation validate(Optional<String> bearerToken); }
public interface RunningMcpServer extends AutoCloseable { URI endpoint(); }
public final class McpServiceBootstrap { public static RunningMcpServer start(McpHttpServerConfig config, IndexPort indexPort, ServiceAccountJwtValidator jwtValidator); }
```
The server extracts an optional bearer token before validation; `Invalid` includes a missing token. `close()` releases the socket. Production verifies ServiceAccount JWTs; the oracle injects deterministic outcomes.

## Invariants and test seams

| Id | Component | Invariant — must hold for every input | Observable seam |
|---|---|---|---|
| INV-SCOPE-1 | Eligibility policy | A serialized v1 record whose `optIn` is not `true`, or whose `environment` is not allowed by `IngestPolicy`, is never submitted to the index adapter. | `IngestService.ingest` returns `Rejected(OUT_OF_SCOPE)` and a capturing `IndexPort` has zero invocations. |
| INV-REDACT-1 | Ingest and redaction service | A configured secret literal is never present in any document submitted to the index adapter or returned by MCP, whether it occurs in `message` or an `attributes` value. | Captured `NormalizedLogRecord` and MCP response. |
| INV-META-1 | Ingest and redaction service / log index adapter | Every indexed and returned v1 record has non-blank `namespace`, `pod`, `container`, `workload`, `observedAt`, and a `stdout` or `stderr` source; a missing, blank, malformed, or unknown-source ingress value is rejected. | `IngestService.ingest` returns `Rejected(INVALID_METADATA)` or `Rejected(INVALID_SOURCE)` and the capturing `IndexPort` has zero index invocations; an `IndexPort.search` round trip returns the accepted document's named fields unchanged. |
| INV-SCHEMA-1 | Ingest and redaction service | A serialized `schemaVersion: 1` record that satisfies the v1 required-field and safety rules is accepted even when it contains unrecognized additive top-level fields; an input declaring any unsupported major version is rejected and never submitted to the index adapter. | Captured index-port invocation for an additive v1 payload with unchanged named fields; `Rejected(UNSUPPORTED_SCHEMA_VERSION)` and zero index-port invocations for an unsupported-major payload. |
| INV-CORR-1 | Correlation resolver / log index adapter | A request with test.run_id never falls back to another run; a request without it never searches outside supplied namespace, workload, and interval. | The typed `LogQuery` passed to `IndexPort.search` and its returned records: `RunIdLogQuery` matches only its exact run id, while `WorkloadWindowLogQuery` matches the conjunction of namespace, workload, and interval. |
| INV-AUTH-1 | MCP query server | A Streamable HTTP MCP request bearing a valid Kubernetes ServiceAccount JWT reaches normal tool validation; a request with a missing or invalid JWT is rejected as unauthorized before tool dispatch or an index query. | HTTP authorization result plus captured JWT-validator and index-adapter calls. |
| INV-TOOLS-1 | MCP query server | MCP initialization exposes only the tool capability, `tools/list` returns exactly `search_logs` and `get_failure_context`, and any other tool invocation is rejected before an index query. | Initialization and tool-list wire responses plus captured index-adapter calls. |
| INV-BOUND-1 | MCP query server | Every successful tool call stays within configured time, result-count, and response-byte bounds. | Validated query plan and response metadata. |
| INV-READ-1 | MCP query server | No MCP tool issues a Kubernetes command or an index write. | Adapter-call contract test. |
| INV-JOURNEY-1 | Kubernetes journey fixture | An opted-in test workload's unique emitted marker is retrievable through MCP with Kubernetes identity and test correlation. | Level-3 Kubernetes journey response. |

## Feature impact

The planner owns the exact feature cuts after human approval; this table is a design-to-plan map, not an edit to feature_list.json.

| Feature area | Impact | Must cover |
|---|---|---|
| Baseline and build | change | Java 21/Maven startup path and local contract-test harness. |
| Collector deployment | new | DaemonSet, opt-in filtering, metadata enrichment, and A-006 tripwire. |
| Ingest/redaction | new | Normalized record validation, redaction-before-indexing, index adapter. |
| OpenSearch mapping | new | Searchable timestamp, Kubernetes identity, message, and correlation fields. |
| MCP query service | new | Two read-only tools, correlation fallback, error/truncation behavior, no direct DB/Kubernetes access. |
| Kubernetes journey | new | Emit → collect → index → MCP diagnostic-context proof with bounded timeout and cleanup. |

## Structured critique of Option A

### Steelman gate

Option A fairly says: collect the standard log stream once per node, isolate product code from collection, and use an explicit ingest boundary to make redaction and query safety testable. That is the smallest path that satisfies automatic collection and end-to-end requirements without putting a runtime component in every workload. It agrees with confirmed non-production scope, redaction, retention, store, and runtime decisions. It also teaches an important boundary: collection permission and query permission are separate concerns, so the MCP server need not carry cluster authority.

### Key Assumptions Check

| Premise needed for Option A | Challenge | Result |
|---|---|---|
| Selected workloads emit diagnosable stdout/stderr. | A private file-only logger breaks this. | Survives only with sidecar fallback. |
| The cluster permits a scoped DaemonSet to read intended node logs. | This is deployment-specific and absent from the repo. | A-006 assumed; it is the tripwire. |
| Redaction rules can be configured before ingestion. | Missing patterns leak data. | Survives as an enforced test/design obligation, not a completeness claim. |
| Test correlation is propagated when available. | Some tests may omit it. | Survives because fallback is explicitly bounded (A-005). |
| The MCP caller can narrow a query. | Broad ambiguous requests would undermine bounded context. | Survives through required filters/interval and server caps. |

### Premortem

Assume the MVP failed months after shipment: node policy denied host access; a workload wrote a private file; redaction missed an attribute; a test omitted test.run_id and fallback was ambiguous; or a broad query exhausted the budget. Countermeasures are A-006 proof, sidecar exception, redaction tests, correlation transparency, and INV-BOUND-1.

### Devil's Advocacy for Option B

The strongest case for injection is not convenience: it is determinism. A sidecar/agent is attached to exactly the workload whose private stream it collects, needs no host-log visibility, and can make a private file a first-class source. If target clusters forbid node-log access or actual tests rely on file logs, it is safer even with higher deployment coupling.

## Approval boundary

This document records a recommendation and critique. It intentionally does **not** create loop/design-approval.json or mark any feature approved. Before planning begins, a human must approve the current design digest and explicitly accept residual A-006 risk or choose the sidecar path for affected environments.
