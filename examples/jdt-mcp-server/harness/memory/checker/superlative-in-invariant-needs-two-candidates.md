---
name: superlative-in-invariant-needs-two-candidates
description: A superlative in an invariant (outermost/nearest/first/last) is unverified unless a fixture offers two candidates on that axis.
metadata:
  type: lesson
  date: 2026-08-21
---

`INV-ROUTE-1` chứa hai từ chọn lọc: `outermost enclosing ancestor pom.xml that declares <modules>` và
`nearest ancestor pom.xml`. Bộ oracle sáu điều kiện giết mọi mutant mà falsifier nêu tên, nhưng mutant
đổi `mavenRoots.findLast(...)` thành `mavenRoots.find(...)` — chọn reactor trong cùng thay vì ngoài
cùng — vẫn xanh 6/6. Nguyên nhân gốc: không fixture nào có reactor lồng trong reactor, nên trục
`outermost` chỉ có đúng một ứng viên.

**Vì sao khó thấy:** đây là lần thứ hai liên tiếp cùng một hàm routing lọt lưới theo cùng một kiểu.
Lần trước là mệnh đề fallback (`nearest`) không có ứng viên thứ hai; TCON-ROUTE-0006 đóng đúng mệnh đề
đó rồi dừng lại. Một điều kiện mới chỉ đóng đúng trục mà nó được đặt hàng, không đóng các trục còn lại
của cùng một câu invariant.

**Cách áp dụng:** khi invariant chứa từ so sánh nhất hoặc từ chọn lọc (`outermost`, `nearest`, `first`,
`last`, `longest prefix`, `highest priority`), tách câu thành từng trục chọn lọc. Với mỗi trục, hỏi cây
fixture có tối thiểu hai ứng viên hợp lệ hay không. Nếu chỉ có một, từ đó được chứng minh bởi không gì
cả — đảo chiều phép chọn trong bản sao scratch và chạy lại để xác nhận. Báo cáo dạng `FOLLOW-UP:` kèm
đúng hàng decision table còn thiếu, khi các falsifier mà tính năng tự nêu đều đã bị giết.

## Cập nhật vòng ba (2026-08-21) — mệnh đề định tính cũng là một trục riêng

TCON-ROUTE-0007 đóng đúng trục `outermost` và giết M3 sạch sẽ. Nhưng vòng quét mutant ngay sau đó lộ
mutant M12 vẫn sống sót cả 7/7: *nếu chuỗi tổ tiên có bất kỳ reactor nào thì lấy pom.xml ngoài cùng, dù
chính pom đó không khai báo `<modules>`*. Nguyên nhân gốc: câu invariant có ba trục chứ không phải hai —
thứ tự chọn (`outermost`), nhánh dự phòng (`nearest`), và **mệnh đề định tính** (`that declares
<modules>`) lọc tập ứng viên trước khi thứ tự chọn được áp dụng.

**Bài học sắc hơn:** một mệnh đề quan hệ bổ nghĩa cho ứng viên (`that declares X`, `with status Y`) là
một trục độc lập với từ so sánh nhất đứng trước nó. Nó cần fixture đặt một ứng viên KHÔNG thỏa mệnh đề ở
đúng vị trí mà phép chọn ưu tiên — ở đây là một pom.xml phi reactor nằm TRÊN reactor root.

**Cách làm khác đi lần sau:** đừng đặt hàng từng hàng decision table theo từng mutant vừa bắt được; ba
vòng liên tiếp mỗi vòng chỉ đóng một trục rồi lộ trục kế. Thay vào đó, dựng một hàng trộn duy nhất phủ
toàn bộ phép chọn: chuỗi tổ tiên năm tầng gồm đỉnh phi reactor, reactor A, tầng giữa phi reactor,
reactor B, module lá — kết quả đúng là A. Hàng này giết cả ba trục cùng lúc. Đồng thời, chạy quét mutant
theo lô trên mọi quyết định của hàm (id, thông báo lỗi, điều kiện dừng vòng lặp, nhánh dự phòng) ngay
trong verdict đầu tiên, để mọi mutant sống sót lộ ra một lần thay vì nhỏ giọt qua từng vòng.

**Ràng buộc điều hướng:** khi phát hiện gap ở lần thử cuối (attempts = maxAttempts), `FOLLOW-UP:` phải
nói rõ không được mở rộng tại chỗ tính năng đó nữa — maker hết lượt, mở rộng tại chỗ tạo ra một tính
năng vĩnh viễn không thể đánh giá lại. Định tuyến sang một tính năng oracle mới hoặc một hàng rủi ro
chấp nhận được.
