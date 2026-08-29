---
name: collector-contract-deferred-seams
description: feat-008 ships the collector config on otlphttp and the debug.logs/enabled filter; two wire/label seams are deferred to feat-009 and feat-011, not bugs to fix in feat-008
metadata:
  type: lesson
  date: 2026-08-29
---

The stock OpenTelemetry Collector Contrib (0.159.0) has no exporter that sends one raw JSON object
per HTTP request: `otlphttp` always wraps records in the `resourceLogs` envelope. The owner-approved
wire contract (`collector/contract-launch.md`) forbids that envelope, so `collector/otel-collector.yaml`
uses `otlphttp` plus a `transform` that stamps `schemaVersion`/identity, and feat-009's
`CollectorIngestContractIT` (`assertFalse(json.contains("resourceLogs"))`) will fail until the
OTLP-vs-raw-JSON seam is resolved (a custom exporter, or an ingest-side OTLP decode).

**Why this is a trap:** it looks like the collector should emit arbitrary JSON over HTTP, so a maker
could spend a session trying to configure `otlphttp` into a raw mode that does not exist.

**How to apply:** feat-008's job was the deployment policy (preflight, opt-in, enrichment, ingest-only,
immutable image), not the wire envelope. Leave the envelope reconciliation to feat-009. A second seam:
the digest-bound opt-in label is `debug.logs/enabled` (`collector-contract-launch.md`), while
`tests/k8s/fixtures/log-emitter.yaml` opts in via `log-context.harness.dev/enabled` — feat-011 must
reconcile that key before the journey runs.
