# Design — Cluster access policy (feat-010)

**Recommendation:** encode the X-007 security MODEL with the minimal nonprod set — the upstream
default collector ClusterRole, one shared `-service` ServiceAccount with no Kubernetes RBAC, offline
ServiceAccountIssuer OIDC JWT validation (no TokenReview), OpenSearch location as a config knob, and
one default-deny-ingress NetworkPolicy. This is a recommendation, not approval.

## Owner constraint framing this design

The project owner stated in this session: **"This is a tool for the nonprod environment, so we don't
need to worry too much about security."** Every gap below is resolved toward the SIMPLE, minimal,
nonprod-appropriate choice. The security MODEL (X-007: server-side credentials, no backend exposure
to callers) still holds — `harness/docs/cross-cutting.md:29` — but the concrete encoding is minimal,
not least-privilege-beyond.

## Scope and evidence

This design supplies the concrete cluster facts feat-010 needs to write `rbac.yaml`,
`networkpolicy.yaml`, and `ClusterAccessPolicyTest.java`. It does not change the X-007 model, the
collector topology (X-001), or the opt-in scope (X-003) — it names the verbs, resources, identities,
and edges those rows left unspecified.

| Claim | Evidence |
|---|---|
| The collector enriches only `k8s.namespace.name`, `k8s.pod.name`, `k8s.container.name`, `k8s.pod.labels`, then maps `k8s.workload.name`. | `charts/log-debug-context/templates/collector-daemonset.yaml:120-127,144` |
| Log CONTENT is read via hostPath `/var/log/pods`, never the `pods/log` subresource. | `collector-daemonset.yaml:88-92,110-117` |
| The upstream k8sattributes processor's documented ClusterRole is pods/namespaces/nodes (core) + replicasets/deployments/statefulsets/daemonsets (apps) + jobs (batch) + replicasets (extensions), all get/list/watch. | pinned v0.159.0 README, RBAC section (lines 529-560): https://github.com/open-telemetry/opentelemetry-collector-contrib/blob/v0.159.0/processor/k8sattributesprocessor/README.md |
| Namespaced Role is not viable: it needs `filter.namespace`, and it cannot query cluster-scoped `namespaces`/`nodes`. | same README, "Namespace-scoped RBAC" (lines 562-569) |
| The pinned processor's metadata list exposes `k8s.deployment.name`/`k8s.daemonset.name`/`k8s.statefulset.name`/`k8s.job.name`/`k8s.cronjob.name`/`k8s.replicaset.name` — **no `k8s.workload.name`**. | same README, "Available attributes" (lines 79-97); the attribute `k8s.workload.name` is absent from both that list and the attribute generator `metadata.yaml` |
| The one service is a single Java 21/Maven ingest **and** MCP service, not two deployments. | `harness/docs/architecture.md:16,39` |
| MCP's backend edge is `MCP → correlation resolver → index`, never ingest. | `harness/docs/design/log-debug-context.md:71` |
| MCP accepts valid Kubernetes ServiceAccount JWTs; production "verifies ServiceAccount JWTs". | `log-debug-context.md:243`; X-007 at `cross-cutting.md:29` |
| OpenSearch is an assumed target deployment with no endpoint in this repo. | A-007, `harness/docs/assumptions.md:30` |
| Collector reaches ingest at `-ingest:8080/ingest`; MCP callers reach MCP on 8080. | `collector-daemonset.yaml:67`; `tests/k8s/fixtures/mcp-client.yaml:22` |

## Resolutions of the six gaps

### 1. Collector log-read RBAC — ClusterRole, upstream default

The collector's k8sattributes processor needs read access to pod metadata (and, to resolve workload
ownership, the owner kinds). The minimal sufficient grant is the upstream documented ClusterRole:

```yaml
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRole
metadata:
  name: {{ .Release.Name }}-collector
rules:
- apiGroups: [""]
  resources: ["pods", "namespaces", "nodes"]
  verbs: ["get", "list", "watch"]
- apiGroups: ["apps"]
  resources: ["replicasets", "deployments", "statefulsets", "daemonsets"]
  verbs: ["get", "list", "watch"]
- apiGroups: ["batch"]
  resources: ["jobs"]
  verbs: ["get", "list", "watch"]
- apiGroups: ["extensions"]
  resources: ["replicasets"]
  verbs: ["get", "list", "watch"]
```

Bound with a ClusterRoleBinding to `{{ .Release.Name }}-collector`. **ClusterRole, not namespaced
Role**: the DaemonSet observes pods across every opted-in test namespace, no `filter.namespace` is
set, and `namespaces`/`nodes` are cluster-scoped objects a namespaced Role cannot query (README
"Namespace-scoped RBAC"). This is the "not least-privilege-beyond" choice: the stock rule set, not a
hand-trimmed one.

