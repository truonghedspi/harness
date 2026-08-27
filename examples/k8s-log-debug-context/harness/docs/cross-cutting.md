# Cross-cutting decision register — Kubernetes Log Debug Context

Cross-cutting concerns fail differently from assumptions, so they get their own register
(`harness/docs/reference/design-engineering.md`):

- **Assumption** (`harness/docs/assumptions.md`) = "I believe X but haven't checked" → if wrong, a
  conclusion **flips**. Cured by verifying it.
- **Cross-cutting decision** (this file) = "someone must choose a policy" → if unowned, it gets
  decided **by accident** by whichever feature touches it first, and every later feature inherits
  it. Cured by an owner plus a rule that enforces the choice mechanically.

A row counts as **closed** only when all three of these are filled: the chosen mechanism, who chose
it and when, and the rule or gate that stops a future feature from silently doing something else.
A stub row ("not yet decided") is tracked, not closed — `harness/tools/cross-cutting-audit.mjs` reports it
as `open-decision`, which is a better state than unnoticed but is still open.

Find candidates with `node harness/tools/cross-cutting-audit.mjs --target .`. That audit reads breadth
(AI-strong: it never tires of reading every file); **choosing the policy is a human trade-off**
(AI-weak) — the agent surfaces and enumerates, you decide.

| id | Concern | Chosen mechanism | Owner / date | Enforced by | Inherited by |
|---|---|---|---|---|---|
| X-001 | Collector topology | Node-level OpenTelemetry Collector or Fluent Bit DaemonSet; sidecars only for logs unavailable from the node | project owner / 2026-08-26 | deployment policy test and Helm assertions | collector, Kubernetes test environment |
| X-002 | Log storage | OpenSearch with time, Kubernetes metadata, and full-text fields | project owner / 2026-08-26 | index mapping contract test | indexer, MCP query service |
| X-003 | Data boundary and retention | Opt-in non-production namespaces, configured redaction before indexing, seven-day retention | project owner / 2026-08-26 | admission/config validation plus redaction and retention tests | collector, indexer, operations |
| X-004 | Custom runtime | Java 21 and Maven for custom index/MCP services; no custom Java shipper without a recorded spike | project owner / 2026-08-26 | Maven toolchain gate and architecture dependency test | all custom services |
| X-005 | Failure correlation | Prefer `test.run_id`; bounded namespace/workload/time-window fallback | project owner / 2026-08-26 | query contract and end-to-end correlation scenarios | log schema, indexer, MCP tools, test runner |
| X-006 | MCP query budget and deadline | Maximum 15-minute interval, 200 records, 256 KiB response, five-second deadline, and no pagination | project owner / 2026-08-26 | MCP query contract and bounded journey test | MCP server, correlation resolver, journey |
| X-007 | MCP caller authentication | Cluster-internal Streamable HTTP authenticated with Kubernetes ServiceAccount JWT and restricted by NetworkPolicy | project owner / 2026-08-26 | deployment policy test and adapter-call contract test | MCP server, deployment |
| X-008 | Log-record schema compatibility | Required `schemaVersion: 1`; permit backward-compatible additive fields and reject unsupported major versions | project owner / 2026-08-26 | schema contract test | collector, ingest, index adapter, MCP server |

<!-- Example of a closed row (delete once the table has real content):
| X-001 | Message identity & de-duplication | (logPosition, indexWithinEntry) | Alice, 2026-08-09 | harness/docs/constraints.md MUST rule + wire-format test | feat-a, feat-b |
-->
