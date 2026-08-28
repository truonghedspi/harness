# Progress Log — Kubernetes Log Debug Context

External state for cross-session continuity (Lesson 5). The agent's memory is wiped between
sessions; this file is not. Update it at the end of every session (Lesson 12).

## Current State

- **Last updated:** 2026-08-27
- **Active feature:** feat-002 — unit oracle red; Maven main-source ownership requires re-planning
- **Latest commit:** e581eee Định tuyến lại public seam của ingest
- **Baseline (`node harness/init.mjs`):** green with explicit Homebrew OpenJDK 21; the same gate rejects Temurin 25.0.3

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
  - Details: its unit proof reports two assertion failures and zero errors at the absent public ingest contract.
  - Blockers: `pom.xml` does not map `service/src/main/java` as a Maven source directory, and feat-002 does not own that build file.

## Next

1. Route the new `NEEDS RE-PLAN:` marker on `feat-002` to the feature planner.
2. Resume product implementation after feat-002 owns the Maven main-source configuration needed to compile its approved paths.

## Known Issues / Risks

- [ ] A-006 node-log access unknown — Option A needs a preflight DaemonSet proof; use sidecar path only for inaccessible sources.
- [ ] The Kubernetes journey requires an explicitly selected non-shared test cluster and bounded cleanup.

## Notes for Next Session

The feature planner intentionally left product/test paths unimplemented; each verification command
becomes runnable as its owning build/prove feature lands. No unresolved product-policy checkpoint remains.
