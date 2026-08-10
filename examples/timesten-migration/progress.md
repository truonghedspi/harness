# Progress Log

> Append a dated entry per session. Newest first. This file plus feature_list.json is the
> complete session-to-session memory — write for an agent with zero conversation history.

## 2026-07-31 — harness-loop skill: added create → verify → improve lifecycle

**Đã làm:**
- Viết 4 script mới trong `harness-loop/scripts/`: `verify-harness.mjs` (verify động, 6 gate:
  structure/placeholders/baseline/features/loop/clean-state, phân loại mỗi finding
  `layer: project|harness`), `harness-issue.mjs` (event log JSONL cho lỗi layer=harness, fold
  thành trạng thái, phát hiện regression), `improve-harness.mjs` (xếp hạng issue, sinh
  `harness-improvements.md` + prompt agent, `--reverify --auto-resolve` chỉ đóng issue khi hết
  tái hiện), `harness-loop.sh` (meta loop verify→dispatch→verify lại, dừng khi 2 vòng liền không
  tiến triển).
- Sửa `harness-loop/templates/tree/init.sh`: nhánh không nhận diện được stack đổi từ exit 0 sang
  exit 1 (một cổng không thể đỏ thì không phải cổng); Maven/Gradle ưu tiên `./mvnw`/`./gradlew`
  trước bare `mvn`/`gradle`.
- Thêm agent `harness-improver` (`.kiro/agents/harness-improver.json` +
  `harness-loop/prompts/harness-improver.md`): sửa template/script, không vá riêng 1 target; một
  issue mỗi vòng; đóng issue bằng `--reverify`, không bằng lời khai.
- Viết `harness-loop/scripts/demo.sh` — chứng minh cả 14 hành vi của lifecycle bằng một lệnh
  (chạy trên target dùng-một-lần, log issue cô lập qua `HARNESS_ISSUE_LOG`): create, idempotent,
  verify tĩnh vs động, bắt lỗi harness thật (bare mvn khi có wrapper), ghi issue, xếp hạng, sinh
  prompt, sửa+đóng issue bằng reverify, phát hiện regression, replay evidence bắt done giả, và
  meta loop tự dừng khi không tiến triển (test bằng stub `kiro-cli`). Kết quả: **ALL DEMO STEPS
  PASSED**.
- 2 lỗi harness thật được tìm thấy khi dogfeed và đã sửa ngay trong phiên, ghi vào
  `harness-loop/harness-issues.jsonl`: HI-001 (`init.sh` exit 0 mà không chạy build/test nào —
  "vacuous green"), HI-002 (`verify-harness.mjs` tự nó gắn nhầm `layer=harness` cho trường hợp
  target hoàn toàn chưa có manifest — trùng lặp với gate structure L2 vốn đã gắn đúng
  `layer=project`).

**Khó khăn:**
- Phát hiện tautology: tín hiệu "No recognized manifest" trong `gateBaseline` chỉ có thể xảy ra
  khi target không có bất kỳ manifest nào trong đúng danh sách `init.sh` kiểm tra — nên nó
  **không bao giờ** có thể là lỗi harness thật theo thiết kế hiện tại (đã thêm `hasAnyManifest()`
  để tránh gắn nhầm layer, xem HI-002). Vì vậy demo mục "bắt lỗi harness" phải chuyển từ kịch bản
  "no manifest" sang kịch bản "bare mvn khi có wrapper" mới bắt được thật.
- `harness-issue.mjs`/`improve-harness.mjs` mặc định ghi vào `harness-loop/harness-issues.jsonl`
  dùng chung cho mọi lần chạy — phải thêm biến môi trường `HARNESS_ISSUE_LOG` để `demo.sh` không
  làm bẩn log thật bằng dữ liệu giả lập (mechanism test cho regression).
- Không thể demo nhánh "dừng do hết ngân sách lặp mà không tiến triển" bằng `kiro-cli` thật vì
  chưa có `KIRO_API_KEY`; đã dùng stub `kiro-cli` trên PATH (in ra rồi exit 0, không sửa gì) để
  kiểm thử logic điều phối bash một cách trung thực mà không cần agent thật.

**Đề xuất thay đổi:**
- `harness-issue.mjs` dedupe theo `gate/id` — hai nguyên nhân harness khác nhau nhưng cùng rơi
  vào id chung (ví dụ `baseline/init-red` dùng chung cho cả "thiếu mvnw" và "thiếu gradlew") sẽ bị
  gộp làm một issue. Chưa ảnh hưởng ở quy mô hiện tại; nếu số lượng issue tăng, nên đổi signature
  sang `gate/id/hash(symptom rút gọn)`.
- Gate "vacuous green" hiện chỉ bắt được nhánh `else` (không manifest nào). Một project có
  manifest thật (ví dụ `package.json`) nhưng không định nghĩa `test`/`build`/`check` script nào
  cũng "xanh" mà không verify gì — hiện chưa bị bắt. Để lại làm cải tiến sau, không thuộc phạm vi
  2 lỗi ban đầu.
- Tiếp theo: áp toàn bộ lifecycle này lên `aeron-demo` (xem plan
  `swirling-discovering-quasar.md`), lần này với người dùng thật thay vì stub.

## 2026-07-19 — Harness bootstrapped

- State: harness scaffolded; no inventory extracted yet; no service code yet.
- Next action: feat-001 — fill `inventory/sources.yaml` (reference DSN, app repos), run
  `tools/extract-inventory.sql`, build the transform to `inventory/inventory.json`.
- Blockers: reference TimesTen instance connection details needed from a human.
