# Progress Log — JDT MCP Server

External state for cross-session continuity (Lesson 5). The agent's memory is wiped between
sessions; this file is not. Update it at the end of every session (Lesson 12).

## Current State

- **Last updated:** 2026-08-21
- **Active feature:** feat-jdtls-provisioner — implementation is ready for independent check
- **Latest commit:** pending — implement pinned JDT LS provisioner
- **Baseline (`./harness/init.sh`):** green — fixture cached and all six maintained baseline integration cases passed

## Done

- [x] feat-001 — Baseline green
  - Checker replayed the six-case integration oracle and `./harness/init.sh`; injected install, fixture, and test failures each made the gate red and stopped later steps.

## In Progress

- [ ] feat-jdtls-provisioner — ready for checker replay
  - The 12-case integration oracle passes for JVM 21+, exact pin resolution, fail-closed `JDTLS_HOME`, and bounded download failure; maker did not set `done`.

## Next

1. Checker independently replays and falsifies feat-jdtls-provisioner.
2. Router selects the next eligible foundation feature after the verdict.

## Known Issues / Risks

- [ ] Eclipse snapshot downloads are slow on this network; the fetcher uses bounded parallel ranges and caches the checksum-verified archive contents.

## Notes for Next Session

The maker first made the authored contract importable, then recorded a qualifying six-assertion red run before implementing. The final verification passed all 12 cases.
