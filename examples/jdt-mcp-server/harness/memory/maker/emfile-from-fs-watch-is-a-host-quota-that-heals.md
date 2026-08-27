# `EMFILE` từ `fs.watch()` là hạn ngạch của host, và nó tự lành

**Bối cảnh.** `feat-prove-diagnostics`, attempt 2 (2026-08-24) và attempt 3 (2026-08-25).

## Triệu chứng

Oracle của chính tính năng xanh 3/3 trong 10,6 s, nhưng `./harness/init.sh` đỏ. Ca đỏ nằm trong
`DiskFileSyncWatcher` và báo `EMFILE` từ `fs.watch()`. Hình dạng này mời gọi hai kết luận sai:
watcher rò file descriptor qua nhiều lần gọi, hoặc tiến trình test cạn fd theo hạn ngạch thông
thường.

## Cách phân biệt, chỉ tốn một lệnh

Chạy một tiến trình Node **độc lập, không import module nào của dự án**, rồi đo ba thứ trong cùng
lần chạy:

1. `fs.watch()` một thư mục temp vừa tạo, còn trống;
2. `fs.watch()` một tệp đơn lẻ;
3. mở khoảng 300 file descriptor `/dev/null` thường.

Attempt 2 đo được: vế 1 đỏ, vế 2 và vế 3 xanh. Ba kết quả đó cùng lúc bác bỏ cả hai giả thuyết về
mã nguồn. Một thư mục trống không có gì để watcher rò; theo dõi tệp và mở fd thường vẫn còn dư địa,
nên thứ cạn không phải hạn ngạch fd chung mà là hạn ngạch **theo dõi thư mục** của host. Không có
thay đổi nào trong `src/` hay `test/` biện minh được, và đó là lý do đúng để giữ `readyForCheck`
ở `false` thay vì vá bừa.

## Điều không hiển nhiên

Hạn ngạch này **tự giải phóng**. Attempt 3 chạy lại đúng lệnh chẩn đoán đó một ngày sau: cả thư mục
temp trống, thư mục repo, lẫn 200 thư mục con mới đều theo dõi được, không một lần `EMFILE`. Oracle
vẫn 3/3 trong 10,64 s và baseline lên 124/124 mà không ai sửa một dòng nào.

Nguyên nhân gốc là nhiều tiến trình test chạy song song trong cùng một phiên (nhiều maker và checker
làm việc đồng thời trên các tính năng khác nhau) làm cạn hạn ngạch của macOS tại đúng thời điểm đó.
Khi các tiến trình ấy kết thúc, hạn ngạch trở lại.

## Rút ra

- `EMFILE` từ `fs.watch()` trên macOS là **tín hiệu về tải của máy**, không phải tín hiệu về mã.
  Đừng tiêu một lượt thử lại để vá watcher.
- Trước khi đổ lỗi cho watcher, luôn chạy vế đối chứng ở tiến trình độc lập. Nếu một tiến trình
  không import gì cũng đỏ, khiếm khuyết nằm ngoài repo theo định nghĩa.
- Baseline đỏ vì môi trường thì phương án đúng là ghi rõ chẩn đoán vào `checkerNotes`, giữ
  `readyForCheck: false`, rồi **đo lại sau** — không phải nới ca test cho vừa.
- Hệ quả cho ngân sách thử lại: một lượt "chỉ xác nhận lại" vẫn tính là một attempt. Ở đây nó tiêu
  nốt lượt cuối (3/3), nên hãy đo lại khi máy đã rảnh, đừng đo giữa lúc còn nhiều tiến trình test
  khác đang chạy.
