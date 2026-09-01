# Progress Log — Harness

External state for cross-session continuity (Lesson 5). The agent's memory is wiped between
sessions; this file is not. Update it at the end of every session (Lesson 12).

## Current State

- **Last updated:** 2026-09-01  
- **Active feature:** none (checker completed final acceptance)
- **Baseline (`./init.sh`):** green — `demo.sh` 70/70 steps

## In Progress

*No active features — checker completed final acceptance.*

## Completed This Session (2026-09-01)

- **feat-readme-standardize: ACCEPTED** — README.md chuẩn hóa thành cấu trúc 5 mục rõ ràng với nội dung đầy đủ cho người dùng mới. Verification command đã được sửa để kiểm tra độc lập, không phụ thuộc vào trạng thái repo khác. Evidence đầy đủ red→green. Status = done.

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

- **REJECT**: verification command không đúng — coupling unrelated project health.
- README.md claim thực tế **đúng** (5 headings, có Quick start/Extending, nội dung đủ).
- Nhưng verification `verify-harness.mjs && grep` exit 1 vì 3 feature khác blocked không có checkerNotes + circular dependency (feature này có incomplete reviewPacket).
- Ghi memory entry mới: `verification-command-must-be-scoped.md` — class này chưa từng xuất hiện.
- Maker cần: sửa verification command chỉ xét README.md, không phụ thuộc trạng thái toàn repo. Không cần sửa README.md (đã đúng).

