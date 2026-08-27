# `{ timeout: N }` khai trên ca kiểm thử không che móc `t.after`

**Khi nào áp dụng:** mọi tính năng có tài nguyên phải đóng lại trong móc dọn dẹp — server, socket,
tiến trình con, watcher — và spec dọn dẹp bằng `t.after(async () => ...)`. Gặp lần đầu ở
`feat-daemon-supervisor` (2026-08-22).

## Điều trông như đã có ràng buộc thời gian

Cả bốn ca của spec đều khai `{ timeout: 15_000 }`. Bước 5 của checker-prompt đọc lướt qua sẽ tính là
đạt: có con số, có giới hạn, có vẻ không thể treo.

Phép đo nói khác. Dưới mutant "shutdown không destroy các connection đã accept", bộ chạy đi được 60
giây mà mới chỉ báo xong ca 1; lần đo trước đó tôi để nó chạy hơn 8 phút cũng không có gì thêm. Thân
hàm của ca 2 đã chạy xong hết khẳng định; thứ treo là `t.after` gọi `handle.shutdown()` →
`server.close()`, và `server.close()` không bao giờ gọi callback khi vẫn còn connection mở.

Nguyên nhân: `node --test` áp `timeout` cho **thân hàm ca kiểm thử**, không áp cho móc. Móc có cấu
hình timeout riêng, mặc định không giới hạn. Một `await` không chặn trong `t.after` do đó treo vô hạn
và không sinh ra một dòng lỗi nào.

## Vì sao đây là việc của checker chứ không phải chuyện nhỏ

`npm run test:integration` quét toàn bộ cây spec. Một lần thoái hoá ở nhánh shutdown sẽ nuốt trọn
ngân sách baseline trong im lặng — đúng thứ bước 5 tồn tại để chặn. Và nó chỉ lộ ra dưới mutant, nên
một lượt kiểm tra chỉ chạy bản pristine sẽ không bao giờ thấy.

## Cách kiểm rẻ

Khi dựng mutant cho một component có vòng đời, thêm một mutant **vào đúng đường dọn dẹp** (bỏ
`destroy()`, bỏ `close()`, bỏ `kill()`), rồi chạy với đồng hồ treo tường và một lệnh `pkill` dự
phòng. Nếu bộ chạy không kết thúc trong ngân sách đã khai của ca, móc dọn dẹp là chỗ không có ràng
buộc — bất kể mỗi ca khai timeout bao nhiêu.

Yêu cầu ghi vào `checkerNotes`: móc dọn dẹp phải tự mang ngân sách (`Promise.race` với bộ đếm giờ
làm ca đỏ khi quá hạn), hoặc phải tháo tài nguyên phía client trước khi gọi shutdown. Bằng chứng cần
có là **một ca đỏ trong ngân sách dưới mutant**, không phải một lần chạy xanh.
