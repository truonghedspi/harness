# Progress Log — JDT MCP Server

External state for cross-session continuity (Lesson 5). The agent's memory is wiped between
sessions; this file is not. Update it at the end of every session (Lesson 12).

## Current State

- **Last updated:** 2026-08-21
- **Active feature:** feat-001 — Baseline green (ready for checker review)
- **Latest commit:** pending — implement pinned JDT LS baseline fixture
- **Baseline (`./harness/init.sh`):** green — real pinned archive fetched, checksum verified, maintained baseline tests passed

## Done

- [ ] [completed item]

## In Progress

- [ ] feat-001 — Baseline green
  - Red: maintained integration oracle failed its success assertion while `tools/fetch-jdtls-fixture.mjs` was absent.
  - Green: two focused tests passed; the full baseline fetched and verified the real pinned Eclipse archive before passing.

## Next

1. Checker replays the focused oracle and the standard baseline gate.
2. If approved, promote `feat-001`; the router can then select the next eligible foundation feature.

## Known Issues / Risks

- [ ] Eclipse snapshot downloads are slow on this network; the fetcher uses bounded parallel ranges and caches the checksum-verified archive contents.

## Notes for Next Session

The previous false-green verification was replaced by a maintained `node:test` oracle. The maker did not set `status: done`; `readyForCheck` is true for independent replay.
