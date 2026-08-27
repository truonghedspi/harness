# Trên Unix socket, "N tiến trình cùng bind" không tự báo EADDRINUSE

**Khi nào áp dụng:** bất kỳ lượt nào giành quyền sở hữu một đường dẫn Unix domain socket —
`feat-daemon-supervisor` (INV-SHIM-2), và sắp tới là `feat-mcp-shim` khi shim tự khởi daemon.

## Giả định sai mà tôi suýt mang vào thiết kế

Phản xạ ban đầu: "thử `connect()` trước; nếu thất bại thì `unlink` rồi `listen`. Kẻ thua cuộc sẽ
nhận `EADDRINUSE`, nên chỉ một daemon tồn tại." Giả định đó sai ở vế cuối.

Đo được bằng mutant M4 (giữ nguyên bước probe, bỏ lock `O_EXCL`): năm lần khởi chạy đồng thời trên
cùng một đường dẫn cho ra **năm** daemon, không lần nào báo `EADDRINUSE`. Nguyên nhân gốc: mỗi
launcher `unlink` tệp socket của launcher trước rồi tự `bind` một tệp mới. `bind` chỉ thất bại khi
đường dẫn **đang tồn tại** tại đúng thời điểm gọi, mà mỗi kẻ đến sau đã tự tay xoá nó đi. Kết quả:
năm server sống, chỉ server cuối cùng có thể nhận kết nối, bốn server còn lại là daemon mồ côi giữ
JVM con — đúng hình dạng mà INV-SHIM-2 cấm.

## Biện pháp

Đặt toàn bộ đoạn `probe → unlink stale → listen` dưới một lock tạo bằng `openSync(path, "wx")`
(`O_CREAT|O_EXCL`, nguyên tử ở mức hệ tệp). Chỉ kẻ giữ lock được phép xoá tệp socket. Kẻ không lấy
được lock quay lại bước probe, chờ và uỷ quyền cho kẻ thắng. Giữ lock suốt vòng đời daemon và ghi
pid vào đó, để launcher uỷ quyền đọc ra được pid của đúng daemon nó hội tụ về — chính là quan sát
mà falsifier yêu cầu ("assert one daemon pid"). Lock cũ của tiến trình đã chết được nhận biết bằng
`process.kill(pid, 0)`; `EPERM` nghĩa là tiến trình còn sống nhưng khác chủ, không được coi là chết.

## Hai chi tiết môi trường đã đo, khỏi đo lại

- Socket "stale" thật chỉ tạo được bằng `SIGKILL` một tiến trình đang lắng nghe; `server.close()`
  của Node tự xoá tệp nên không tái hiện được. `connect()` tới socket stale trả `ECONNREFUSED`,
  còn tới một tệp thường trả `ENOTSOCK` — cả hai đều phải quy về "không có daemon sống".
- `sun_path` chỉ 104 byte trên macOS, mà `os.tmpdir()` đã chiếm ~52 byte. Tiền tố `mkdtempSync`
  phải ngắn (`jdt-d-` cho ra 78 byte tổng); tiền tố dài kiểu `jdt-daemon-supervisor-` là đủ để lỗi.
