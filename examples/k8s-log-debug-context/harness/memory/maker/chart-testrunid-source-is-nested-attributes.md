---
name: chart-testrunid-source-is-nested-attributes
description: the chart's test.run_id must map from attributes["attributes"]["test.run_id"], not attributes["test.run_id"] — the journey log-emitter nests it under "attributes", same as the hermetic fixture
metadata:
  type: lesson
  date: 2026-08-29
---

feat-013 fixed the chart ConfigMap's transform. The note said only "map message into the OTLP body (not read test.run_id from body)", which names the wrong source but not the right one.

**The non-obvious part:** the correct chart source is `attributes["attributes"]["test.run_id"]`, NOT `attributes["test.run_id"]`. Two facts force this:

- The chart's `filelog` runs `regex_parser` (file-path identity) then `json_parser`; `json_parser` moves the parsed log-line keys into `attributes`, so the raw line `{"message":"...","attributes":{"test.run_id":"..."}}` yields `attributes["attributes"]["test.run_id"]`.
- The journey emitter (`tests/k8s/fixtures/log-emitter.yaml`) writes exactly that nesting, so it mirrors the hermetic fixture `collector/otel-collector.yaml:41` (`attributes["attributes"]["test.run_id"]`).

**How to apply:** when a chart-transform note says "read X from the parsed attributes, not body", first read `tests/k8s/fixtures/log-emitter.yaml` and `collector/otel-collector.yaml` to see the actual nesting; the chart and hermetic paths differ only in the attribute namespace (`resource.attributes["k8s..."]` vs `attributes["kubernetes"]["..."]`), and the nested `attributes.*` wrapper is identical across both.
