# Progress Log — JDT MCP Server

External state for cross-session continuity (Lesson 5). The agent's memory is wiped between
sessions; this file is not. Update it at the end of every session (Lesson 12).

## Current State

- **Last updated:** 2026-08-20
- **Active feature:** feat-001 — Baseline green (ready for checker review of false-green verification)
- **Latest commit:** pending — record feat-001 false-green oracle
- **Baseline (`./harness/init.sh`):** green — but it does not exercise the missing JDT LS fixture fetcher

## Done

- [ ] [completed item]

## In Progress

- [ ] feat-001 — Baseline green
  - Details: `node harness/init.mjs` exited 0 before implementation.
  - Blockers: scoped `tools/fetch-jdtls-fixture.mjs` is absent, so the verification cannot falsify the feature behavior or supply required red evidence.

## Next

1. Checker must reject or re-route the false-green oracle; maker cannot honestly manufacture red evidence.
2. Add an independent assertion that the baseline installs dependencies and provisions the pinned fixture before implementing the missing behavior.

## Known Issues / Risks

- [ ] `feat-001` verification is false-green — it permits the foundational feature to advance without its pinned JDT LS fixture — route oracle repair before implementation.

## Notes for Next Session

The maker ran the required verification before implementation. It passed even though the feature's scoped fixture-fetch script does not exist. No product code or test was changed because the maker prompt explicitly forbids adding redundant code after a pre-implementation green and requires assertion-failure red evidence.
