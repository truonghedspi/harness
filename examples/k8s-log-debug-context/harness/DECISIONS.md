# Decisions Log — Kubernetes Log Debug Context

The *why* behind choices (Lesson 5). Rationale is the most expensive thing to rebuild across
sessions — record it here so a future session (human or agent) doesn't relitigate settled calls
or repeat a rejected approach.

One entry per decision. Newest first.

---

## 2026-08-28 — ISM bootstrap stays inside the OpenSearch build/prove pair

- **Decision:** Keep the 11-feature DAG: `feat-004` owns the official client dependency, adapter,
  public retention bootstrap, canonical ISM/template resources, and adapter tests; `feat-005`
  proves bootstrap idempotency, retention, mapping, and typed queries against real OpenSearch.
- **Reason:** The approved bootstrap and data plane share one client, one active daily index, and one
  real-store acceptance boundary; splitting lifecycle installation into another build would add a
  dispatch without an independently useful capability.
- **Rejected alternative:** Keep retention as mapping metadata, defer `pom.xml`, or add a separate
  retention feature. The first does not delete data, the second leaves the named Java seam
  uncompilable, and the third separates inseparable startup and adapter behavior.
- **Constraint it satisfies:** Every `feat-004` path needed to compile and install the approved
  resources has explicit ownership, while independent real-store judgement remains in `feat-005`
  and downstream dependency edges remain unchanged.
- **Affected:** `feat-004`, `feat-005`, `pom.xml`, OpenSearch bootstrap/resources/tests, and context
  packets; approved design digest `441eb6d76fd1752d`.

---

## 2026-08-28 — Ingestion build owns its Maven source root

- **Decision:** Add `pom.xml` to `feat-002` ownership and require it to map
  `service/src/main/java` as Maven's main source directory before implementing the approved ingest
  seam.
- **Reason:** Maven currently compiles only `service/src/test/java`; product classes written to the
  approved ingest path would otherwise remain invisible to both the unit proof and downstream builds.
- **Rejected alternative:** Re-cut build wiring as another feature or move sources into Maven's
  default root; either adds a dispatch for an inseparable build step or contradicts the approved
  repository layout.
- **Constraint it satisfies:** One feature owns every path needed to make its behavior executable,
  while preserving the compile-complete ingest seam, feature history, and 11-feature DAG.
- **Affected:** `feat-002`, `pom.xml`, `loop/context-packets/feat-002.json`.

---

## 2026-08-27 — Hermetic collector source is a post-enrichment JSONL event

- **Decision:** The project owner approved one UTF-8 JSON object per line with timestamp, stream,
  message, four Kubernetes identity fields, opt-in/environment labels, and optional test.run_id.
- **Reason:** It lets the real Collector Contrib filter, map and export source events without a
  cluster while keeping Kubernetes API enrichment in the Level-3 journey where it can be observed.
- **Rejected alternative:** Starting Kubernetes for this contract duplicates the journey and makes
  a mapping/wire oracle large and environment-dependent; inventing a test-only Java adapter would
  stop exercising the collector configuration.
- **Constraint it satisfies:** `TCON-COLLECTOR-0001` through `0004` now have a typed source whose
  fields can be varied independently and whose eligibility intersection is explicit.
- **Provenance:** project owner answered “duyệt JSONL fixture” in the project conversation on
  2026-08-27 after seeing the complete example and the Level-3 boundary.
- **Approval receipt:** bound to design digest `c206b89185ec03cd` in
  `loop/design-approval.json`; changing the fixture contract invalidates it.
- **Open follow-up:** none.
- **Affected:** `feat-008`, `feat-009`, `TP-COLLECTOR-0009`, `pod-logs.json`, and
  `collector/otel-collector.yaml`.

---

## 2026-08-27 — Docker/OCI selected for the collector contract

- **Decision:** The project owner selected Docker/OCI for the non-cluster
  `CollectorContractBootstrap`; do not introduce a local-binary fallback as an equivalent behavior
  result. The owner subsequently approved
  `otel/opentelemetry-collector-contrib:0.159.0@sha256:1f2c54a30e713fac6b3ae77a1ec84010c2007e29ced8ec666214fc2f6739c1cc`.
- **Reason:** This executes the real Collector Contrib distribution and the production collector
  configuration at the public lifecycle seam while keeping fixtures isolated from host logs.
