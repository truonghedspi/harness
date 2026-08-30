# Assumption registry — Kubernetes Log Debug Context

Every **load-bearing** assumption a design rests on. This file exists because an unexamined
assumption is the most expensive defect in the loop: it makes a wrong design look right, and the
checker cannot catch it (the checker verifies implementation against the spec, never the spec
against reality). Contract: `harness/docs/reference/design-engineering.md`.

**Status values**
- `verified` — with *how*: a `path:line` citation, a spike that ran, or a dated human statement.
  The design-facilitator's own confidence is never verification.
- `assumed` — plausible but unverified. The **If false** column is mandatory: without a stated
  blast radius nobody can judge the risk.
- `needs-human` — cannot be known from the repo (deployment fact, business intent, risk appetite).
  **This is the only status that stops the loop.**

Every `needs-human` row **must** carry a **Recommended answer** with its reasoning. Asking bare
("what should the retry policy be?") hands the work back and costs minutes of a person's thinking;
asking with a recommendation ("exponential capped at 30s, because X — agree?") costs seconds and
turns the job from *generating* an answer into *evaluating* one. It also exposes the answer the
agent would otherwise have assumed silently.

| id | Assumption | Status | If false | Recommended answer | Depended on by |
|---|---|---|---|---|---|
| A-001 | The MVP may collect container stdout/stderr at node level rather than inject one collector into every pod | verified — project owner confirmed all five recommendations on 2026-08-26 | The design must add sidecar injection or an application-level Java agent and accept higher per-pod overhead | Use an OpenTelemetry Collector or Fluent Bit DaemonSet; reserve sidecars for logs unavailable from the node | collector design |
| A-002 | A dedicated log-search store is acceptable for the MVP | verified — project owner confirmed all five recommendations on 2026-08-26 | The index adapter, query semantics, deployment footprint, and tests all change | Use OpenSearch for the first vertical slice because time-range, metadata, and full-text queries are native | storage design |
| A-003 | The first release targets non-production test namespaces with bounded retention and secret redaction | verified — project owner confirmed all five recommendations on 2026-08-26 | Production RBAC, tenancy, audit, capacity, deletion, and compliance become release-blocking work | Limit the MVP to labeled test namespaces, redact configured keys before indexing, and retain logs for 7 days | security and operations |
| A-004 | Custom services may use Java 21 while the collector itself is an off-the-shelf Kubernetes component | verified — project owner confirmed all five recommendations on 2026-08-26 | Build tooling, libraries, image layout, and agent runtime all change | Use Java 21 with Maven for the indexer/MCP service; do not build a custom Java log shipper unless a spike proves it necessary | implementation stack |
| A-005 | The test system can provide a run identifier that is propagated to workload metadata or structured logs | verified — project owner confirmed all five recommendations on 2026-08-26 | MCP must infer context from namespace, workload, and time windows, which is less precise and harder to test | Require `test.run_id` when available and support namespace plus time-window fallback | query and correlation design |
| A-006 | The target Kubernetes test environment permits the scoped node-level collector to read selected container stdout/stderr logs | verified — false on the authorized local `minikube` context, 2026-08-29: after replacing BusyBox's unsupported `find -readable`, the non-root preflight could open no `*.log` beneath the read-only `/var/log/pods` mount while the journey emitter was Running; dedicated init log recorded `PREFLIGHT_FAILED` | The Kubernetes journey cannot prove the DaemonSet path in this environment; affected workloads need the sidecar path or a cluster-policy change | Use the already-approved sidecar fallback only after the A-009 workload-default checkpoint is answered | collector deployment, Kubernetes journey |
| A-007 | The target OpenSearch deployment exposes ISM and grants the index service the X-009 scoped policy/template/index permissions | assumed — the owner selected ISM on 2026-08-28, but this repository has no target endpoint or role probe | Bootstrap fails before any index write; real-store proof and retention cannot proceed | Run bootstrap against the authorized ephemeral/target store and observe policy, template, and managed daily index | feat-004, feat-005, operations |
| A-008 | The transform's OTLP mapping carries every v1 field byte-exact (no rename, loss, or coercion by `filelog`/`transform`/`otlphttp`) | assumed — feat-008's test was a static policy check and never executed the collector transform, so the runtime mapping is unverified until feat-009 runs | `INV-OTLP-2` round-trip fails and the decode adapter reconstructs a wrong v1 object, which would force a different mapping/encoding and reopen the mechanism question | Verify by running the real collector against the JSONL fixture in feat-009's oracle; no human decision needed — the round-trip oracle is the tripwire | feat-009, collector-ingress-mechanism |
| A-009 | The feat-011 workload may switch from the node-level collector to the per-workload sidecar fallback on local minikube now that A-006 is false there | verified — project owner approved option 1 on 2026-08-29: sidecar only for the opted-in disposable journey workload on local minikube; preserve the DaemonSet default elsewhere | Without approval feat-011 remains in-progress; with approval the chart/journey must add a narrowly scoped sidecar without weakening the DaemonSet default elsewhere | Approve a sidecar only for the opted-in disposable journey workload on local minikube; preserve the DaemonSet as the default for environments where A-006 holds | feat-011 |

Schema compatibility is an owner-confirmed cross-cutting policy, not a deployment assumption: see
X-008 in `docs/cross-cutting.md` and its observable contract `INV-SCHEMA-1` in
`docs/design/log-debug-context.md`.
