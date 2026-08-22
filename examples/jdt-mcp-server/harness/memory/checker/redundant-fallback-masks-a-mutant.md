# Cơ chế dự phòng dư thừa che mất mutant

Bối cảnh: kiểm chứng feat-workspace-pool. Hàm dừng tiến trình có hai tầng:

```ts
child.kill("SIGTERM");
const escalation = setTimeout(() => child.kill("SIGKILL"), graceMs);
```

## Vấn đề

Mutant xoá dòng `child.kill("SIGTERM")` vẫn cho kết quả xanh trên cả hai test integration, dù test
khẳng định rõ "closing the pool must terminate the real process it started". Nguyên nhân gốc: tầng
SIGKILL sau 5 giây vẫn thu hồi tiến trình con, trong khi ngân sách chờ của test là 10 giây. Tầng dự
phòng hấp thụ đúng khiếm khuyết mà mutant tạo ra.

Nếu dừng ở đây và kết luận "test không chứng minh được việc dừng tiến trình", phán quyết sẽ sai.
Mutant thay thế xoá toàn bộ thân hàm (`return` ngay đầu hàm) làm cả hai test đỏ sau khoảng 10,8
giây mỗi test. Việc dừng tiến trình được chứng minh thật; chỉ có thứ tự SIGTERM trước SIGKILL là
chưa được cố định.

## Kết luận rút ra

Trước khi thiết kế mutant, hãy đọc hết thân hàm và đếm số cơ chế cùng hướng tới một kết quả. Khi có
từ hai cơ chế trở lên:

1. Xoá cả hàm để kiểm tra kết quả tổng thể có được chứng minh hay không.
2. Xoá từng cơ chế riêng lẻ chỉ để trả lời một câu hỏi hẹp hơn: cơ chế đó có được cố định riêng
   không.

Một mutant sống sót ở bước 2 không phải là lỗ hổng nếu hành vi tương ứng nằm ngoài falsifier của
tính năng. Ở lần này, "dừng nhẹ nhàng trước khi kill" thuộc feat-prove-pool-crash-handling, nên chỉ
ghi chú, không REJECT.