- **Lifecycle policy included in the question:** mount `/fixtures` read-only, wait for the health
  endpoint within the configured readiness deadline, and force-stop after the shutdown deadline
  while reporting cleanup failure.
- **Rejected alternative:** A pinned local binary. The owner answered “dùng docker/oci” in the
  project conversation on 2026-08-27.
- **Constraint it satisfies:** An unavailable Docker runtime or pinned image remains an explicit
  environment checkpoint; it may not be replaced by a fake collector.
- **Provenance:** human decision, project conversation on 2026-08-27; scope `feat-009`, collector
  contract runtime and lifecycle.
- **Digest provenance:** official OpenTelemetry release `v0.159.0`; Docker Hub tag metadata read on
  2026-08-27 returned the approved multi-platform manifest-list digest. The owner answered “duyệt
  digest” after seeing the complete reference.
- **Approval receipt:** the owner-approved launcher revision is bound to design digest
  `9cdc628124487918` in `loop/design-approval.json`; changing any design file invalidates it.
- **Open follow-up:** none for the non-cluster collector launcher.
- **Affected:** `feat-009`, `collector/contract-image.lock`, `CollectorContractBootstrap`, and the
  collector contract oracle.

---

## 2026-08-27 — Compile-complete public seam stays one foundation feature

- **Decision:** Keep the 11-feature DAG and make feat-002 own every Java source file required by
  the approved `IngestService`/`IndexPort` seam, including the bounded typed query family.
- **Reason:** `IndexPort` has both index and search methods in the approved API. Java requires its
  public parameter/result types to exist when it compiles; later adapter and MCP features consume
  this seam but do not need to redefine it.
- **Rejected alternative:** Introduce an indexing-only temporary port, hide public types as nested
  implementation details, or make feat-002 depend on a later consumer; these respectively create
  API churn, contradict the approved design, or introduce a dependency cycle.
- **Sizing:** feat-002 names the bounded ingest-package glob plus its unit test (two owned paths).
  The glob covers ten mutually dependent public source files without granting the OpenSearch or MCP
  packages; adapter search behavior remains feat-004 and MCP behavior remains feat-006.
- **Affected:** `feat-002` ownership and context packet; dependency edges and all other feature
  state/evidence remain unchanged.

---

## 2026-08-27 — Executable MCP bootstrap resolves feat-007 without re-cutting

- **Decision:** Keep feat-006 as the bounded MCP build and feat-007 as its independent HTTP proof;
  clear feat-007's design marker against owner-approved digest `4ff1c56ce4b88469`.
- **Reason:** `McpServiceBootstrap.start` now injects the capturing index port and deterministic JWT
  validator, binds an ephemeral loopback endpoint, and returns a closeable running server, making
  all ten TP-MCP-0007 conditions executable through the public wire boundary.
- **Rejected alternative:** Add a bootstrap feature, use reflection, or require an externally
  prestarted server; bootstrap is the callable seam for the existing build/prove pair, while the
  alternatives either add no independent capability or make the named Maven proof non-hermetic.
- **Constraint it satisfies:** The independent oracle can observe real HTTP responses and privileged
  adapter calls without reading implementation internals or inventing lifecycle behavior.
- **Affected:** `feat-007`, `TP-MCP-0007`, test-implementer routing; approved design digest
  `4ff1c56ce4b88469`.

---

## 2026-08-26 — Typed query port resolves feat-005 without re-cutting

- **Decision:** Keep feat-004 as the OpenSearch adapter build and feat-005 as its independent
  real-store proof; clear feat-005's design marker against approved digest `64a7b9ee26db6b10`.
- **Reason:** `IndexPort.search(LogQuery)`, the two typed queries, `LogQueryResult`, and
  `OpenSearchLogIndex(OpenSearchClient, String)` now make all three TP-INDEX-0005 conditions
  callable without exposing OpenSearch query syntax.
- **Rejected alternative:** Split exact-run and fallback searches into separate prove features;
  they use one adapter boundary, one real-store fixture, and one verification command.
- **Constraint it satisfies:** The oracle uses a real OpenSearch boundary and invariant-derived
  falsifiers while an unavailable runtime remains an environment checkpoint rather than fake
  behavioral evidence.
- **Affected:** `feat-005`, `TP-INDEX-0005`, test-implementer routing; approved design digest
  `64a7b9ee26db6b10`.

---

## 2026-08-26 — Explicit ingress seam fits the existing build/prove pair

