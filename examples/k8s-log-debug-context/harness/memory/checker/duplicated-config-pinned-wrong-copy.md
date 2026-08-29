---
name: duplicated-config-pinned-wrong-copy
description: A static policy test that passes can still pin the wrong copy of a duplicated config — the hermetic file, not the artifact the deployment actually runs.
metadata:
  type: lesson
  date: 2026-08-29
---

A deployment policy test (feat-008) asserted the opt-in filter, enrichment, schemaVersion, and single-exporter egress — and reproduced green (6/6) — but every one of those assertions read `collector/otel-collector.yaml` (the hermetic contract config). The Helm chart's DaemonSet template (`charts/log-debug-context/templates/collector-daemonset.yaml`) embeds a *second, hand-maintained* ConfigMap that is what actually runs in the cluster, and the test only checked *that* file for preflight, host-access, sidecar fallback, and the pinned image — never for its opt-in/enrichment/schemaVersion/egress.

**Why "it passed green" hides it:** the falsifier named "reads non-opted-in workloads", and the test *looked* like it verified opt-in (it asserts the `debug.logs/enabled` + `"true"` markers). The defect is that it verified the marker on the wrong file. Two copies of a config that are supposed to stay in sync (same filter, different attribute namespace: `kubernetes.*` vs `k8s.*`) can drift silently because nothing enforces the sync.

**How to apply:** when a feature's artifacts include a config that is duplicated (a hermetic/contract copy and a live deployment copy), confirm which copy the test reads for each falsifier clause — don't let a green `contains(marker)` on one copy stand in for the other. The decisive check is a mutation probe: delete the marker from the *live* artifact and re-run; if the suite stays green, the verification pins the wrong copy. Two durable fixes: assert the markers against the live artifact too, or generate the live artifact from the single pinned source so there is no second copy to drift.
