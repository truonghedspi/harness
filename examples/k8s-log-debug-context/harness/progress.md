# Progress Log — Kubernetes Log Debug Context

External state for cross-session continuity (Lesson 5). The agent's memory is wiped between
sessions; this file is not. Update it at the end of every session (Lesson 12).

## Current State

- **Last updated:** 2026-08-29 (maker, feat-008 REJECT fixed — `readyForCheck: true`, attempts 1/3)
- **Active feature:** feat-008 Collector preflight and opt-in deployment — `readyForCheck: true` (FIXED: policy test now asserts opt-in/enrichment/schemaVersion-1/egress on the chart ConfigMap too)
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

## In Progress

- [x] `feat-008` Collector preflight and opt-in deployment — `readyForCheck: true` (maker fixed the REJECT). `CollectorDeploymentPolicyTest` now asserts opt-in/enrichment/schemaVersion-1/egress against BOTH `collector/otel-collector.yaml` and the chart's embedded ConfigMap. Falsification probe (sed `debug.logs/enabled`→`debug.logs/disabled` in the chart) → test red (1 failure, exit 1), restored byte-identical. Single-source-of-truth rejected as impractical (chart ConfigMap legitimately differs: `/var/log/pods` receiver + `k8sattributes` + `resource.attributes` vs the hermetic fixture's `kubernetes.*`); the two copies carry the same markers and the test rejects drift.

## Next

1. Checker reviews `feat-008` (`readyForCheck: true`); `node harness/loop/route.mjs` names the node.

## Known Issues / Risks

- [ ] A-006 node-log access unknown — Option A needs a preflight DaemonSet proof; use sidecar path only for inaccessible sources.
- [ ] The Kubernetes journey requires an explicitly selected non-shared test cluster and bounded cleanup.
- [x] The standard startup path auto-selects JDK 21 (feat-012): `env -u JAVA_HOME node harness/init.mjs`
      is green without a manual export.

## Notes for Next Session

feat-001..007 and feat-012 are `done`. The Maven Enforcer `[21,22)` gate makes a wrong-JDK pass
impossible (it goes red), and `harness/init.mjs` now selects Homebrew OpenJDK 21 itself (feat-012,
done), so no manual `JAVA_HOME` export is needed. feat-008 is `readyForCheck: true` (6/6 deployment
policy tests green); the checker rules next. Two feat-008 seams are deferred downstream: the journey
fixture's opt-in label (`log-context.harness.dev/enabled`) differs from the digest-bound `debug.logs/enabled`,
and the stock OTel Collector has no raw-JSON exporter, so feat-009 must reconcile the wire envelope.