- **Decision:** Keep the 11-feature DAG; make feat-002 own the approved
  `IngestService.ingest(String)`/`IndexPort` implementation seam and feat-003 prove that seam with
  serialized v1 JSON and captured adapter calls. Collector proofs emit one JSON object per request.
- **Reason:** The revision removes implementation ambiguity but does not introduce a new component
  or acceptance journey; feat-002 and feat-003 already share the exact ingest boundary.
- **Rejected alternative:** Add a separate schema/parser feature or keep calling the payload a
  batch; the former duplicates one inseparable seam and the latter contradicts the v1 wire contract.
- **Constraint it satisfies:** One build claim is independently judged by one boundary proof, with
  falsifiers derived from INV-SCOPE-1, INV-REDACT-1, INV-META-1, and INV-SCHEMA-1.
- **Affected:** `feat-002`, `feat-003`, `feat-008`, `feat-009`; approved design digest
  `bd6662458f053012`.

---

## 2026-08-26 — MCP JWT and closed-surface invariants answer feat-007

- **Decision:** Record `INV-AUTH-1` for valid/missing/invalid Kubernetes ServiceAccount JWT
  outcomes and `INV-TOOLS-1` for the exact `search_logs`/`get_failure_context` surface; this
  formalizes existing X-007 and feat-007 scope without adding a capability.
- **Reason:** The Streamable HTTP proof needs observable authorization and capability seams;
  `INV-BOUND-1` and `INV-READ-1` respectively cover budgets and side effects, not either gap.
- **Rejected alternative:** Treat a JWT rejection as a generic validation failure or treat
  read-only behavior as proof that no extra read tool exists; both permit the stated wrong wire
  implementations to pass.
- **Constraint it satisfies:** Every prove-feature condition cites the invariant it actually
  derives from, rather than a superficially related policy row.
- **Affected:** `feat-007`, `TP-MCP-0007`, MCP query server, and cluster access policy.

---

## 2026-08-26 — Schema invariant resolves feat-003 without re-cutting

- **Decision:** Keep the 11-feature DAG and trace feat-003's additive-v1 and unsupported-major
  falsifier directly to approved `INV-SCHEMA-1`; clear its `NEEDS DESIGN` marker.
- **Reason:** `INV-SCHEMA-1` makes both schema outcomes observable at the ingest-to-index seam, so
  the existing black-box contract remains one coherent prove feature.
- **Rejected alternative:** Splitting schema compatibility into another feature would create a
  second paid dispatch over the same ingress adapter, captured index port, and verification suite.
- **Constraint it satisfies:** A routing marker is cleared only after its answer is approved and
  recorded, while every falsifier remains traceable to a design invariant.
- **Affected:** `feat-003`, test-designer routing; approved design digest `e54ec9db4f8258a1`.

---

## 2026-08-26 — Vertical slices with independent boundary proofs

- **Decision:** Cut five build claims after the Java baseline—ingest, OpenSearch, MCP, collector,
  and cluster access—and pair them with four boundary proofs plus one full Kubernetes journey.
- **Reason:** Component tests cannot prove serialized collector/ingest, real-store, MCP wire, or
  cluster lifecycle behavior; the approved invariants name observable seams for each.
- **Rejected alternative:** One feature per design-table row would split inseparable ingest policy
  and correlation logic into dispatches with no independent user-observable proof.
- **Constraint it satisfies:** Every build is judged by a prove feature at the highest boundary it
  touches while preserving WIP=1 and a dependency-ordered cut.
- **Affected:** `feature_list.json`, test-designer handoffs, maker/checker routing.

---

## 2026-08-26 — Node-level log-context MVP

- **Decision:** Owner confirmed node-level collection for selected test workloads, OpenSearch,
  seven-day redacted non-production scope, Java 21/Maven custom services, and preferred
  `test.run_id` correlation.
- **Reason:** These are the five requirement decisions recorded in `docs/assumptions.md`.
- **Rejected alternative:** Per-pod injection is not the MVP default; retain it for a confirmed
  node-inaccessible or private-file source.
- **Constraint it satisfies:** Automatic selected-workload collection and bounded read-only MCP
  diagnostics (`../requirement.md:15-23`).
- **Affected:** collector, ingest/redaction, OpenSearch mapping, MCP query service, Kubernetes journey.

---

<!-- Template for new entries:

## YYYY-MM-DD — Title

- **Decision:**
- **Reason:**
- **Rejected alternative:**
- **Constraint it satisfies:**
- **Affected:**
-->
