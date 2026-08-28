# Progress Log — Kubernetes Log Debug Context

External state for cross-session continuity (Lesson 5). The agent's memory is wiped between
sessions; this file is not. Update it at the end of every session (Lesson 12).

## Current State

- **Last updated:** 2026-08-28
- **Active feature:** none — feat-004 is re-planned and router-eligible for maker implementation
- **Latest commit:** 234afe2 Khóa digest thiết kế ISM hiện tại
- **Baseline (`node harness/init.mjs`):** green with Homebrew OpenJDK 21; Temurin 25.0.3 is rejected by the Java gate

## Done

- [x] Design artifacts: options, critique, components, seams, invariants, and feature-impact map
- [x] Human approved design digest `e54ec9db4f8258a1`, including `INV-SCHEMA-1`, X-006 through X-008, and A-006 risk
- [x] Build/prove feature DAG traced to approved invariants
- [x] Feature planner consumed the schema-design answer for feat-003 without changing the 11-feature DAG
- [x] Feature planner consumed approved ISM digest `441eb6d76fd1752d`; feat-004/005 now own bootstrap, resources, dependency, adapter tests, and real-store retention proof without changing the DAG
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
  - Details: owns the official client dependency, public idempotent bootstrap, canonical ISM/template resources, UTC daily index, adapter, and adapter-level tests.
  - Blockers: none; A-007 affects the later real-store proof, not implementation of the approved seam.

## Next

1. Route feat-004 to the maker for one bounded implementation step.
2. Expand feat-005's independent real-store oracle to cover INV-RETENTION-1 through INV-INDEX-SCHEMA-1 before claiming that proof complete.

## Known Issues / Risks

- [ ] A-006 node-log access unknown — Option A needs a preflight DaemonSet proof; use sidecar path only for inaccessible sources.
- [ ] The Kubernetes journey requires an explicitly selected non-shared test cluster and bounded cleanup.

## Notes for Next Session

The feature planner intentionally left product/test paths unimplemented. A-007 remains an
environment preflight for real-store execution, not an unresolved product-policy checkpoint.
