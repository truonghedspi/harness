# Chốt chặn đặt trong vùng đột biến phải trung lập với thứ tự

**Khi nào áp dụng:** oracle nhắm một mutant kiểu ĐẢO THỨ TỰ hai câu lệnh, và fixture cần dừng chương
trình lại đúng giữa hai câu lệnh đó. Gặp ở `feat-prove-evict-succession` (mutant N1: `spawned.stop()`
chạy trước `#runDetachments(victim)` trong `#evict`).

## Cái bẫy

Cách dựng cửa sổ đua tự nhiên nhất là cho một deferred nằm bên trong một trong hai câu lệnh — ở đây
`stop()` của spawner giả phát tín hiệu `stopReached` rồi chờ `stopGate`. Nhưng chính câu lệnh đó là
thứ mutant di chuyển. Hệ quả: `stopReached` phát ra ở hai thời điểm KHÁC NHAU giữa mã gốc và mutant.
Trên mã gốc, lúc nó phát thì `forget()` đã chạy xong; dưới mutant thì `forget()` chưa chạy.

Nếu phần còn lại của fixture giả định "khi chốt chặn mở thì X đã xảy ra", fixture đang mã hoá đúng cái
thứ tự mà nó phải phán xử. Nó sẽ xanh hoặc đỏ vì lý do khác với lý do đang được nêu tên.

## Cách làm đúng

Sau khi chốt chặn mở, chỉ được làm những việc hợp lệ dưới CẢ HAI thứ tự — ở đây là spawn tiến trình
kế nhiệm rồi publish một notification. Chỉ có KHẲNG ĐỊNH mới được phân biệt hai thứ tự, và nó chỉ
được đọc trạng thái SAU khi lượt evict hoàn tất trọn vẹn (`await` chính promise `acquire` đã khởi
động lượt evict — đó là điểm đồng bộ duy nhất đúng dưới cả hai thứ tự).

Dấu hiệu đã làm đúng: giữa mã gốc và mutant, chỉ đúng MỘT dòng khẳng định đổi kết quả; mọi mỏ neo
dương trước đó vẫn xanh dưới mutant. Nếu mỏ neo dương cũng đỏ theo, lượt đỏ đến từ khâu dựng cảnh
chứ không từ hành vi, và bằng chứng không dùng được.

## Kèm theo

Lời gọi acquire thứ hai tự nó có thể kéo theo một lượt evict phụ (ở đây nó đẩy cap lên 4 và evict
`beta`). Nạn nhân phụ đó phải dừng NGAY, nếu không fixture tự khoá chính mình. Chỉ thế hệ đầu tiên
của root đang khảo sát mới được dừng chậm.
