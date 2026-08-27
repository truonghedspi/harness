# Sự kiện `fs.watch` không phải bằng chứng rằng tệp đã đổi — chỉ bản diff mới là

**Khi nào áp dụng:** bất cứ thành phần nào theo dõi filesystem bằng `node:fs.watch` rồi dịch sự
kiện thành một hành động có thể quan sát (thông báo LSP, xoá cache, kích hoạt làm mới). Gặp lần đầu
ở `feat-file-sync-watcher`.

## Điều gì trông như lỗi mã nguồn nhưng thật ra là môi trường

Trên macOS, `fs.watch(..., { recursive: true })` phát lại sự kiện cho những lần ghi xảy ra **ngay
trước** khi `watch()` được cài. Nguyên nhân là độ trễ gom nhóm của FSEvents, không phải lỗi của
Node. Hệ quả cụ thể đã đo được: fixture ghi `pom.xml` và `Greeter.java`, rồi mới gọi `start()`; hai
sự kiện cho hai tệp đó vẫn tới sau đó vài mili giây.

Bản triển khai đầu tiên tin vào đường dẫn mà sự kiện nêu tên — "có mặt ở cả hai phía ⇒ Changed" —
nên phát một thông báo `pom.xml` giả sau một lần sửa chỉ chạm mã nguồn. Trong hệ này, mỗi thông báo
`pom.xml` kéo theo một lần làm mới project-model của JDT LS, tức là một lần re-import thừa ở mỗi
lần khởi động workspace.

## Cách làm đúng

1. Coi sự kiện chỉ là tín hiệu "có gì đó động đậy", đủ để lên lịch một lần flush. Không đọc loại
   thay đổi từ `eventType`: `fs.watch` báo `rename` cho cả tạo, xoá và **hai nửa** của một lần đổi
   tên, và gộp sự kiện tuỳ ý (một lần xoá thư mục có thể chỉ báo đúng thư mục đó).
2. Quyết định loại thay đổi bằng cách so một lần quét mới với ảnh chụp lần settle trước: vắng → có
   là Created, có → vắng là Deleted, khác `(mtimeMs, size, ino)` là Changed.
3. So sánh có `ino` là điểm khiến pattern ghi-tạm-rồi-đổi-tên (cách hầu hết editor và agent ghi
   tệp) hiện ra: tệp đích giữ nguyên đường dẫn nhưng nhận inode của tệp tạm, nên bản diff bắt được
   kể cả khi kích thước không đổi.
4. Đừng bù bằng cách phát thông báo thừa cho chắc. Ở đây thông báo thừa không vô hại — nó là một
   lần re-import project-model.

## Cách phát hiện

Trường hợp bắt được lỗi này không phải là "watcher có báo thay đổi không", mà là hai khẳng định
phủ định: **một lần sửa chỉ chạm mã nguồn không được sinh ra bất kỳ lần làm mới `pom.xml` nào**, và
**danh sách tệp được nêu tên phải đúng bằng một phần tử**. Trường hợp khẳng định dương tính vẫn xanh
với bản triển khai sai.
