---
name: k8sattributes-emits-no-workload-name
description: The pinned k8sattributes processor emits concrete per-owner names (deployment/statefulset/daemonset/job/replicaset), never the generic k8s.workload.name — the chart's transform maps a field the processor never produces.
metadata:
  type: fact
  date: 2026-08-29
---

The chart's collector ConfigMap maps `resource.attributes["k8s.workload.name"]` into the v1
`workload` field (`charts/log-debug-context/templates/collector-daemonset.yaml:144`), but the pinned
`otel/opentelemetry-collector-contrib:0.159.0` k8sattributes processor never emits
`k8s.workload.name`. Its available-attributes list has only the concrete per-owner names —
`k8s.deployment.name`, `k8s.daemonset.name`, `k8s.statefulset.name`, `k8s.job.name`,
`k8s.cronjob.name`, `k8s.replicaset.name` — and the attribute generator `metadata.yaml` has no
`workload` entry. Verified by fetching the pinned release's README ("Available attributes",
lines 79-97) and `metadata.yaml`; Docker need not run.

**Why it matters:** at the Level-3 journey the `workload` field would be blank, which INV-META-1
requires non-blank — so the enrichment/`workload` path silently fails only in the cluster, after
the hermetic fixture (which supplies `kubernetes.workload` from JSON) has already gone green.

**How to apply:** before treating any `k8s.workload.*` attribute as present, check the pinned
processor release's `metadata.yaml`, not the semantic-conventions spec — the processor implements a
subset of the semconv. The chart should map a concrete owner attribute (e.g. `k8s.deployment.name`
or `k8s.replicaset.name`) rather than the generic `k8s.workload.name`.
