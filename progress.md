# Progress Log — Harness

External state for cross-session continuity (Lesson 5). The agent's memory is wiped between
sessions; this file is not. Update it at the end of every session (Lesson 12).

## Current State

- **Last updated:** 2026-09-03  
- **Active feature:** feat-prove-prompt-acp (oracle created)
- **Baseline (`./init.sh`):** green — `demo.sh` 70/70 steps

## In Progress

- **feat-prove-prompt-acp:** Oracle tạo thành công với 6 điều kiện kiểm tra end-to-end proof cho prompt centralization và Claude Code ACP. Status = active, oracle complete, awaiting maker implementation.

## Completed This Session (2026-09-03)

- **feat-prove-prompt-acp oracle:** Tạo tools/oracles/feat-prove-prompt-acp.mjs với 6 điều kiện kiểm tra độc lập: prompts tập trung trong prompts/, không còn legacy prompt trong loop/, gen-agents tạo config đúng, dispatch chọn Claude runtime, không fallback về Kiro, và demo chạy thành công end-to-end.

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

## 2026-09-01 — Checker session: feat-readme-standardize

- **REJECT**: the verification command was wrong — it coupled unrelated project health.
- The README.md claim was **correct** (five headings, Quick start/Extending, sufficient content).
- But verification `verify-harness.mjs && grep` exited 1 because three other blocked features lacked checkerNotes, plus a circular dependency (this feature had an incomplete reviewPacket).
- Record a new memory entry: `verification-command-must-be-scoped.md` — this class has not appeared before.
- The maker must fix the verification command to inspect README.md only, independent of whole-repository state. README.md does not need a change (it is already correct).
