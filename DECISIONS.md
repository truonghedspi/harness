# Decisions Log — Harness

The *why* behind choices (Lesson 5). Rationale is the most expensive thing to rebuild across
sessions — record it here so a future session (human or agent) doesn't relitigate settled calls
or repeat a rejected approach.

One entry per decision. Newest first.

---

## 2026-09-03 — Pluggable test toolchain: thiết kế đầy đủ (lựa chọn 1)

- **Decision:** triển khai `test-toolchain.json` (schema `test-toolchain/1`) — file khai báo ở gốc
  dự án, nối scope (unit/component/contract/e2e/snapshot) với lệnh chạy test, timeout, size, và
  điều kiện. Thêm trường `testScope` vào feature. Sửa `init.mjs` đọc toolchain cho baseline.
  Tạo `resolve-test-command.mjs`. Tách `test-design` skill khỏi Java hardcode.
- **Reason:** harness biết PHẢI kiểm tra gì (quality-strategy phân loại scope × size) nhưng không
  biết BẰNG GÌ. Mỗi dự án mới phải sửa tay `init.mjs`. Checker không biết feature cần scope nào.
  `test-design` skill chỉ dùng được với Java. Toolchain là mảnh ghép nối ba khái niệm đã có
  (`testing-standards`, `quality-strategy`, `verification`) thành một luồng liền mạch.
- **Rejected alternative:** (2) chỉ thêm `testScope` không có toolchain — chi phí thấp nhưng agent
  vẫn đoán lệnh, `init.mjs` vẫn hardcode, skill vẫn Java-only. (3) chưa làm — trả giá setup
  tay mỗi dự án mới, thiết kế có thể trôi.
- **Constraint it satisfies:** harness phải scaffold được vào bất kỳ stack nào. Opt-in hoàn toàn:
  không có `test-toolchain.json` thì hành vi không đổi.
- **Affected:** `init.mjs` (+ template), `survey-project.mjs`, `feature_list.json` template,
  `review-contract.mjs`, `check-quality-strategy.mjs`, `test-design/SKILL.md`,
  `testing-standards.md`, `checker.md`, `maker.md`. File mới: `schemas/test-toolchain.schema.json`,
  `tools/resolve-test-command.mjs`, `tools/validate-toolchain.mjs`,
  `references/templates/<framework>/`.
- **Design document:** `docs/design/pluggable-test-toolchain.md`
- **Khảo sát tham khảo:** DeepSeek Harness (`deepseek-harness`) — 7 vitest config per scope,
  gate DAG (`run-gates.ts`), test support packages, `dsh-pre-push-checks` skill.

---

## 2026-08-16 — [Decision title]

- **Decision:** [what was decided]
- **Reason:** [why]
- **Rejected alternative:** [what else was considered, and why not]
- **Constraint it satisfies:** [the requirement/limit driving this]
- **Affected:** [features / files / modules]

---

<!-- Template for new entries:

## YYYY-MM-DD — Title

- **Decision:**
- **Reason:**
- **Rejected alternative:**
- **Constraint it satisfies:**
- **Affected:**
-->
