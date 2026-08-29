# Progress Log — Kubernetes Log Debug Context

External state for cross-session continuity (Lesson 5). The agent's memory is wiped between
sessions; this file is not. Update it at the end of every session (Lesson 12).

## Current State

- **Last updated:** 2026-08-29 (maker, feat-013 Chart opt-in filter direction and v1 transform — `readyForCheck`, awaiting checker)
- **Active feature:** feat-013 — `in-progress` / `readyForCheck` (waiting on checker); feat-011 (journey) remains `not-started`, routed to `k8s-integration-tester` (no cluster here)
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

## In Progress

- `feat-013` Chart opt-in filter direction and v1 transform — chart ConfigMap fixed to `!=` (drop-where-true), message→body, `test.run_id` from `attributes["attributes"]["test.run_id"]`, workload from `k8s.deployment.name`; policy test strengthened to assert filter direction. Verification green (7 run, 0 fail). `readyForCheck: true`, awaiting checker.

## Next

1. Checker reviews `feat-013` (`readyForCheck`).
2. Planner routes feat-010's `FOLLOW-UP`: define the `{{ .Release.Name }}-collector` ServiceAccount in a chart template (it is referenced by `collector-daemonset.yaml:31` and `rbac.yaml`'s ClusterRoleBinding but never defined; design `cluster-access-policy.md:80` falsely cites it as "exists").
3. `feat-011` (Kubernetes journey) remains `not-started` — k8s-specialized, routed to `k8s-integration-tester`.

## Known Issues / Risks

- [ ] A-006 node-log access unknown — Option A needs a preflight DaemonSet proof; use sidecar path only for inaccessible sources.
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
