---
name: attribute-mapped-from-unemitted-field
description: A green config test can pass while mapping a v1 field from a Kubernetes attribute the pinned upstream processor never emits, so the field resolves blank at runtime.
metadata:
  type: lesson
  date: 2026-08-29
---

feat-013's chart transform mapped the v1 `workload` field from `resource.attributes["k8s.workload.name"]` (collector-daemonset.yaml:144). The pinned k8sattributes processor (contrib v0.159.0, contract-image.lock) emits no `k8s.workload.name` — only `k8s.deployment.name` / `k8s.replicaset.name` / `k8s.daemonset.name` / `k8s.statefulset.name` / `k8s.job.name` / `k8s.cronjob.name` (harness/docs/design/cluster-access-policy.md:69-76). A static test asserting `contains("workload")` or even `contains("k8s.workload.name")` passes on the wrong mapping because the string is present; only a test that *negates* the non-emitted field and *pins* a concrete owner catches it.

**Why "it passed green" hides it:** presence checks confirm the mapping statement exists, not that its right-hand side names an attribute the runtime actually produces. The failure mode is silent and only surfaces at the journey — the field is blank, not missing from config.

**How to apply:** when a config/transform maps a v1 field from an upstream-enriched attribute, confirm against the *pinned component's emitted attribute set*, not the intent. The decisive assertion is the negation plus a positive pin of a field the processor really emits (e.g. `assertFalse(contains("k8s.workload.name"))` AND `assertTrue(contains("k8s.deployment.name") || …)`), exactly like "referenced identity not defined" but for runtime attributes rather than Kubernetes resources.
