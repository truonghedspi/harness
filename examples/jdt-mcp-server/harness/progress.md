# Progress Log — JDT MCP Server

External state for cross-session continuity (Lesson 5). The agent's memory is wiped between
sessions; this file is not. Update it at the end of every session (Lesson 12).

## Current State

- **Last updated:** 2026-08-21
- **Active feature:** feat-jdtls-provisioner — ready for independent checker review
- **Latest commit:** pending — maker replayed the completed 13-case provisioner oracle; implementation already satisfied it
- **Baseline (`./harness/init.sh`):** green — six baseline integration cases and four lsp-client unit cases passed after the iteration

## Done

- [x] feat-001 — Baseline green
  - Checker replayed the six-case integration oracle and `./harness/init.sh`; injected install, fixture, and test failures each made the gate red and stopped later steps.

## In Progress

- [ ] feat-jdtls-provisioner — ready for checker after attempt 1/3
  - The unchanged implementation passed all 13 independent integration cases before implementation, including clean-cache checksum verification, download, extraction, and pinned installation; no redundant source change was made.
- [ ] feat-project-router — needs re-planning after attempt 2/3
  - The repaired verification command now runs, but fails on the absent production import before assertions, while the independent oracle still explicitly excludes promised TCON-ROUTE-0005 / `INV-ROUTE-2`. Maker stopped without implementation or test edits.
- [ ] feat-lsp-client — rejected after attempt 1/4
  - Checker replayed the four green unit cases, but they manually emit `exit` over PassThrough streams. This process-boundary feature needs a bounded cross-process integration oracle that kills a spawned scripted child with requests in flight.

## Next

1. Checker independently replays `feat-jdtls-provisioner` and judges whether it may become done.
2. Add and run the required bounded cross-process oracle for `feat-lsp-client`, then return it to checker review.
3. Implement `feat-project-router` against the now-complete five-condition integration oracle.

## Known Issues / Risks

- [ ] Eclipse snapshot downloads are slow on this network; the fetcher uses bounded parallel ranges and caches the checksum-verified archive contents.

## Notes for Next Session

The provisioner oracle gap is closed and the unchanged implementation passes all 13 cases. The lsp-client still needs a cross-process oracle; project-router's oracle gap is closed and awaits implementation.
