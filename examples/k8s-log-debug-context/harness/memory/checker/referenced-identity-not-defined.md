---
name: referenced-identity-not-defined
description: A green RBAC/policy test can assert a binding names the right ServiceAccount while that ServiceAccount is never DEFINED anywhere — a dangling identity the test never checks.
metadata:
  type: lesson
  date: 2026-08-29
---

feat-010's `ClusterAccessPolicyTest` reproduces green (4/4) and its `serviceServiceAccountHasNoKubernetesRbac` method asserts the ClusterRoleBinding's subject names `-collector` (`collectorBound = true`, line 149). But no chart template ever defines the `-collector` ServiceAccount: `collector-daemonset.yaml:31` sets `serviceAccountName: {{ .Release.Name }}-collector` (a reference) and `rbac.yaml`'s binding names it, yet the only `kind: ServiceAccount` in the chart is the `-service` one. The design doc (`cluster-access-policy.md:80`) compounded it by asserting `-collector` "exists (collector-daemonset.yaml:31)" — citing the reference as if it were a definition.

**Why "it passed green" hides it:** the test checks the *name is wired* (binding subject == `-collector`), never that the *identity is materialized* (`kind: ServiceAccount` with that name). Kubernetes accepts a ClusterRoleBinding whose subject SA does not exist, so the binding is not rejected — but a pod with `serviceAccountName` pointing at the missing SA fails admission, so the collector DaemonSet cannot run and the RBAC grant is dead on arrival.

**How to apply:** when a policy/RBAC test asserts a binding or a pod `serviceAccountName`, also assert the referenced identity is DEFINED (a `ServiceAccount` doc with the same rendered name), not merely referenced. The decisive probe is to delete (or never add) the `kind: ServiceAccount` definition and re-run: if the suite stays green, it only checks the reference, not existence. This generalizes to any chart template reference (ConfigMap, Secret, Service) that a policy test pins by name.
