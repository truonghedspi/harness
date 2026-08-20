# Progress Log — Harness

External state for cross-session continuity (Lesson 5). The agent's memory is wiped between
sessions; this file is not. Update it at the end of every session (Lesson 12).

## Current State

- **Last updated:** 2026-08-20
- **Active feature:** none
- **Baseline (`./init.sh`):** green — `demo.sh` 48/48 steps

## Done

- [x] feat-shared-memory-promote/gate/resources/v1 — `memory/shared/` v1, checked and approved
- [x] feat-windows-native-loop — Node-native loop/dispatch control plane; HI-045 resolved
- [x] HI-046, HI-052, HI-053, HI-054, HI-055 — resolved this session (see harness-issues.jsonl)
- [x] `docs/constraints.md` — 2 new MUST rules: terse progress.md/DECISIONS.md, prefer existing tools over ad-hoc scripts
- [x] Every writing-agent prompt: uniform end-of-run Yes/No reflection gate
- [x] `memory-consolidate.mjs --bootstrap`, `memory-promote.mjs` — recurring-fact detection and promotion
- [x] Design locked: `docs/design/shared-memory-tier.md` v1 (`loop/design-approval.json`)
- [x] Upgraded root and `examples/jdt-mcp-server` to today's canonical scripts

## Next

1. v2 of `docs/design/shared-memory-tier.md` (agent-judged free-text matching) — blocked on closing `docs/cross-cutting.md` row X-001 (proposals/ retention).
2. Flat-append mode for `MEMORY.md` — not started.

## Known Issues / Risks

- [ ] [issue — impact — mitigation]

## Notes for Next Session

Checker caught a real defect this session: the 4 `feat-shared-memory-*` verification commands
grepped a demo.sh STEP HEADER, which prints regardless of pass/fail — mutation-tested, fixed to
check demo.sh's own exit code instead. Worth remembering when writing any future
`grep -q "..."`-on-demo.sh verification: grep the assertion result, not the step title.
