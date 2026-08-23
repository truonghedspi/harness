# Progress Log — Harness

External state for cross-session continuity (Lesson 5). The agent's memory is wiped between
sessions; this file is not. Update it at the end of every session (Lesson 12).

## Current State

- **Last updated:** 2026-08-23
- **Active feature:** none
- **Baseline (`./init.sh`):** green — `demo.sh` 51/51 steps

## Done

- [x] HI-061 — digest-bound maker `reviewPacket`, pre-checker admission, actionable typed `checkerVerdict`; incomplete submissions spend no checker attempt
- [x] `approval-gate.mjs` — best-effort OS notification (macOS/Linux/Windows) when a fresh approval request is written; `HARNESS_NOTIFY=0`/`HARNESS_NOTIFY_CMD` overrides
- [x] feat-shared-memory-promote/gate/resources/v1 — `memory/shared/` v1, checked and approved
- [x] feat-windows-native-loop — Node-native loop/dispatch control plane; HI-045 resolved
- [x] HI-046, HI-052, HI-053, HI-054, HI-055 — resolved (see harness-issues.jsonl)
- [x] `docs/constraints.md` — 2 new MUST rules: terse progress.md/DECISIONS.md, prefer existing tools over ad-hoc scripts
- [x] Every writing-agent prompt: uniform end-of-run Yes/No reflection gate
- [x] `memory-consolidate.mjs --bootstrap`, `memory-promote.mjs` — recurring-fact detection and promotion
- [x] Design locked: `docs/design/shared-memory-tier.md` v1 (`loop/design-approval.json`)
- [x] Upgraded root and `examples/jdt-mcp-server` to today's canonical scripts (twice — see note below)

## Next

1. v2 of `docs/design/shared-memory-tier.md` (agent-judged free-text matching) — blocked on closing `docs/cross-cutting.md` row X-001 (proposals/ retention).
2. Flat-append mode for `MEMORY.md` — not started.

## Known Issues / Risks

- [ ] [issue — impact — mitigation]

## Notes for Next Session

- Bad `demo.sh` verification pattern: `grep -q "<step title>"` matches the step header regardless
  of pass/fail. Grep the assertion result or check exit code instead. (Caught by checker,
  mutation-tested, fixed on `feat-shared-memory-*`.)
- Never `cp` a `templates/tree/loop|prompts/*` file straight into `examples/jdt-mcp-server` — it
  clobbers contained-layout wording. Always `upgrade-harness.mjs --target examples/jdt-mcp-server`.
- New `verify-harness.mjs` gate `state-log-prose`: flags ≥3 consecutive non-bulleted lines in
  `progress.md`/`DECISIONS.md` (warn only). This section previously tripped it — now fixed.
