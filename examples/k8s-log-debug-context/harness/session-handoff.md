# Session Handoff — Kubernetes Log Debug Context

feat-011 is checker-approved; all 13 feature claims are done and the router exits.

## Current Objective

- The project feature set is complete: feat-011 is checker-approved and all 13 features are done.
- Keep HI-084 as separate harness work; it is not a reopened project feature.

## Last Iteration

- Restarted the authorized local minikube. The exact recorded stale namespace
  `log-debug-journey-5b9bd44-1788013337-97076`, Helm release, collector ClusterRole/Binding, and all
  harness-labelled namespaces were already absent; no exceptional cleanup mutation was attempted.
- The first uninterrupted run exited 42 after 120s because the oracle conflated authenticated MCP
  rejection with collector convergence. A valid-audience tools/list discriminator then proved the
  correct token was HTTP 401. Safe validation diagnostics and bounded API probes established local
  minikube returns 403 for anonymous JWKS, while its built-in issuer-discovery binding authorizes
  ServiceAccounts.
- The service now refreshes JWKS with its existing rotated projected token, validates request JWTs
  locally, and adds no project RBAC or TokenReview grant. The exact feature command exited 0 in
  `log-debug-journey-5b9bd44-1788059125-44732`: auth 401/401/200, exact correlation, redaction clean,
  <=200 records, <=256 KiB, <=15m interval, no pagination, and a 1s live query.
- Telemetry recorded deployment/readiness 25864ms, scenario 5106ms, event wait 3000ms, one retry,
  total 32077ms, diagnostics captured, exit 0, and redacted payloads. Independent post-run reads
  found no namespace, release, collector ClusterRole/Binding, or harness-labelled namespace.
- `readyForCheck` is true; status remains `in-progress`. The k8s integration tester did not mark done.

- Final acceptance approved feat-011. The checker replayed `./harness/init.sh` (green), the
  redaction mutant (red), and `McpHttpContractIT` (green deadline discriminator), then promoted
  the feature to `done`. The router now exits with 13/13 features done.

- Recorded HI-084: the runner had no bounded exact path for a labelled live namespace whose Helm
  release was stuck `uninstalling`. Added a WIP `cleanup-stuck-release` mode to the canonical and
  target tools; it pins context/namespace/release, requires `harness-loop-test=true` and Active /
  uninstalling state, then runs bounded uninstall/delete and verifies absence. It cleaned
  `log-debug-journey-5b9bd44-1788011923-86711` in 11.3s. HI-084 remains open because demo/docs/
  upgrade-context verification is unfinished.
- The repaired POST probe reached healthy. The next two retries exposed and fixed oracle defects:
  Deployment-owned emitter pods require waiting on `deployment/journey-log-emitter`, and expected
  `kubectl auth can-i` denials print `no` while exiting nonzero under `pipefail`.
- The prior session's latest run reached deploy, POST health, Deployment/client readiness, and both
  RBAC denials before external interruption. At that checkpoint no business invariant was green and
  the namespace/release was recorded stale; this session's absence checks and green journey above
  supersede that state.

- Built the Java 21 shaded JAR and Docker image `log-debug-context:feat-011`, loaded it into the
  authorized local minikube, and ran the namespace-isolated wrapper with 300/120/240-second bounds.
- OpenSearch, the ingest/MCP service, the 2/2 sidecar-backed emitter, and MCP client reached Ready.
  The registry health command sent `GET /mcp` and expected 401; the POST-only server returned 405,
  so the business test never started. No auth/correlation/redaction/budget/deadline pass is claimed.
- Report `harness/trace/k8s-test/log-debug-journey-5b9bd44-1788011923-86711` records exit 1,
  303896ms deployment duration, diagnostics captured, and no scenario duration.
- Repaired the registry health request to an unauthenticated JSON-RPC POST. Reworked the journey's
  managed mode to use the runner namespace/Helm release instead of creating a nested environment;
  it now checks missing and wrong-audience JWT rejection without owning deployment cleanup.
- That interrupted cleanup removed workloads, ClusterRole, and ClusterRoleBinding but originally
  left its namespace/release uninstalling; the later bounded cleanup evidence above supersedes it.
- Local minikube was stopped after the bounded attempt so it does not contend with non-Kubernetes tests.

- Added and validated `business-environment.json`, one public MCP oracle, and
  `services.manifest.json`; Helm lint is green.
- Added Chart metadata, values, a Deployment-owned opted-in journey emitter/client, and the missing
  collector ServiceAccount.
- The first isolated minikube rollout reached the real DaemonSet and exposed a non-root init
  container configuration error; `runAsUser: 65532` fixes that observed failure.
- HI-079 is repaired: attempted Helm releases now uninstall before namespace deletion.
- Implemented HI-081 in the harness template: exact context, absent namespace prefix, Helm owner
  label/annotations, chart/release identity, and an explicit RBAC allowlist are validated before
  mutation. The demo proves mismatch-red/no-mutation and exact-green/adopt/uninstall/absence.
- Propagated the repaired tool through `upgrade-harness.mjs`; bounded recovery of the approved
  minikube orphan exited 0. Independent reads verified the old RBAC objects, release, and recovery
  namespace absent; HI-081 is resolved.
