# Progress Log — JDT MCP Server

External state for cross-session continuity (Lesson 5). The agent's memory is wiped between
sessions; this file is not. Update it at the end of every session (Lesson 12).

## Current State

- **Last updated:** 2026-08-21
- **Active feature:** none — feat-jdtls-provisioner needs re-planning before implementation
- **Latest commit:** pending — route the provisioner verification mismatch to re-planning
- **Baseline (`./harness/init.sh`):** green — fixture cached and all six maintained baseline integration cases passed

## Done

- [x] feat-001 — Baseline green
  - Checker replayed the six-case integration oracle and `./harness/init.sh`; injected install, fixture, and test failures each made the gate red and stopped later steps.

## In Progress

- [ ] feat-jdtls-provisioner — verification is not runnable as an assertion-bearing oracle
  - `npm test -- test/provision/jdtls-provisioner.spec.ts` fails because both the script and file are absent; the existing independent oracle belongs to `feat-prove-provisioner`.

## Next

1. Feature-planner repairs the feat-jdtls-provisioner verification/decomposition mismatch.
2. Router selects the next eligible foundation feature after re-planning.

## Known Issues / Risks

- [ ] Eclipse snapshot downloads are slow on this network; the fetcher uses bounded parallel ranges and caches the checksum-verified archive contents.

## Notes for Next Session

The maker stopped before implementation because the required pre-change verification failed in npm dispatch, not on a behavioral assertion. No red/green evidence was claimed.
