# Progress Log — JDT MCP Server

External state for cross-session continuity (Lesson 5). The agent's memory is wiped between
sessions; this file is not. Update it at the end of every session (Lesson 12).

## Current State

- **Last updated:** 2026-08-21
- **Active feature:** feat-project-router — ready for checker after attempt 1/3
- **Latest commit:** pending — maker implemented project routing and recorded qualifying red/green evidence
- **Baseline (`./harness/init.sh`):** green at iteration start — six baseline integration cases and four lsp-client unit cases passed

## Done

- [x] feat-001 — Baseline green
  - Checker replayed the six-case integration oracle and `./harness/init.sh`; injected install, fixture, and test failures each made the gate red and stopped later steps.

## Blocked

- [ ] feat-prove-provisioner — timebox-blocked after attempt 3/3
  - Checker replayed all 13 cases green in 562.2 s, including the real clean-cache download/install path. But TCON-PROV-0008 only compares the installed files to the same archive it handed to the implementation; it never requires checksum-mismatch rejection for corrupted downloaded bytes. A removed checksum guard would stay green, so the prove claim cannot close until the oracle adds that condition.

## In Progress
- [ ] feat-project-router — ready for checker after attempt 1/3
  - Fresh per-call realpath routing collapses modules to the outer reactor, hashes the canonical root for identity, and names unmanaged paths explicitly; all five independent integration conditions pass.
- [ ] feat-jdtls-provisioner — ready for checker after attempt 2/3
  - The unchanged implementation passed all 13 independent integration cases before implementation again (479.5 s), including clean-cache checksum verification, download, extraction, and pinned installation; no redundant source change was made.
- [ ] feat-lsp-client — rejected after attempt 1/4
  - Checker replayed the four green unit cases, but they manually emit `exit` over PassThrough streams. This process-boundary feature needs a bounded cross-process integration oracle that kills a spawned scripted child with requests in flight.

## Next

1. Add and run a committed corrupt-download/checksum-rejection integration condition for `feat-prove-provisioner`, then return it to checker review.
2. Add and run the required bounded cross-process oracle for `feat-lsp-client`, then return it to checker review.
3. Checker replays `feat-project-router`'s five-condition integration oracle.

## Known Issues / Risks

- [ ] Eclipse snapshot downloads are slow on this network; the fetcher uses bounded parallel ranges and caches the checksum-verified archive contents.

## Notes for Next Session

The prove-provisioner feature is rejected: its 13-case green replay lacks corrupt-download/checksum-rejection coverage. The lsp-client still needs a cross-process oracle. Project-router is implemented and awaits checker replay; its stale context packet should be refreshed before future maker reuse.
