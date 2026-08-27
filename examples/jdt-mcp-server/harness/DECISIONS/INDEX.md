# Kho lưu trữ quyết định — mục lục

Các kỳ đã đóng của `harness/DECISIONS.md`, tách ra theo Pattern B trong
`harness/docs/reference/knowledge-layout.md`. Đọc mục lục trước, rồi mở đúng một tệp; không đọc
kho lưu trữ từ đầu đến cuối.

| Kỳ | Quyết định trong tệp | Mở khi |
|---|---|---|
| [2026-08-19](2026-08-19.md) | Chọn daemon Node/TypeScript + shim stdio qua Unix socket, từ chối Option B (Java/LSP4J) và Option C (chỉ Streamable HTTP); hoãn Gradle, v1 chỉ hỗ trợ Maven | Có người đề xuất lại trục transport, đổi ngôn ngữ triển khai, hoặc hỏi vì sao workspace identity gắn với `pom.xml` |
| [2026-08-20](2026-08-20.md) | Lần cắt tính năng đầu tiên (32 tính năng, 10 thành phần); thứ tự build mã hoá thành cạnh DAG thật; falsifier của `feat-lsp-client` trích `INV-POOL-3` thay vì tạo `INV-LSP-*`; hoãn Streamable HTTP (X-010), GC thư mục `-data` (X-006) và retry sau crash (X-009) | Có người hỏi vì sao một thành phần được cắt thành cặp build/prove, vì sao tính năng tool phụ thuộc tính năng prove của giai đoạn trước, hoặc vì sao HTTP front door và GC chưa có tính năng nào |
| [2026-08-21](2026-08-21.md) | Năm quyết định cùng một dạng: nới `feat-prove-routing` và `feat-jdtls-provisioner` sẵn có (thêm `TCON-ROUTE-0005/0006/0007`, nhánh reactor lồng nhau, đường dẫn module, đường thành công của provisioner) thay vì cắt tính năng mới | Có người định cắt một tính năng riêng cho một khoảng trống dùng chung seam, tệp oracle và invariant với một tính năng `prove` đã có |
| [2026-08-22](2026-08-22.md) | Timeout thiếu ở hai spec tích hợp (đo được rằng timeout vô hiệu với ca đồng bộ) — chỉ ghi chú; ba việc tồn đọng từ `feat-workspace-pool` xử lý ở ba mức: quyền sửa có giới hạn, tính năng prove mới `feat-prove-workspace-identity`, và gỡ chặn `feat-prove-pool-crash-handling` | Có người hỏi vì sao một ca `node --test` đồng bộ không được timeout bảo vệ, vì sao identity được cắt thành tính năng riêng, hoặc vì sao một tính năng `blocked` được đưa về `not-started` |
| [2026-08-23](2026-08-23.md) | Bốn quyết định dạng FOLLOW-UP: DISCARD phần sửa oracle `lsof` của TCON-SHIM-0002 và ghi điều kiện môi trường vào docs; listener `error` sót lại của `probeDaemon` — sửa câu chú thích sai thay vì cắt tính năng; hàm gỡ đăng ký bị `DiagnosticsCache.attach()` vứt bỏ — ràng buộc vòng đời attach thay vì cắt tính năng; định tuyến notification của `LspClient` cắt thành `feat-lsp-notifications` | Có người hỏi vì sao một FOLLOW-UP của checker lại kết thúc bằng DISCARD hoặc bằng một câu chú thích, hoặc vì sao việc nối dây notification thành tính năng riêng thay vì để `feat-tool-layer-core` nuốt |
