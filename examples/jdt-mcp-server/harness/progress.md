# Progress Log — JDT MCP Server

External state for cross-session continuity (Lesson 5). The agent's memory is wiped between
sessions; this file is not. Update it at the end of every session (Lesson 12).

## Current State

- **Last updated:** 2026-08-21
- **Active feature:** feat-project-router — maker replayed verification post-approval (attempt 2/3), readyForCheck true, awaiting checker
- **Latest commit:** pending — maker replay recorded for feat-project-router; feat-prove-routing untouched (separate feature)
- **Baseline (`./harness/init.sh`):** green — six baseline integration cases and four lsp-client unit cases passed

## Done

- [x] feat-001 — Baseline green
  - Checker replayed the six-case integration oracle and `./harness/init.sh`; injected install, fixture, and test failures each made the gate red and stopped later steps.

## Blocked

- [ ] feat-prove-provisioner — timebox-blocked after attempt 3/3
  - Checker replayed all 13 cases green in 562.2 s, including the real clean-cache download/install path. But TCON-PROV-0008 only compares the installed files to the same archive it handed to the implementation; it never requires checksum-mismatch rejection for corrupted downloaded bytes. A removed checksum guard would stay green, so the prove claim cannot close until the oracle adds that condition.

## In Progress
- [ ] feat-project-router — readyForCheck true, attempt 2/3, awaiting checker
  - Design approval 3d68e0857fbfac45 (2026-08-21) accepted Option R and corrected `INV-ROUTE-1`/A-006 to state the outer-reactor-root exception explicitly. Maker confirmed `src/workspace/project-router.ts` already implements Option R (outermost `<modules>`-bearing ancestor pom.xml, falling back to nearest ancestor pom.xml) and replayed `npm run test:integration -- test/integration/project-router.integration.spec.ts`: 5/5 passed (TCON-ROUTE-0001..0005). No source change was made.
- [ ] feat-jdtls-provisioner — ready for checker after attempt 2/3
  - The unchanged implementation passed all 13 independent integration cases before implementation again (479.5 s), including clean-cache checksum verification, download, extraction, and pinned installation; no redundant source change was made.
- [ ] feat-lsp-client — rejected after attempt 1/4
  - Checker replayed the four green unit cases, but they manually emit `exit` over PassThrough streams. This process-boundary feature needs a bounded cross-process integration oracle that kills a spawned scripted child with requests in flight.
- [ ] feat-prove-routing — NEEDS DESIGN marker cleared, ready for checker replay
  - Same design approval 3d68e0857fbfac45 aligns `INV-ROUTE-1`/A-006 with this feature's behavior sentence and its TCON-ROUTE-0001..0005 oracle; no oracle change was made.

## Next

1. Add and run a committed corrupt-download/checksum-rejection integration condition for `feat-prove-provisioner`, then return it to checker review.
2. Add and run the required bounded cross-process oracle for `feat-lsp-client`, then return it to checker review.
3. Checker replays `feat-project-router` (evidence recorded, readyForCheck true) and `feat-prove-routing` now that the design contradiction is resolved and both markers are cleared.

## Known Issues / Risks

- [ ] Eclipse snapshot downloads are slow on this network; the fetcher uses bounded parallel ranges and caches the checksum-verified archive contents.

## Notes for Next Session

The prove-provisioner feature is rejected: its 13-case green replay lacks corrupt-download/checksum-rejection coverage. The lsp-client still needs a cross-process oracle. The routing design contradiction (nearest-module-pom vs. outer-reactor root) is resolved by human-approved design digest `3d68e0857fbfac45`: `INV-ROUTE-1` and A-006 now name the outer-reactor-root exception explicitly, the feature-planner cleared both `NEEDS DESIGN` markers, and no re-implementation or re-cut was needed — the checker should replay `feat-project-router` and `feat-prove-routing` next.