- HI-082 is repaired in the harness template and propagated: init and app logs are separate, the
  full 64-step demo is green, upgrade-context validation is green, and the issue is resolved.
- The first repaired report exposed a project preflight bug: BusyBox `find` rejects `-readable`.
  The chart now uses BusyBox-supported enumeration and an actual non-root file-open probe.
- The second 180-second retry verified A-006 false on local minikube. The emitter and MCP client
  were Running; `node-log-preflight` could open no `*.log` beneath `/var/log/pods`, while the app
  file independently recorded `PodInitializing`.
- Retry cleanup is green: both run namespaces, releases, ClusterRoles, and ClusterRoleBindings are absent;
  `list-stale --older-than 0h` returned no namespace.
- HI-083's fix is implemented in the canonical K8s runner: a service manifest can select validated
  Helm values files without changing chart defaults. Targeted syntax, render, upgrade-context and
  real-rollout checks pass; the full harness demo was interrupted externally before completion, so
  HI-083 remains open pending that gate.
- The default chart still renders the DaemonSet. The local override renders no DaemonSet and injects
  the pinned collector only into `journey-log-emitter`; the real pod reached 2/2 Running and the
  sidecar watched `/var/log/journey/emitter.log`.
- The 15-second health gate then failed because the chart renders no ingest/MCP Service or workload.
  Sidecar logs independently report DNS lookup failure for `log-debug-context-ingest`. The run
  namespace, release, ClusterRole, and ClusterRoleBinding were absent after cleanup.
- Added the runnable shaded Java service, OTLP/HTTP adapter, audience-bound offline ServiceAccount
  JWT validator, ingest/MCP Services, shared service Deployment, and in-cluster OpenSearch StatefulSet.
  Maven package, Helm lint/render, shell syntax, and diff checks pass; no live success is claimed.

## Next Session Startup

1. Run `node harness/tools/loop-status.mjs` and `node harness/loop/route.mjs`; the router should exit with all features done.
2. Keep HI-084's unfinished canonical demo/docs/upgrade-context work separate from the completed project feature set.

## Known Boundary

- No interrupted test namespace, Helm release, collector RBAC, or harness-labelled namespace remains.
- Minikube is local and disposable and is stopped after this k8s-targeted iteration.
- A-006 is verified false only for the authorized local minikube environment; this does not prove
  every target cluster denies the DaemonSet path.
- A-009 is closed and the sidecar is confined to the explicit local journey values file.
- The service surface was live-proved by the checker-approved public journey against the built image;
  cleanup was independently verified.

## Human Decision Receipt

- **Question ID:** `hi-081-local-orphan-recovery`
- **Question:** May the harness add and run a bounded recovery that validates and removes the exact
  pre-fix local-minikube Helm RBAC orphan before resuming feat-011?
- **Answer:** `approve`
- **Answered by:** project owner, in conversation
- **Answered at:** 2026-08-29T19:09:48+07:00
- **Scope:** only release `log-debug-context` and its annotation-named deleted local namespace
  `log-debug-journey-5b9bd44-1787991874-43083`; no remote, shared, or production context.
- **Basis:** HI-081 and the recorded 0.6-second ownership-validation failure in feat-011 evidence.
- **Closed follow-up:** recovery and independent absence checks passed; HI-081 is resolved.

- **Question ID:** `feat-011-local-cluster-selection`
- **Question:** Which non-shared Kubernetes environment may run the destructive, bounded feat-011 journey?
- **Answer:** The project owner chose option 1: use a local disposable Kubernetes cluster.
- **Answered by:** project owner, in conversation
- **Answered at:** 2026-08-29T15:01:09+07:00
- **Scope:** feat-011 Kubernetes journey only; no remote, shared, or production cluster is authorized.
- **Observed environment:** kubeconfig contains only the current `minikube` context; its API server at
  `127.0.0.1:32811` was stopped when probed. `minikube`, `kubectl`, and Docker CLIs are installed.
- **Interpretation for owner:** the feat-011 maker may use and start this local disposable minikube
  environment when needed, must use namespace isolation and bounded cleanup, and must not target any
  remote or shared context.
- **Open follow-up:** A-006 remains a runtime fact: the journey must report distinctly if minikube
  does not permit the scoped node-level collector to read the selected container logs.

- **Question ID:** `hi-009-local-sidecar-fallback`
- **Question:** May feat-011 switch the opted-in disposable journey workload to the per-workload
  sidecar fallback on local minikube after A-006 was verified false?
- **Answer:** `1` — approve the sidecar fallback for this journey workload only; preserve the
  DaemonSet default elsewhere.
- **Answered by:** project owner, in conversation
- **Answered at:** 2026-08-29T20:25:58+07:00
- **Scope:** feat-011's namespace-isolated local-minikube journey; no remote, shared, or production
  workload topology changes.
- **Basis:** A-006 runtime observation recorded in `harness/docs/assumptions.md`; option 1 was the
  recommended bounded remediation for the verified local limitation.
- **Closed follow-up:** the sidecar reached Ready and watched the emitted shared file; the bounded
  rollout then exposed the missing ingest/MCP chart boundary.
