# AGENTS.md — harness assets

Router cho mọi agent (Lesson 4). Chi tiết trong `docs/`, nạp khi cần.
Mục lục: [`docs/INDEX.md`](docs/INDEX.md).

## Bản chất kép

Repo này vừa là **skill source** vừa là **dogfood target**.

| Vai trò | Đường dẫn |
|---|---|
| Skill source | `harness-loop/` — `templates/tree/` (scaffold), `scripts/` (công cụ), `references/` (tài liệu), `upgrade-context.json` |
| Dogfood target | root `tools/`, `loop/`, `prompts/`, `feature_list.json`, `progress.md`, `docs/` — harness thật chạy trên chính repo |
| Sinh từ manifest | `.kiro/`, `.claude/`, `.codex/` — từ `agents.manifest.json` qua `tools/gen-agents.mjs`, không sửa tay |

**Sản phẩm là `harness-loop/`.** Chứng minh thay đổi hoạt động: `bash harness-loop/scripts/demo.sh`.

## 6 bất biến

1. **Không tự chọn task** — `node loop/route.mjs` đặt tên node tiếp theo.
2. **WIP = 1.** Một feature active. Xong hoặc block trước khi chạm feature khác.
3. **Worker không tự chấm điểm.** Chỉ checker đặt `status: done`.
4. **Không tuyên bố mà không chạy thật.** Dán output lệnh thật.
5. **Đổi workflow → cập nhật `harness-loop/references/graph.md` cùng commit** (gate: `graph-stale`).
6. **Escalate thay vì đoán.** Câu hỏi chưa trả lời là bàn giao, không phải giả định.

## Nếu bạn đang nói chuyện với người dùng

Hành xử như `orchestrator` (`prompts/orchestrator.md`) trừ khi được dispatch vai trò cụ thể.
**Nhìn trước khi nói** — `node tools/loop-status.mjs`, rồi `node loop/route.mjs`. Không mô tả
trạng thái từ trí nhớ. Bạn không chọn node; router chọn.

## Startup Readiness

Cả 4 phải đạt (Lesson 6). Thất bại → sửa nó *chính là* task.

1. **Khởi động được** — baseline gate xanh. 2. **Kiểm tra được** — ít nhất một verification pass/fail.
3. **Thấy tiến độ** — `feature_list.json` và `progress.md` đồng bộ.
4. **Biết bước tiếp** — hành động tiếp theo đã ghi lại.

## Startup Workflow (start of session — clock in)

1. `pwd` — xác nhận thư mục gốc.
2. Đọc file này, rồi `docs/architecture.md`.
3. Chạy baseline: `node init.mjs` (hoặc `./init.sh`). **Đỏ → sửa trước khi thêm scope.**
4. Đọc `feature_list.json` và `progress.md`. `git log --oneline -5`.
5. `node harness-loop/scripts/harness-issue.mjs list` — lỗi đang mở.

## Ai chạy tiếp theo

**`node loop/route.mjs` quyết định.** `node loop/run-loop.mjs` dispatch.
`node loop/route.mjs --rules` — bảng routing. `node tools/timeline.mjs` — tiến độ 7 ngày.
`node tools/feature.mjs <id>` — entry đầy đủ; `--deps`, `--ready`, `--status`.

| Agent | Chạy khi | Sở hữu |
|---|---|---|
| `orchestrator` | người dùng mở phiên không chỉ định agent | điều phối loop, spawn sub-agent router chỉ định; không ghi file sản phẩm |
| agent hiện tại + `human-interview` | cần sự kiện/quyết định chỉ người dùng trả lời | thu thập — hỏi không bỏ ngữ cảnh; ghi nhận kết quả |
| `design-facilitator` | `checkerNotes` bắt đầu `NEEDS DESIGN:` | thiết kế — thành phần, bất biến, phương án. Phê duyệt thuộc người dùng (`loop/design-approval.json`) |
| `feature-planner` | `checkerNotes` bắt đầu `NEEDS RE-PLAN:` | phân rã — cắt lại `feature_list.json` |
| `test-designer` → `test-implementer` | chưa có `falsifier` hoặc oracle chưa viết | oracle — **không đọc implementation** |
| `maker` | feature đủ điều kiện | triển khai. **Không thể đặt `done`** |
| `checker` | mọi feature open không block đều `readyForCheck` | chấp nhận cuối cùng — **agent duy nhất đặt `done`** |
| `harness-setup` | môi trường chưa sẵn sàng | toolchain và baseline |
| `harness-improver` | `verify-harness` báo finding `layer: harness` | sửa skill source, không sửa target |

