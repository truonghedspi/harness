# Progress Log — JDT MCP Server

External state for cross-session continuity (Lesson 5). The agent's memory is wiped between
sessions; this file is not. Update it at the end of every session (Lesson 12).

## Current State

- **Last updated:** 2026-08-21
- **Active feature:** feat-lsp-client — implementation is ready for independent checker replay
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
- [ ] feat-lsp-client — ready for checker after attempt 1/4
  - The maker-authored unit oracle was explicitly authorized after the router gap was resolved. Red showed the unimplemented request path; green covers Content-Length framing, split-frame parsing, out-of-order correlation, server-initiated requests, and pending-request rejection on exit.

## Next

1. Checker replays `feat-lsp-client` evidence and attempts to falsify framing, correlation, and process-exit settlement.
2. Route `feat-project-router` through planning/oracle dispatch so the test-implementer authors TCON-ROUTE-0005 before another maker attempt.
3. Route TP-PROV-0001 / `feat-prove-provisioner` to the oracle layer for a successful first-run download-and-install condition and executable test.

## Known Issues / Risks

- [ ] Eclipse snapshot downloads are slow on this network; the fetcher uses bounded parallel ranges and caches the checksum-verified archive contents.

## Notes for Next Session

The lsp-client implementation is ready for independent checker replay; the maker did not set it done. The project-router and provisioner oracle gaps remain unresolved.
