# `LspClient` chưa định tuyến notification: component nhận đẩy phải tự khai báo cổng

**Khi nào áp dụng:** lượt maker xây một component tiêu thụ thông điệp JDT LS đẩy về —
`textDocument/publishDiagnostics`, `language/status`, `language/actionableNotification` — và định
"nối dây thật" bằng cách gọi một API sẵn có của `src/lsp/lsp-client.ts`.

## Sự thật dễ hiểu nhầm

`LspClient` chỉ có `onRequest(method, handler)`, và `#handleMessage` chỉ gọi handler đó khi thông
điệp **mang `id`**. Notification của LSP không mang `id`, nên nhánh đó không bao giờ chạy; nhánh còn
lại yêu cầu `typeof message.id === "number"` rồi `return` — notification bị bỏ rơi im lặng. Đăng ký
`onRequest("textDocument/publishDiagnostics", ...)` biên dịch được, chạy được, và không bao giờ nổ.
Chiều gửi cũng thiếu: không có `notify()`, và `#write` là private.

## Cách làm đúng, đã có tiền lệ được checker phán

Khai báo một cổng hẹp trong tệp của chính component, không sửa `src/lsp/lsp-client.ts`:
`file-sync-watcher` dùng `LspNotificationSink { notify(method, params) }` cho chiều gửi;
`diagnostics-cache` dùng `LspNotificationSource { onNotification(method, handler) }` cho chiều nhận.
Checker đã ghi thẳng trong `checkerNotes` của `feat-file-sync-watcher`: cổng là lựa chọn đúng ranh
giới, còn *sửa `src/lsp/lsp-client.ts` mới là scope bleed*, vì `context.touches` không liệt kê nó.
Chữ ký phải chọn sao cho `LspClient` tự động tương thích cấu trúc ngay khi nó có phương thức tương
ứng — khi đó daemon nối dây mà không phải sửa lại component nào.

## Hệ quả phải ghi ra, không được im lặng

Cổng làm cho component đúng nhưng **chưa** làm nó nhận được byte thật. Ghi rõ trong `checkerNotes`
rằng phần dispatch còn thiếu thuộc feature của lsp-client, kèm lý do kỹ thuật (thông điệp không
mang `id`). Nếu không ghi, lượt sau sẽ đọc `attach()` như bằng chứng đã nối dây xong.
