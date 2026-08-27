# Cổng hẹp khai tại chỗ là ranh giới đúng, nhưng nợ nối dây tích luỹ mà không ai sở hữu

**Khi nào áp dụng:** maker cần một component khác cung cấp một khả năng chưa tồn tại, và thay vì sửa
component đó (scope bleed), anh ta khai một interface hẹp trong tệp của chính mình rồi nói "daemon
sẽ nối dây sau". Gặp ở `feat-file-sync-watcher` (`LspNotificationSink`) và lặp lại ở
`feat-diagnostics-cache` (`LspNotificationSource`), 2026-08-22.

## Vì sao từng lần phê duyệt riêng lẻ đều đúng

Ranh giới đó thật sự đúng. `context.touches` chỉ liệt kê tệp của component; sửa `src/lsp/lsp-client.ts`
trong một lượt maker của watcher hay của cache mới là scope bleed. Cổng hẹp đúng một phương thức,
tương thích cấu trúc, không ai phải sửa gì ngay. Tôi đã phê duyệt lần một và phê duyệt lần hai, cả
hai lần đều đúng theo tiêu chí của chính tính năng đó.

## Điều không lần nào lộ ra khi chỉ nhìn một tính năng

Đến lần thứ hai, đếm lại thì có hai cổng đã khai và **không** cổng nào có đầu nối:

- `LspClient` bỏ mọi notification. `#handleMessage` chỉ định tuyến request server→client (có method
  và id), rồi `if (typeof message.id !== "number") return;` làm rơi phần còn lại.
- `feat-lsp-client` đã ở trạng thái `done`, và behavior của nó chỉ nói về khung Content-Length và
  tương quan id — nó sẽ không quay lại.
- Không tính năng nào trong `feature_list.json` sở hữu việc thêm dispatch notification.
- `feat-prove-diagnostics` đang `blocked` với lý do ghi thẳng là cần "real publishDiagnostics
  delivery" — tức lớp chứng minh tích hợp đã đâm vào đúng khoảng trống này rồi.

Hệ quả: hai component đã `done`, oracle cấp 1 của chúng xanh, mà đường dữ liệu thật thì chưa bao giờ
tồn tại. Không lượt kiểm tra nào của một tính năng đơn lẻ phát hiện được, vì mỗi tính năng đều đúng
trong phạm vi của nó.

## Việc checker phải làm

Khi thấy một cổng khai tại chỗ với lời hứa "nối dây sau", đừng dừng ở việc xác nhận ranh giới đúng.
Làm thêm ba bước, tốn khoảng hai phút:

1. Đọc component ở đầu kia và xác nhận khả năng đó **thật sự** chưa có (đừng tin lời khai). Ở đây là
   `#handleMessage` bỏ message không có id — đúng như maker mô tả.
2. Tìm trong `feature_list.json` xem tính năng nào sở hữu phần nối dây. Nếu component đầu kia đã
   `done`, nó sẽ không tự quay lại.
3. Nếu không ai sở hữu, ghi `FOLLOW-UP:` ở **dòng đầu** `checkerNotes` để router chuyển cho planner.
   Đếm luôn số cổng đang treo — con số là thứ biến một cảm giác thành một việc có phạm vi.

Vẫn APPROVE tính năng. Sai lầm cần tránh là phê duyệt mà im lặng: ranh giới đúng vẫn để lại nợ, và
nợ không được nêu tên thì không ai trả.
