# Requirement — Kubernetes Log Debug Context

## User-provided goal

Build a component that automatically collects logs from Kubernetes pods, indexes them in a
database, and exposes an MCP interface so an AI agent can retrieve relevant context while
debugging failed tests.

The collector may be a Java agent or another Kubernetes-compatible mechanism. It should attach to
or otherwise cover selected pods automatically rather than requiring application code to send each
log record explicitly.

## Required outcomes

- Collect logs from selected Kubernetes workloads automatically.
- Preserve Kubernetes context needed for diagnosis, including pod, namespace, container, workload,
  timestamp, and correlation identifiers when available.
- Index the collected records in a searchable store.
- Expose read-only MCP tools for bounded log search and failure-context retrieval.
- Let an AI agent use those tools to diagnose a failing test without direct database or
  unrestricted Kubernetes access.
- Prove the full flow in Kubernetes: emitted test log → collected record → indexed record → MCP
  query result → diagnostic context.

## Open decisions

The collector topology, index store, initial workload scope, retention/redaction policy, and MVP
runtime stack require human confirmation. They are tracked in
`harness/docs/assumptions.md`; no implementation plan is approved until those decisions close.
