# Cửa sổ khởi động FSEvents nuốt lần ghi đầu tiên — và biểu hiện là im lặng, không phải sai

**Khi nào áp dụng:** mọi trường hợp kiểm thử điều khiển một thư mục tạm thật qua
`fs.watch(dir, { recursive: true })` trên macOS. Gặp ở `feat-file-sync-watcher`, lượt 2, khi thêm
bốn ca mới làm lộ ra lỗi vốn đã nằm sẵn trong tám ca cũ.

## Điều trông như lỗi mã nguồn nhưng thật ra là môi trường

libuv khởi động luồng FSEvents trên một thread khác, **sau** khi `fs.watch()` đã trả về. Lần ghi
rơi vào khoảng giữa hai mốc đó không được chuyển tới muộn — nó không bao giờ được chuyển tới. Vì
watcher chỉ flush khi có sự kiện đánh thức, hậu quả không phải một thông báo sai mà là im lặng
tuyệt đối: trường hợp treo hết ngân sách chờ rồi báo timeout, đúng dạng thất bại mà người đọc dễ
quy cho bản triển khai.

Số đo cụ thể trước khi sửa: 2 trên 4 lần chạy `npm run test:integration` đỏ. Chạy riêng một tệp
spec thì 12 trên 12 lần xanh — cửa sổ chỉ đủ rộng khi máy đang tải, mà `--test` chạy song song mọi
tệp spec. Nạn nhân là **trường hợp nào ghi trước tiên**, không cố định, nên hai lần liên tiếp đổ vào
hai ca khác nhau. Đó là dấu hiệu nhận dạng: nếu mỗi lần đỏ lại là một ca khác và luôn ở lần chờ đầu
tiên của ca đó, hãy nghi cửa sổ khởi động trước khi nghi phần diff.

## Cách sửa, nằm trọn trong tệp spec

1. Ghi một tệp mồi mà watcher bỏ qua **theo cấu trúc** — ở đây `.fs-watch-probe`, không phải
   `*.java`, không phải `pom.xml` — nên nó không thể xuất hiện trong bất kỳ thông báo nào. Nó chỉ
   dùng để đánh thức luồng sự kiện.
2. Chỉ hích khi `watcher.lastChangeAt` còn `undefined`, tức chỉ bên trong cửa sổ khởi động. Khi một
   sự kiện bất kỳ đã được chuyển tới, luồng đã sống và cú hích chỉ còn làm nhiễu thời điểm.
3. Cú hích không thể che một thông báo thiếu: đánh thức watcher khiến nó quét lại và so toàn bộ cây
   được theo dõi, nên thay đổi mà bản triển khai vốn không báo thì vẫn không được báo. Đây là lý do
   cách sửa này không làm yếu oracle — đã kiểm chứng bằng cách dựng lại cả chín mutant sau khi sửa,
   tất cả vẫn chết.
4. Ca nào cần ảnh nền chính xác thì đặt toàn bộ phần chuẩn bị **trước** `start()`, để lần quét khởi
   động chốt ảnh nền, thay vì để một flush chạy đua với thao tác chuẩn bị.

## Đường ranh cần giữ

Nếu muốn chính bản triển khai đóng cửa sổ này (quét lại một lần ngắn sau `start()`) thì đó là thay
đổi `src/`, phải đi thành tính năng riêng. Trong một lượt sửa oracle mà checker đã xác nhận bản
triển khai đúng, sửa `src/` là cách nhanh nhất để bị từ chối lần nữa.
