# Progress Log — JDT MCP Server

External state for cross-session continuity (Lesson 5). The agent's memory is wiped between
sessions; this file is not. Update it at the end of every session (Lesson 12).

## Current State

- **Last updated:** 2026-08-21
- **Active feature:** feat-001 — Baseline green (ready for checker review)
- **Latest commit:** pending — exercise the standard baseline gate in its maintained oracle
- **Baseline (`./harness/init.sh`):** green — fixture cached and all six maintained baseline integration cases passed

## Done

- [ ] [completed item]

## In Progress

- [ ] feat-001 — Baseline green
  - The maintained integration oracle invokes `harness/init.mjs`, observes all three required steps, and proves install, fixture, and test failures each make the gate red.

## Next

1. Checker replays the six-case focused oracle and the standard baseline gate.
2. If approved, promote `feat-001`; the router can then select the next eligible foundation feature.

## Known Issues / Risks

- [ ] Eclipse snapshot downloads are slow on this network; the fetcher uses bounded parallel ranges and caches the checksum-verified archive contents.

## Notes for Next Session

The checker-requested oracle gap is covered without changing production behavior. The pre-change focused command was already green; the new cases directly exercise baseline orchestration and its failure propagation.
