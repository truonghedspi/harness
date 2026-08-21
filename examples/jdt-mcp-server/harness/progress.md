# Progress Log — JDT MCP Server

External state for cross-session continuity (Lesson 5). The agent's memory is wiped between
sessions; this file is not. Update it at the end of every session (Lesson 12).

## Current State

- **Last updated:** 2026-08-21
- **Active feature:** none — feat-lsp-client requires its independent oracle before a maker attempt
- **Latest commit:** pending — stop maker before non-assertion red and route lsp-client to oracle authoring
- **Baseline (`./harness/init.sh`):** green — fixture cached and all six maintained baseline integration cases passed

## Done

- [x] feat-001 — Baseline green
  - Checker replayed the six-case integration oracle and `./harness/init.sh`; injected install, fixture, and test failures each made the gate red and stopped later steps.

## In Progress

- [ ] feat-jdtls-provisioner — blocked at its 3/3 attempt budget
  - The unchanged 12-case integration oracle passed before implementation work, while still omitting successful empty-cache download, checksum verification, extraction, and pinned installation. Maker-owned source already implements that path, and the maker must not rewrite the test-implementer's oracle.
- [ ] feat-project-router — needs re-planning after attempt 2/3
  - The repaired verification command now runs, but fails on the absent production import before assertions, while the independent oracle still explicitly excludes promised TCON-ROUTE-0005 / `INV-ROUTE-2`. Maker stopped without implementation or test edits.
- [ ] feat-lsp-client — needs oracle dispatch before attempt 1/4
  - Its refreshed context packet is current, but its declared `test/lsp/lsp-client.spec.ts` oracle does not exist and `npm test` is not wired. The maker stopped without consuming an attempt so the required red can be assertion-based and independently authored.

## Next

1. Dispatch `feat-lsp-client`'s independent oracle before another maker run; its context packet is already refreshed.
2. Route `feat-project-router` through planning/oracle dispatch so the test-implementer authors TCON-ROUTE-0005 before another maker attempt.
3. Route TP-PROV-0001 / `feat-prove-provisioner` to the oracle layer for a successful first-run download-and-install condition and executable test.

## Known Issues / Risks

- [ ] Eclipse snapshot downloads are slow on this network; the fetcher uses bounded parallel ranges and caches the checksum-verified archive contents.

## Notes for Next Session

The lsp-client maker did not run the declared verification because the file is absent; a missing-module failure is not qualifying red. Author the independent assertion oracle before implementation. The project-router oracle gap also remains unresolved.
