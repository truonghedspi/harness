# Progress Log — JDT MCP Server

External state for cross-session continuity (Lesson 5). The agent's memory is wiped between
sessions; this file is not. Update it at the end of every session (Lesson 12).

## Current State

- **Last updated:** 2026-08-21
- **Active feature:** feat-prove-routing — TCON-ROUTE-0006 authored/implemented by test-designer/test-implementer; maker independently replayed the full 6-condition suite green and set readyForCheck=true (attempts 2/3). feat-project-router stays done, untouched
- **Latest commit:** pending — maker replay confirmation for feat-prove-routing; no source or test change made
- **Baseline (`./harness/init.sh`):** green — six baseline integration cases and four lsp-client unit cases passed

## Done

- [x] feat-001 — Baseline green
  - Checker replayed the six-case integration oracle and `./harness/init.sh`; injected install, fixture, and test failures each made the gate red and stopped later steps.
- [x] feat-project-router — path to workspace id
  - Checker approved (attempt 2/3): 5/5 (TCON-ROUTE-0001..0005) pass, mutant probe killed every cited defect. Checker's own mutant probe on the just-approved code then found the `<modules>` reactor check is deletable without any of the 5 conditions failing — recorded as a FOLLOW-UP, not reopened here (see feat-prove-routing).

## Blocked

- [ ] feat-prove-provisioner — timebox-blocked after attempt 3/3
  - Checker replayed all 13 cases green in 562.2 s, including the real clean-cache download/install path. But TCON-PROV-0008 only compares the installed files to the same archive it handed to the implementation; it never requires checksum-mismatch rejection for corrupted downloaded bytes. A removed checksum guard would stay green, so the prove claim cannot close until the oracle adds that condition.

## In Progress
- [ ] feat-jdtls-provisioner — ready for checker after attempt 2/3
  - The unchanged implementation passed all 13 independent integration cases before implementation again (479.5 s), including clean-cache checksum verification, download, extraction, and pinned installation; no redundant source change was made.
- [ ] feat-lsp-client — rejected after attempt 1/4
  - Checker replayed the four green unit cases, but they manually emit `exit` over PassThrough streams. This process-boundary feature needs a bounded cross-process integration oracle that kills a spawned scripted child with requests in flight.
- [ ] feat-prove-routing — ready for checker after attempt 2/3
  - `TCON-ROUTE-0006` (traces to `INV-ROUTE-1`) is now authored and implemented: a non-reactor parent pom.xml (packaging=pom, no `<modules>`) with an independent child project's own pom.xml nested beneath it — the child path resolves to the child, not the parent. Maker independently replayed the full widened suite (did not just trust test-implementer's report): 6/6 pass (TCON-ROUTE-0001..0006) against the unchanged `src/workspace/project-router.ts`. No source or test change was needed. `readyForCheck=true`.

## Next

1. Add and run a committed corrupt-download/checksum-rejection integration condition for `feat-prove-provisioner`, then return it to checker review.
2. Add and run the required bounded cross-process oracle for `feat-lsp-client`, then return it to checker review.
3. Checker to review `feat-prove-routing`: 6/6 conditions (TCON-ROUTE-0001..0006) independently confirmed green by maker, attempt 2/3.

## Known Issues / Risks

- [ ] Eclipse snapshot downloads are slow on this network; the fetcher uses bounded parallel ranges and caches the checksum-verified archive contents.

## Notes for Next Session

The prove-provisioner feature is rejected: its 13-case green replay lacks corrupt-download/checksum-rejection coverage. The lsp-client still needs a cross-process oracle. `feat-project-router` is done and must stay untouched; its checker-approval FOLLOW-UP (the `<modules>` reactor check being deletable without failing any of the 5 existing conditions) was turned into explicit scope on `feat-prove-routing` (new `TCON-ROUTE-0006`, traces to `INV-ROUTE-1`) rather than reopening the done build feature — see `harness/DECISIONS.md`'s newest entry. `TCON-ROUTE-0006` is now authored/implemented and the maker independently replayed the full 6-condition suite green (no source or test change needed); `feat-prove-routing` is `readyForCheck` at attempt 2/3 and awaits checker review.
