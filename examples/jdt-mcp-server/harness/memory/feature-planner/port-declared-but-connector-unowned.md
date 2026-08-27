# Một cổng được khai báo không có nghĩa là đã có ai sở hữu đầu nối

**Bối cảnh.** 2026-08-23, xử lý FOLLOW-UP của `feat-diagnostics-cache`. Hai tính năng `build` khác
nhau (`feat-file-sync-watcher`, `feat-diagnostics-cache`) đều được checker APPROVE với lập luận
giống hệt nhau: component khai một cổng hẹp trong tệp của chính nó
(`LspNotificationSink`, `LspNotificationSource`) thay vì sửa `src/lsp/lsp-client.ts`, vì
`context.touches` không liệt kê tệp đó nên sửa nó mới là scope bleed. Lập luận ấy đúng. Nhưng sau
hai lượt APPROVE, không tính năng nào trong đồ thị sở hữu đầu bên kia: `LspClient` không có
`notify()` lẫn `onNotification()`, và `#handleMessage` bỏ im lặng mọi thông điệp không mang id.

**Lỗi thuộc về lần cắt đầu tiên.** `feat-lsp-client` được cắt theo bảng thành phần trong
`docs/design/architecture.md`, ở đó dòng của `lsp-client` chỉ viết "Content-Length framing, id
correlation, server→client requests". Danh sách ấy bỏ sót notification, nên tính năng cũng bỏ sót,
rồi đi tới `done` với bằng chứng đầy đủ cho đúng phần nó tuyên bố. Không có tín hiệu đỏ nào: mọi
tính năng liên quan đều xanh, chỉ có hai `prove` ở xa nằm `blocked` với lý do nghe như bình thường.

**Dấu hiệu nhận biết lần sau.** Mỗi khi một tính năng `build` thoả một hợp đồng bằng cách khai một
`interface` cổng trong tệp của chính nó, hãy tìm ngay tính năng sở hữu lớp triển khai cổng đó. Nếu
không tìm ra, đó là scope chưa có chủ, không phải chi tiết triển khai sẽ tự xuất hiện. Cạnh phụ
thuộc phải đi từ tính năng `prove` chạy qua đường dây thật tới tính năng mới, chứ không thêm ngược
vào tính năng `build` đã `done` — hành vi của tính năng đã `done` được chứng minh đối với cổng, và
cạnh ngược chỉ làm bẩn DAG mà không thêm khẳng định kiểm chứng được nào.

**Cách kiểm nhanh.** Grep tên `interface` cổng trên toàn bộ `src/`: nếu chỉ có đúng một tệp nhắc
tới nó, cổng đang treo.
