# Giá trị trả về mà không ca nào gọi là một mutant no-op đang chờ sống sót

**Khi nào áp dụng:** một API trả về closure để hoàn tác — hàm gỡ đăng ký của `onNotification()`,
`stop()` của watcher, `release()` của pool. Gặp ở `feat-lsp-notifications`, lượt 1 bị REJECT.

## Triệu chứng

Chín ca kiểm thử phủ kín cả hai chiều truyền notification, ba mutant do maker tự dựng đều bị giết,
`tsc` xác nhận kiểu trả về khớp cổng tiêu thụ. Vậy mà mutant `return () => {};` — thay toàn bộ thân
hàm gỡ đăng ký bằng no-op — vẫn 9/9 xanh. Lý do đơn giản: không ca nào từng **gọi** giá trị mà
`onNotification()` trả về. Bằng chứng duy nhất cho cơ chế đó là `tsc` nói kiểu tương thích, tức
chưa có hành vi nào được chứng minh.

Quy tắc rút ra, kiểm tra được bằng mắt trước khi giao cho checker: liệt kê mọi giá trị mà API công
khai trả về, và với mỗi giá trị hỏi "ca nào gọi nó?". Nếu câu trả lời là không ca nào, mutant no-op
sống chắc chắn.

## Cái bẫy đi kèm: ca phủ định xanh vì lý do sai

Ca tự nhiên cho hàm gỡ đăng ký là "gọi hàm gỡ, bắn khung, đòi handler không chạy". Ca đó xanh cả
khi dispatch hỏng hoàn toàn, khi tên method viết sai, khi handler chưa bao giờ được nối vào — mọi
khẳng định `=== 0` đều thoả một cách rỗng.

Phải có mỏ neo dương **trước** phần phủ định: bắn một khung khi đăng ký còn hiệu lực, khẳng định
`calls === 1`, rồi mới gỡ và bắn khung thứ hai để khẳng định `calls` vẫn bằng 1. Khi đó số 1 cuối
cùng chỉ có thể đến từ việc gỡ đăng ký có tác dụng thật.

## Cơ chế thứ hai cùng họ: sửa danh sách ngay trong lúc duyệt

Chú thích "chụp lại danh sách vì handler có thể gỡ đăng ký trong lúc dispatch" mô tả một tình huống
không ca nào chạm tới. Dựng được nó chỉ cần một handler tự gọi hàm gỡ của chính nó trong thân
callback: `splice` trên mảng gốc làm chỉ số dịch một bậc, iterator của `for...of` nhảy qua phần tử
kế tiếp, và handler sibling bị bỏ qua **trong im lặng**. Đây không phải chi tiết nội bộ — nó vi
phạm thẳng behavior đã khai ("mọi khung không có id tới được các handler", số nhiều).

Cách ghim đủ mạnh: ba handler cùng method, handler đầu tự gỡ, khung thứ nhất đòi cả ba chạy, khung
thứ hai đòi đúng hai handler còn lại. Vế thứ hai chặn cách vá gian lận là bỏ hẳn `splice`.
