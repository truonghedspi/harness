# Đếm tiến trình con: mỗi child phải ghi vào file log riêng, không dùng chung một file

**Khi nào áp dụng:** oracle Level 3 cần đếm số tiến trình thật được spawn (INV-POOL-5, INV-SHIM-2,
INV-SHIM-4 — mọi bất biến dạng "N lời gọi song song chỉ tạo một tiến trình").

## Triệu chứng

Fixture `java` giả ghi pid và argv của nó vào **một** file dùng chung bằng `{ ... } >> log`. Khi
hai child chạy song song, test khẳng định phải thấy 2 bản ghi nhưng chỉ đọc được 1, kèm thông báo
`1 !== 2`. Nhìn qua giống như pool đã spawn thiếu một tiến trình — nghĩa là đổ lỗi nhầm cho mã
nguồn đang được kiểm tra.

## Nguyên nhân gốc

`{ printf; printf; printf; } >> file` trong sh không phải một lần ghi nguyên tử: mỗi `printf` là một
syscall riêng. Hai child ghi xen kẽ nhau thành `PID a / ARG… / PID b / ARG… / END / END`. Bộ phân
tích theo trạng thái đọc `PID b` khi đang dựng bản ghi a sẽ ghi đè bản ghi a và làm mất nó. Số bản
ghi đọc được trở thành hàm của thời điểm lập lịch, không phải của hành vi cần chứng minh.

## Cách làm đúng

Mỗi child ghi ra file riêng đặt tên theo pid của chính nó: `} > "$LOGDIR"/"$$".txt`. Oracle đọc cả
thư mục và bỏ qua file chưa có dòng `END` (bản ghi đang viết dở). Không còn xen kẽ, và số file
chính là số tiến trình thật.

Kèm theo: sau khi `acquire` trả về, child mới `exec` xong nên chưa chắc đã ghi log. Phải chờ một
khoảng lắng (khoảng 400 ms) rồi mới khẳng định "đúng một tiến trình", nếu không phép đếm chỉ chứng
minh rằng tiến trình thừa chưa kịp xuất hiện.

Xem `test/integration/workspace-pool-spawn.integration.spec.ts` (feat-workspace-pool, lần thử 1).
