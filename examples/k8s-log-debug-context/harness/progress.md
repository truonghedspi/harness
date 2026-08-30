# Progress Log — Kubernetes Log Debug Context

External state for cross-session continuity (Lesson 5). The agent's memory is wiped between
sessions; this file is not. Update it at the end of every session (Lesson 12).

## Current State

- **Last updated:** 2026-08-30 (checker, feat-011 approved)
- **Active feature:** none — all 13 features are `done`; final approval gate is next
- **Latest commit:** 1302959 k8s-log-debug-context: feat-006 MCP query service + feat-007 wire/auth contract done
- **Baseline (`env -u JAVA_HOME node harness/init.mjs`):** green — init.mjs now selects Homebrew OpenJDK 21 itself (BaselineTest Tests run: 1, Failures: 0)
- **OpenSearch:** 2.19.1 live at `http://localhost:9200`, ISM plugin present

## Done

- [x] Design artifacts: options, critique, components, seams, invariants, and feature-impact map
- [x] Human approved design digest `e54ec9db4f8258a1`, including `INV-SCHEMA-1`, X-006 through X-008, and A-006 risk
- [x] Build/prove feature DAG traced to approved invariants
- [x] Feature planner consumed the schema-design answer for feat-003 without changing the 11-feature DAG
- [x] Feature planner consumed approved ISM digest `441eb6d76fd1752d`
- [x] Setup readiness: baseline green, 13/13 coverage, and 0 verification blockers
- [x] `feat-011` Level-3 journey oracle authored and observed red at the absent deployment-chart boundary
- [x] `feat-001` Java 21 Maven baseline — checker APPROVE (verification green under OpenJDK 21; follow-up: auto-select JDK 21 in the standard path)
- [x] `feat-002` Sanitized normalized ingestion — checker APPROVE (2 tests green)
- [x] `feat-003` Ingest schema and safety contract — checker APPROVE (5 tests green)
- [x] `feat-004` OpenSearch log index adapter — checker APPROVE (2 tests green, mutant-red discriminated)
- [x] `feat-012` Reproducible JDK 21 baseline selection — checker APPROVE (`env -u JAVA_HOME node harness/init.mjs` exit 0, Homebrew OpenJDK 21 auto-selected for `./mvnw` only)
- [x] `feat-005` OpenSearch storage contract — checker APPROVE (7 tests green against live OpenSearch 2.19.1; 90s `@Timeout` added)
- [x] `feat-010` Cluster access policy — checker APPROVE (4/4 static policy tests green against the real `rbac.yaml`/`networkpolicy.yaml`; no `*` verbs/resources, `-service` SA has no K8s RBAC, one default-deny-ingress NetworkPolicy admitting only cluster-internal TCP 8080, no MCP→ingest edge). FOLLOW-UP to planner: the `-collector` ServiceAccount is referenced (daemonset + ClusterRoleBinding) but never defined by any template.
- [x] `feat-011` Kubernetes diagnostic-context journey — checker APPROVE (persisted real minikube Level-3 run exit 0: authenticated MCP 401/401/200, target-only correlation, redaction, X-006 bounds, independent cleanup absence; baseline and deadline contract replayed green)

## In Progress

- `feat-011` now has a valid business-environment contract, one public MCP journey oracle, a
  service registry, an installable chart, a Deployment-owned opted-in emitter, and the previously
  missing collector ServiceAccount. The first real minikube rollout exposed and fixed the
  preflight init container's missing numeric non-root UID.
- HI-079 is repaired for future attempts: the script now uninstalls every attempted release before
  deleting its namespace. A bounded retry confirmed its new namespace was removed and no stale
  namespace remained.
- HI-081 is resolved. The identity-validating recovery mode rejected a mismatched owner without
  mutation in the demo, then adopted/uninstalled the exact approved minikube release. Independent
  reads verified the old ClusterRole, ClusterRoleBinding, release, and recovery namespace absent.
- HI-082 is resolved in the harness template. The demo proves a waiting app container cannot mask
  failed init stderr; the canonical upgrader propagated byte-identical per-container diagnostics.
- The first preserved preflight exposed BusyBox's unsupported GNU `find -readable`; replacing it
  with an actual non-root file-open probe removed that false signal.
- The second bounded rollout verified A-006 false on local minikube: the Running emitter produced
  logs, but `node-log-preflight` could open none under `/var/log/pods`. Cleanup removed the namespace,
  release, and both RBAC objects; `list-stale --older-than 0h` was empty.
