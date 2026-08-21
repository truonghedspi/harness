# Progress Log — JDT MCP Server

External state for cross-session continuity (Lesson 5). The agent's memory is wiped between
sessions; this file is not. Update it at the end of every session (Lesson 12).

## Current State

- **Last updated:** 2026-08-21
- **Active feature:** none — feat-project-router needs re-planning before implementation
- **Latest commit:** pending — route project-router's broken verification to the planner/oracle layer
- **Baseline (`./harness/init.sh`):** green — fixture cached and all six maintained baseline integration cases passed

## Done

- [x] feat-001 — Baseline green
  - Checker replayed the six-case integration oracle and `./harness/init.sh`; injected install, fixture, and test failures each made the gate red and stopped later steps.

## In Progress

- [ ] feat-jdtls-provisioner — blocked at its 3/3 attempt budget
  - The unchanged 12-case integration oracle passed before implementation work, while still omitting successful empty-cache download, checksum verification, extraction, and pinned installation. Maker-owned source already implements that path, and the maker must not rewrite the test-implementer's oracle.
- [ ] feat-project-router — needs re-planning after attempt 1/3
  - Its declared `npm test -- test/workspace/project-router.spec.ts` verification cannot reach an assertion because `npm test` and the named test file do not exist. The existing integration oracle deliberately excludes `INV-ROUTE-2`, so it cannot replace the build verification as written.

## Next

1. Route `feat-project-router` to the feature planner to refresh its stale context packet and repair ownership of a runnable `INV-ROUTE-2` oracle.
2. Route TP-PROV-0001 / `feat-prove-provisioner` to the oracle layer for a successful first-run download-and-install condition and executable test.

## Known Issues / Risks

- [ ] Eclipse snapshot downloads are slow on this network; the fetcher uses bounded parallel ranges and caches the checksum-verified archive contents.

## Notes for Next Session

The project-router maker stopped before implementation because its required red run failed in npm command dispatch, not an assertion. Do not substitute the prove-feature integration oracle without adding the deliberately omitted unmanaged-path condition.
