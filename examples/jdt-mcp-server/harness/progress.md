# Progress Log — JDT MCP Server

External state for cross-session continuity (Lesson 5). The agent's memory is wiped between
sessions; this file is not. Update it at the end of every session (Lesson 12).

## Current State

- **Last updated:** 2026-08-21
- **Active feature:** none — feat-project-router still needs its promised TCON-ROUTE-0005 oracle
- **Latest commit:** pending — stop project-router maker on the still-incomplete independent oracle
- **Baseline (`./harness/init.sh`):** green — fixture cached and all six maintained baseline integration cases passed

## Done

- [x] feat-001 — Baseline green
  - Checker replayed the six-case integration oracle and `./harness/init.sh`; injected install, fixture, and test failures each made the gate red and stopped later steps.

## In Progress

- [ ] feat-jdtls-provisioner — blocked at its 3/3 attempt budget
  - The unchanged 12-case integration oracle passed before implementation work, while still omitting successful empty-cache download, checksum verification, extraction, and pinned installation. Maker-owned source already implements that path, and the maker must not rewrite the test-implementer's oracle.
- [ ] feat-project-router — needs re-planning after attempt 2/3
  - The repaired verification command now runs, but fails on the absent production import before assertions, while the independent oracle still explicitly excludes promised TCON-ROUTE-0005 / `INV-ROUTE-2`. Maker stopped without implementation or test edits.

## Next

1. Route `feat-project-router` through planning/oracle dispatch so the test-implementer authors TCON-ROUTE-0005 before another maker attempt.
2. Route TP-PROV-0001 / `feat-prove-provisioner` to the oracle layer for a successful first-run download-and-install condition and executable test.

## Known Issues / Risks

- [ ] Eclipse snapshot downloads are slow on this network; the fetcher uses bounded parallel ranges and caches the checksum-verified archive contents.

## Notes for Next Session

The project-router maker's second required red run reached the maintained test command but failed on `ERR_MODULE_NOT_FOUND` before assertions. Do not implement or count this as qualifying red until the independent oracle adds the deliberately omitted unmanaged-path condition.