- A-009 is implemented as an explicit local-minikube values file. The default render keeps the
  DaemonSet; the override renders no DaemonSet and injects the pinned collector only into the
  opted-in journey Deployment. The real pod reached 2/2 Ready and watched the shared log file.
- HI-083's canonical values-file fix passes targeted syntax, render, upgrade-context and live-use
  checks, but remains open because the full harness demo was externally interrupted before completion.
- The bounded retry exposed the next project boundary: no `log-debug-context-ingest` or
  `log-debug-context-mcp` Service/workload is rendered. The serving-health gate failed after 15s,
  and the sidecar named the absent ingest DNS record. Cleanup removed all run resources.
- The project-layer boundary is now implemented: a shaded Java entry point wires OTLP decode,
  sanitized ingest, the real OpenSearch adapter, and audience-bound offline JWT validation. The
  chart renders the shared service Deployment, ingest/MCP Services, and OpenSearch StatefulSet.
  Maven packaging, Helm lint/render, journey shell syntax, and diff checks are green; no live claim yet.
- The authorized minikube attempt built and loaded `log-debug-context:feat-011`; OpenSearch, the
  service, sidecar-backed emitter, and MCP client reached Ready. The serving-health command used
  `GET /mcp` and expected 401, but the POST-only MCP boundary correctly returned 405, so the test
  command never started. Report: `harness/trace/k8s-test/log-debug-journey-5b9bd44-1788011923-86711`.
- HI-084 records the missing runner path for an existing labelled namespace whose release is stuck
  `uninstalling`. Its exact-identity implementation cleaned the first stale run in 11.3s, but the
  required demo/docs/upgrade-context proof is unfinished and the issue remains open.
- The POST-health retry exposed and fixed two oracle bugs: the Deployment pod has a generated name,
  and expected `kubectl auth can-i` denials exit nonzero under `pipefail` despite printing `no`.
- The prior session's final retry reached deploy, POST health, Deployment/client readiness, and RBAC
  denial before interruption. Its recorded stale namespace/release was rechecked this session; the
  absence result below supersedes that checkpoint.
- On restart the exact recorded stale namespace/release, collector ClusterRole/Binding, and every
  harness-labelled namespace were already absent, so the exceptional cleanup mode correctly had no
  remaining identity to mutate.
- The first uninterrupted run exposed an oracle classification gap: 222 emitter records and the
  sidecar were live, but a valid-audience token was also HTTP 401. The added authenticated tools/list
  discriminator isolated auth before collector convergence.
- Bounded anonymous probes established local minikube returns 403 for discovery and JWKS. The
  built-in issuer-discovery binding authorizes ServiceAccounts, so the service now refreshes JWKS
  with its rotated projected token while keeping signature/audience/issuer validation local and
  adding no project RBAC or TokenReview grant.
- The exact feature command exited 0 in `log-debug-journey-5b9bd44-1788059125-44732`: auth
  401/401/200, exact correlation, secrets redacted, <=200 records, <=256 KiB, <=15m interval, no
  pagination, 1s query. Total 32077ms; diagnostics captured; independent cleanup reads were empty.

## Next

1. Run the final approval gate; all feature claims are independently `done`.
2. Keep HI-084 separate: its canonical demo/docs/upgrade-context proof remains unfinished even
   though no stale project resource remains.

## Known Issues / Risks

- [x] A-006 node-log access classified false on authorized local minikube from a real non-root file-open probe.
- [x] A-009 sidecar fallback approved and scoped to the disposable local-minikube journey.
- [x] The deploy surface and full authenticated business scenario completed on authorized local minikube.
- [x] The interrupted namespace/release state is absent; no exact cleanup mutation remained to run.
- [ ] The Kubernetes journey requires an explicitly selected non-shared test cluster and bounded cleanup.
- [x] The standard startup path auto-selects JDK 21 (feat-012): `env -u JAVA_HOME node harness/init.mjs`
      is green without a manual export.

## Notes for Next Session

feat-001..010 and feat-012 are `done`. The Maven Enforcer `[21,22)` gate makes a wrong-JDK pass
impossible (it goes red), and `harness/init.mjs` now selects Homebrew OpenJDK 21 itself (feat-012,
done), so no manual `JAVA_HOME` export is needed. feat-010 shipped with one FOLLOW-UP for the planner:
the `-collector` ServiceAccount is referenced (daemonset + ClusterRoleBinding) but never defined — the
collector DaemonSet pod fails admission without it, so it must land before feat-011's journey installs
the chart. The deployable chart (Chart.yaml, service Deployment, `-ingest`/`-mcp` Services, ServiceAccounts)
is still absent and is feat-011's unimplemented product boundary.
