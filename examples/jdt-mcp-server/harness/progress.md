# Progress Log — JDT MCP Server

External state for cross-session continuity (Lesson 5). The agent's memory is wiped between
sessions; this file is not. Update it at the end of every session (Lesson 12).

## Current State

- **Last updated:** 2026-08-21
- **Active feature:** none — feat-jdtls-provisioner is blocked after exhausting 3/3 maker attempts
- **Latest commit:** pending — block provisioner pending an independent success-path oracle
- **Baseline (`./harness/init.sh`):** green — fixture cached and all six maintained baseline integration cases passed

## Done

- [x] feat-001 — Baseline green
  - Checker replayed the six-case integration oracle and `./harness/init.sh`; injected install, fixture, and test failures each made the gate red and stopped later steps.

## In Progress

- [ ] feat-jdtls-provisioner — blocked at its 3/3 attempt budget
  - The unchanged 12-case integration oracle passed before implementation work, while still omitting successful empty-cache download, checksum verification, extraction, and pinned installation. Maker-owned source already implements that path, and the maker must not rewrite the test-implementer's oracle.

## Next

1. Route TP-PROV-0001 / `feat-prove-provisioner` to the oracle layer for a successful first-run download-and-install condition and executable test.
2. After that oracle is red against a broken success path, re-plan or reset the maker attempt budget through the owning role before returning `feat-jdtls-provisioner`.

## Known Issues / Risks

- [ ] Eclipse snapshot downloads are slow on this network; the fetcher uses bounded parallel ranges and caches the checksum-verified archive contents.

## Notes for Next Session

The maker first made the authored contract importable, then recorded a qualifying six-assertion red run before implementing. The final verification passed all 12 cases.
