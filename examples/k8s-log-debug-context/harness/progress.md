# Progress Log — Kubernetes Log Debug Context

External state for cross-session continuity (Lesson 5). The agent's memory is wiped between
sessions; this file is not. Update it at the end of every session (Lesson 12).

## Current State

- **Last updated:** 2026-08-28
- **Active feature:** none — feat-004 requires retention design before adapter implementation
- **Latest commit:** 3dccb63 Phơi bày source root bị thiếu cho ingestion
- **Baseline (`node harness/init.mjs`):** green with Homebrew OpenJDK 21; Temurin 25.0.3 is rejected by the Java gate

## Done

- [x] Design artifacts: options, critique, components, seams, invariants, and feature-impact map
- [x] Human approved design digest `e54ec9db4f8258a1`, including `INV-SCHEMA-1`, X-006 through X-008, and A-006 risk
- [x] Build/prove feature DAG traced to approved invariants
- [x] Feature planner consumed the schema-design answer for feat-003 without changing the 11-feature DAG
- [x] Setup readiness: baseline green, 13/13 coverage, and 0 verification blockers
- [x] `feat-011` Level-3 journey oracle authored and observed red at the absent deployment-chart boundary

## In Progress

- [ ] Java 21 Maven baseline (`feat-001`)
  - Details: Maven Enforcer accepts only `[21,22)` and the JUnit baseline asserts runtime feature 21 exactly.
  - Blockers: none; red JDK 25 rejection and green JDK 21 execution are recorded for checker review.
- [ ] Sanitized normalized ingestion (`feat-002`)
  - Details: serialized v1 admission, normalization, redaction, and the compile-complete index/query seam pass the unit suite and five-condition black-box oracle.
  - Blockers: none; review packet is admitted and awaits independent checker judgement.
- [ ] Ingest schema and safety contract (`feat-003`)
  - Details: the unchanged black-box oracle now passes all five scope, redaction, metadata, additive-v1, and unsupported-major conditions.
  - Blockers: none; red/green evidence and review packet await independent checker judgement.
- [ ] OpenSearch log index adapter (`feat-004`)
  - Details: the approved constructor and mapping surface are insufficient to install the required seven-day retention lifecycle.
  - Blockers: define the real ISM/lifecycle policy seam and idempotency; then grant ownership of its artifact and the missing OpenSearch client dependency in `pom.xml`.

## Next

1. Route the `NEEDS DESIGN:` marker on `feat-004` to the design facilitator.
2. Re-plan dependency and policy-artifact ownership after the human approves the retention mechanism.

## Known Issues / Risks

- [ ] A-006 node-log access unknown — Option A needs a preflight DaemonSet proof; use sidecar path only for inaccessible sources.
- [ ] The Kubernetes journey requires an explicitly selected non-shared test cluster and bounded cleanup.

## Notes for Next Session

The feature planner intentionally left product/test paths unimplemented; each verification command
becomes runnable as its owning build/prove feature lands. No unresolved product-policy checkpoint remains.
