# Progress Log — JDT MCP Server

External state for cross-session continuity (Lesson 5). The agent's memory is wiped between
sessions; this file is not. Update it at the end of every session (Lesson 12).

## Current State

- **Last updated:** 2026-08-21
- **Active feature:** feat-lsp-client — checker rejected its unit-only proof; a cross-process oracle is required
- **Latest commit:** pending — iteration 10 implemented the lsp-client and recorded red/green evidence
- **Baseline (`./harness/init.sh`):** green — baseline fixture and the four lsp-client unit cases passed

## Done

- [x] feat-001 — Baseline green
  - Checker replayed the six-case integration oracle and `./harness/init.sh`; injected install, fixture, and test failures each made the gate red and stopped later steps.

## In Progress

- [ ] feat-jdtls-provisioner — blocked at its 3/3 attempt budget
  - The unchanged 12-case integration oracle passed before implementation work, while still omitting successful empty-cache download, checksum verification, extraction, and pinned installation. Maker-owned source already implements that path, and the maker must not rewrite the test-implementer's oracle.
- [ ] feat-project-router — needs re-planning after attempt 2/3
  - The repaired verification command now runs, but fails on the absent production import before assertions, while the independent oracle still explicitly excludes promised TCON-ROUTE-0005 / `INV-ROUTE-2`. Maker stopped without implementation or test edits.
- [ ] feat-lsp-client — rejected after attempt 1/4
  - Checker replayed the four green unit cases, but they manually emit `exit` over PassThrough streams. This process-boundary feature needs a bounded cross-process integration oracle that kills a spawned scripted child with requests in flight.

## Next

1. Add and run the required bounded cross-process oracle for `feat-lsp-client`, then return it to checker review.
2. Route `feat-project-router` through planning/oracle dispatch so the test-implementer authors TCON-ROUTE-0005 before another maker attempt.
3. Route TP-PROV-0001 / `feat-prove-provisioner` to the oracle layer for a successful first-run download-and-install condition and executable test.

## Known Issues / Risks

- [ ] Eclipse snapshot downloads are slow on this network; the fetcher uses bounded parallel ranges and caches the checksum-verified archive contents.

## Notes for Next Session

The lsp-client unit suite is green but cannot prove behavior through child-process stdio or actual child termination; it is back in progress. The project-router and provisioner oracle gaps remain unresolved.
