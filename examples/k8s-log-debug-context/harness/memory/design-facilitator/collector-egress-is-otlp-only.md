---
name: collector-egress-is-otlp-only
description: The v1 "one JSON object per request" contract and the unmodified-stock-image decision are mutually unsatisfiable at the collector egress — a stock collector's only HTTP log egress is OTLP.
metadata:
  type: fact
  date: 2026-08-29
---

The approved `Serialized ingress v1` contract says "the collector sends one UTF-8 JSON object per
ingress request" (no `resourceLogs`), but the owner's separate 2026-08-27 decision pins the
UNMODIFIED stock `otel/opentelemetry-collector-contrib:0.159.0`. Those two are in tension by
construction: a stock collector's only HTTP log exporter is `otlphttp` (OTLP envelope), and no
stock exporter emits one raw JSON object per HTTP request. So the contract is satisfiable only by
relocating the v1 boundary to an ingest-side OTLP-decode adapter, or by replacing the image with a
custom exporter — a digest-bound owner decision, not a config fix.

Reusable technique: a negative capability claim ("the stock image has no raw-JSON HTTP exporter")
is provable by citation to the pinned release's `opentelemetry-collector-releases@v0.159.0/
distributions/otelcol-contrib/manifest.yaml` (the `exporters:` list) plus the per-exporter
`config.go`/README (e.g. `otlphttpexporter` has no `encoding_extension` field; `jsonlogencoding`
is consumed only by `file`/`kafka`/`pulsar`/`rabbitmq`). Docker need not be running. This beats
re-deriving the exporter set from memory.