Hai node code: `tools/verify-harness.mjs` (replay chứng cứ) và `loop/approval-gate.mjs` (phán xét người dùng).

Ba agent không nằm trong routing — chạy trước/xung quanh loop: `orchestrator`, `harness-setup`,
`harness-onboarder` (một lần mỗi codebase có sẵn).

## Working Rules

- **Sửa template, không sửa target.** Lỗi thuộc `templates/tree/**` hoặc `scripts/*.mjs`.
- **Mỗi thay đổi hành vi có bước `demo.sh` thất bại nếu thiếu nó.**
- **Mỗi thay đổi upgrade-relevant cập nhật `upgrade-context.json`.** Gate: `check-upgrade-context.mjs`.
- **Ghi nhận lỗi trước khi sửa:** `harness-issue.mjs add` → sửa → `improve-harness.mjs --reverify`.
- **Gate mới phải hiệu chuẩn trên target thật trước khi ship.**
- **Mỗi tài liệu ≤300 dòng**, có trong index. `SKILL.md` là router, chi tiết vào `references/`.

## How you write

Dòng đầu là kết luận/quyết định/phát hiện, dưới 200 ký tự. Dòng trống. Rồi phần hỗ trợ.
Nói một lần. Tuyến tính. Bold chỉ điều thay đổi hành động. Brief and concise.
[Hướng dẫn trình bày](docs/reference/presenting-and-proposing.md) cho báo cáo quan trọng.

## Verification Commands

```bash
bash harness-loop/scripts/demo.sh          # gate thật — mọi feature, đầu-cuối
node harness-loop/scripts/check-coverage.mjs --target <project scaffold>
node harness-loop/scripts/verify-harness.mjs --target <project scaffold> --run-features
```

Baseline đầy đủ: `node init.mjs`. Từng feature: trường `verification`.
Testing hierarchy: [testing standards](docs/testing-standards.md). Bản đồ: [architecture](docs/architecture.md).

## Definition of Done (mỗi thay đổi skill)

- [ ] Hành vi trong `templates/tree/**` hoặc `scripts/**`, không chỉ trong target
- [ ] Bước `demo.sh` bao phủ, thất bại khi revert
- [ ] `bash harness-loop/scripts/demo.sh` xanh
- [ ] Gate mới hiệu chuẩn trên repo thật
- [ ] Workflow đổi → `references/graph.md` + `references/workflow-diagram.md` cập nhật
- [ ] Tài liệu: `SKILL.md` (liên kết + một dòng), `references/*.md` liên quan
- [ ] Lỗi sửa → resolved trong `harness-issues.jsonl` kèm ghi chú xác nhận

## End of Session (clock out — leave clean state)

1. `demo.sh` xanh. 2. Tài liệu và `harness-issues.jsonl` cập nhật.
3. Commit nêu phát hiện, không chỉ thay đổi. 4. Dở dang → `session-handoff.md`.
5. Không artifact cũ (debug log, `TODO(me)`, file tạm).

## Escalation (human checkpoints — không tự động)

Ghi `session-handoff.md` và dừng: quyết định kiến trúc `docs/` không trả lời · cùng lỗi baseline
hai lần cùng nguyên nhân · hành động không đảo ngược / chạm production · thay đổi nội dung scaffold
mặc định · đề xuất giảm gate · finding không phân loại được `layer: project` hay `layer: harness`.

## Map

**[`docs/INDEX.md`](docs/INDEX.md)** — mỗi tài liệu kèm "đọc khi nào".
4 hay nhắc: `docs/assumptions.md` · `docs/constraints.md` · `feature_list.json` · `docs/reference/graph.md`.

Skill source: `harness-loop/SKILL.md` (bắt đầu từ đây) · `harness-loop/references/graph.md`
(routing) · `harness-loop/templates/tree/` (sửa lỗi ở đây) · `harness-loop/scripts/` (công cụ) ·
`harness-loop/harness-issues.jsonl` (lỗi đã biết).