**Finding (recorded, not an RBAC blocker):** the chart transform maps
`resource.attributes["k8s.workload.name"]` (`collector-daemonset.yaml:144`), but the pinned v0.159.0
k8sattributes processor emits no `k8s.workload.name` — only the concrete per-owner attributes listed
above. So the `workload` v1 field would be blank at the journey unless the chart maps a concrete
owner attribute (e.g. `k8s.deployment.name` or `k8s.replicaset.name`) or the resolver is corrected.
The RBAC above already grants the owner kinds, so whichever concrete attribute is chosen is
readable. This is a cluster-fact correction for the planner to route (feat-008's chart / a follow-up),
not a feat-010 decision and not a `needs-human` assumption.

### 2. ServiceAccounts — one shared, no Kubernetes RBAC

- `{{ .Release.Name }}-collector` — exists (`collector-daemonset.yaml:31`). Grant: the ClusterRole above.
- `{{ .Release.Name }}-service` — new, the single ServiceAccount for the one ingest+MCP pod. Grant:
  **none**. It holds OpenSearch credentials (env, server-side per X-007) and validates JWTs offline;
  it issues no Kubernetes calls. One shared account is correct because ingest and MCP are the same
  pod.

### 3. MCP JWT mechanism — offline ServiceAccountIssuer OIDC discovery, no TokenReview

Keep feat-007's chosen validator: the service fetches the issuer's `/.well-known/openid-configuration`
and `/openid/v1/jwks` (in-cluster default `https://kubernetes.default.svc`), caches the JWKS, and
verifies `iss`/`aud`/`exp`/signature locally. No TokenReview, no `create tokenreviews` grant, no
Kubernetes credential — so the MCP/`-service` SA needs no RBAC. TokenReview is rejected because it
would give the service a server-side Kubernetes credential that X-007's "no backend exposure" model
avoids, and it is not simpler. Consequence: the service pod needs egress to the issuer discovery/JWKS
endpoint — unenforced in the minimal option (egress default-allows).

### 4. OpenSearch location — a config knob, not a hard-coded fact

A-007 records that the target OpenSearch deployment is assumed with no endpoint in this repo. Encode
it as Helm values: `opensearch.endpoint` (env) and `opensearch.inCluster` (bool, default `false`).
When `inCluster=true`, emit an egress NetworkPolicy rule to that namespace/pod/port; when external
(nonprod default), leave egress unenforced and document why (Kubernetes default-allows egress;
A-007 has no endpoint; nonprod). The falsifier "exposes OpenSearch" is satisfied structurally, not by
egress policy: the chart creates no Service/Ingress that routes callers to OpenSearch, and MCP never
proxies OpenSearch to callers (`architecture.md:41`).

### 5. NetworkPolicy — one default-deny-ingress policy, cluster-internal scope

Canonical labels and ports, decided now:

- Service pod (ingest+MCP): `app.kubernetes.io/name: log-debug-context`, `app.kubernetes.io/component: service`.
- Collector pods: `app.kubernetes.io/name: log-debug-context-collector`, `app.kubernetes.io/component: collector` (already evidenced).
- Ports: 8080 (ingest `/ingest` + MCP Streamable HTTP); collector health 13133.

"Cluster-internal" means **any-namespace-in-cluster**, not same-namespace-only: feat-011's
"namespace-isolated" describes the journey emitter's own namespace, not a restriction on where MCP
callers may live. Minimal encoding:

```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: {{ .Release.Name }}-service-ingress
spec:
  podSelector:
    matchLabels:
      app.kubernetes.io/name: log-debug-context
      app.kubernetes.io/component: service
  policyTypes: ["Ingress"]
  ingress:
    - from:
        - namespaceSelector: {}      # all cluster-internal pods (collector + MCP callers)
      ports: [{ protocol: TCP, port: 8080 }]
```

This default-denies non-pod (external) traffic and admits the two intended ingress edges
(collector→ingest and callers→MCP) in one rule; authentication still gates MCP at the application
layer (INV-AUTH-1). The collector→ingest one-way direction is already enforced at the config layer
by feat-008 (collector egress locked to ingest). Egress is left default-allowed (nonprod).

Consequence: the journey fixture's selector `app.kubernetes.io/component: mcp`
(`tests/k8s/fixtures/mcp-client.yaml:19`) predates the single-service decision; feat-011's maker
should select `app.kubernetes.io/component: service` (or the `-mcp` Service) instead.

### 6. Edge reconciliation — MCP's backend edge is OpenSearch, not ingest

One service (one pod) hosts both surfaces, reachable as `-ingest:8080/ingest` (collector) and
`-mcp:8080` (MCP callers). The edges to encode are exactly:

1. collector → service ingest path (`-ingest:8080`), one-way — the collector never calls MCP.
2. service → OpenSearch via `IndexPort` — shared by ingest writes and MCP reads (same pod).
3. callers → MCP (`-mcp:8080`), cluster-internal and authenticated.

There is **no MCP → ingest edge**. The feature brief's "MCP → ingest" is corrected to "MCP →
correlation resolver → index (OpenSearch)" (`log-debug-context.md:71`; `architecture.md:39`).

## Options and recommendation

| Axis | Minimal (recommended) | Strict |
|---|---|---|
| Collector RBAC | upstream default ClusterRole, one ClusterRoleBinding | hand-trimmed verbs; per-namespace RoleBindings |
| Service accounts | one shared `-service` SA, no K8s RBAC | separate ingest/MCP SAs, least-privilege |
| MCP JWT | offline OIDC discovery, no grant | TokenReview + `create tokenreviews` grant |
| OpenSearch | config knob; egress unenforced when external | CIDR/namespace-scoped egress rule always |
| NetworkPolicy | one default-deny-ingress policy, cluster-internal | per-edge egress/ingress, separate ports, caller labels |
| Edges | 3 edges, one pod, no MCP→ingest | (same edges; per-surface policy objects) |

**Recommend the Minimal option.** Phase 4 below left no surviving premise that requires the strict
machinery: X-007's two hard clauses — "cluster-internal" and "authenticated" — are satisfied by one
default-deny-ingress NetworkPolicy plus the existing INV-AUTH-1 JWT gate; the RBAC and OpenSearch
location are resolved by the upstream default and a config knob respectively, exactly the nonprod
stance the owner stated. The strongest argument against Minimal is that it does not restrict the
service's *egress* (to OpenSearch or the issuer), so a compromised service pod could reach arbitrary
cluster endpoints — the owner has explicitly accepted that class of risk for nonprod.

## Feature impact

| Feature area | Impact | Must cover |
|---|---|---|
| feat-010 Cluster access policy | new | `rbac.yaml` (collector ClusterRole+binding, `-service` SA with no RBAC), `networkpolicy.yaml` (one default-deny-ingress policy), `ClusterAccessPolicyTest` asserting no broad grants, no OpenSearch exposure, the intended edges |
| feat-008 Collector deployment | change | none required for RBAC; the `k8s.workload.name` mapping finding may need a follow-up chart edit (planner-routed) |
| feat-011 Kubernetes journey | change | mcp-client fixture selector from `component: mcp` to `component: service` |

## Structured critique of the Minimal option

### Steelman gate

Minimal fairly says: X-007 already pins the security *model* — server-side credentials, cluster
internal, JWT-authenticated MCP, no backend exposure. What the model left unspecified is only the
*encoding*, and for a nonprod tool the correct encoding is the stock, documented one — the upstream
collector ClusterRole, one service account, offline JWT validation that needs no Kubernetes
credential, and a single ingress policy. It agrees with the owner's nonprod framing and with every
already-owner-approved row (X-001, X-003, X-007). It also teaches something worth keeping: the
collector's Kubernetes read and the MCP caller's authentication are separate concerns, so neither
the collector nor the MCP service needs to hold a credential for the other's job.

### Key Assumptions Check

| Premise the recommendation needs | Challenge | Result |
|---|---|---|
| The collector watches pods across multiple test namespaces (no single namespace). | A single fixed namespace would allow a namespaced Role. | Survives — DaemonSet, no `filter.namespace` (`collector-daemonset.yaml`). |
| Offline OIDC discovery verifies the JWT without a Kubernetes API call. | If the cluster issues tokens the service cannot verify offline, auth fails. | Survives — Kubernetes publishes `/.well-known/openid-configuration` + `/openid/v1/jwks` unauthenticated. |
| Egress left default-allowed is acceptable for nonprod. | A compromised service pod could reach arbitrary endpoints. | Owner-accepted for nonprod (framing). |
| The one pod hosts both ingest and MCP. | If ingest and MCP were split, two SAs/edges would follow. | Survives — architecture says one service. |

### Premortem

Assume Minimal shipped and failed months later: the cluster is promoted to production and the
default-allowed egress is now an audit finding; a caller outside the cluster reaches MCP because the
NetworkPolicy was misapplied and JWT was bypassed in a misconfig; or the `workload` field is blank at
the journey because the transform maps an attribute the processor never emits. Countermeasures: the
OpenSearch/egress config knob is the promotion tripwire, INV-AUTH-1 enforces auth before dispatch
independently of the network layer, and the `k8s.workload.name` finding is on record now rather than
discovered at the journey.

### Devil's Advocacy for Strict

The strongest case for Strict is not paranoia, it is promotion-safety: a NetworkPolicy that names
each egress edge (service→OpenSearch, service→issuer JWKS, collector→ingest+DNS) and each ingress
edge with concrete selectors would move from nonprod to prod without rework, and TokenReview would
move JWT trust to the API server rather than a cached JWKS. That is a real, later value — but it
costs cluster facts this repo does not yet have (the OpenSearch location) and machinery the owner has
already said is unnecessary for this environment.

## Approval boundary

This document records a recommendation and critique. It does **not** create
`loop/design-approval.json` or mark feat-010 approved; only a human writes `status: approved`, bound
to the current design digest. The approval question the owner must answer is stated in the report
accompanying this document.
