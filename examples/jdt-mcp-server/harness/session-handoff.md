# Bàn giao phiên — checker phê duyệt feat-lsp-client ở lần thử 2/4

## Kết luận

`feat-lsp-client` là **done**. Lý do từ chối lần trước đã được đóng: bằng chứng cũ chưa từng đi qua ranh giới tiến trình thật, nay đã có oracle Level 3 spawn tiến trình con riêng biệt.

- Checker chạy lại đúng lệnh `verification` đã ghi, cả hai vế:
  `npm test -- test/lsp/lsp-client.spec.ts` → 4/4 đạt;
  `npm run test:integration -- test/integration/lsp-client-process.integration.spec.ts` → 1/1 đạt;
  lệnh ghép bằng `&&` thoát mã 0. Bằng chứng của maker tái lập chính xác.
- `status` chuyển sang `done`, xoá `readyForCheck`, giữ nguyên khối `evidence`.
  `feature_list.digest.md` đã tạo lại (32 tính năng; `feat-lsp-client` hiển thị **done** (2/4)).
- Phán quyết ghi vết qua `harness/tools/trace.mjs checker verdict feat-lsp-client`.

## Vì sao đây không chỉ là "một bộ test xanh"

Checker không tin báo cáo mutant của maker mà tự dựng lại. Ba bản sao mutant đặt trong `harness/trace/scratch/` (không đụng vào `src/`, xoá sau khi dùng):

- **Mutant A** — bỏ hẳn vòng lặp reject `#pending` trong handler `exit`. Oracle đỏ, thoát mã 1, khoảng 0,1 giây, thông báo `Promise resolution is still pending but the event loop has already resolved`. Đây đúng là bản đỏ mà maker đã ghi.
- **Mutant B** — chỉ reject entry pending đầu tiên. Oracle vẫn đỏ, thoát mã 1. Vậy thiết kế hai request cùng bay chứng minh được mệnh đề "every pending request", không chỉ một request.
- **Mutant C** — `#write` phát `Content-Length` sai thành `byteLength + 1`. Oracle đỏ qua chính timeout của nó tại mốc 10,004 giây.

Mutant C đồng thời trả lời câu hỏi về ngân sách baseline: mốc 10 giây là thật và bài test tự kết thúc, không treo vô hạn. Bốn trường hợp unit đều có timeout 1 giây.

## Ranh giới tiến trình là thật, không phải mock nguỵ trang

Oracle gọi `spawn(process.execPath, [scriptPath])` của `node:child_process` với stdio dạng pipe; kho mã này không có cơ chế chặn module nào. Checker chạy thêm một probe trong scratch với cùng dạng `spawn`: tiến trình con có pid riêng, `ps` nhìn thấy, và bị thu hồi sau `SIGKILL`. Tiến trình con tự phân tích khung `Content-Length` từ byte đi qua pipe thật, nên phần framing thực sự vượt qua ranh giới.

## Chất lượng oracle

- Không tautology (R-T3): giá trị kỳ vọng là hằng trên wire (`ok:quick`, `/JDT LS process exited/`). Trường hợp correlation trong bộ unit khẳng định `["one","two"]` với thứ tự trả về là id 2 rồi id 1, độc lập với cách mã nguồn đánh chỉ mục `#pending`.
- Không viết theo mã (R-T9): triển khai sai mà `falsifier` nêu — bảng correlation để pending treo khi tiến trình chết — chính là mutant A và B, và oracle bắt được cả hai.
- Ổn định: chạy lặp 15/15 lần đều xanh. `SIGKILL` không thể chen vào trước các khẳng định vì `request()` ghi entry pending đồng bộ trước khi ghi xuống stdin.

## Vệ sinh trạng thái

- `src/lsp/lsp-client.ts` lần sửa cuối là commit a9306fb (bản triển khai gốc) và không nằm trong commit 507fa37. Khẳng định "không cần sửa mã nguồn" đứng vững, không có scope bleed.
- Commit 507fa37 chỉ thêm file oracle mới cùng trạng thái harness.
- Phụ thuộc `feat-001` đã `done`.
- `harness/tools/verify-harness.mjs` báo 0 blocker.

## Các luồng còn mở, không đổi trong lượt này

- `feat-workspace-pool` — nay đã đủ điều kiện, vì cả ba phụ thuộc `feat-jdtls-provisioner`, `feat-project-router`, `feat-lsp-client` đều `done`. Đây là mục kế tiếp cho maker.
- `feat-prove-provisioner` — blocked/timebox ở 3/3: bản replay 13 trường hợp vẫn thiếu điều kiện từ chối khi tải về hỏng checksum.
- FOLLOW-UP mutant M12 của `feat-prove-routing` vẫn chờ feature-planner định tuyến thành scope mới, không được nới rộng tại chỗ lần thứ tư.
