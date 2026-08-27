# Mỏ neo dương mà chính checker yêu cầu cũng phải được đo bằng mutant

**Khi nào áp dụng:** lượt trước bạn REJECT và yêu cầu maker thêm một khẳng định chống-xanh-rỗng-nghĩa
("khẳng định handler ĐƯỢC gọi trước khi gỡ", "khẳng định file tồn tại trước khi xoá", "khẳng định
cache có dữ liệu trước khi invalidate"). Lượt sau maker thêm đúng câu đó. Gặp ở
`feat-lsp-notifications` lượt 2 (2026-08-23).

## Cái bẫy

Bạn đọc thấy `assert.equal(calls, 1, "handler chưa bao giờ được nối")` đứng đúng chỗ, đúng chữ, và
phê duyệt. Nhưng bạn vừa kiểm tra sự **hiện diện** của mỏ neo, không phải **tác dụng** của nó. Mỏ neo
là một khẳng định như mọi khẳng định khác: nó cũng có thể được viết sao cho không bao giờ đỏ (so sánh
với giá trị do chính code sinh ra, đọc biến sai, đặt sau lời gọi làm nó luôn đúng). Chấp nhận nó vì
nó tồn tại là đúng kiểu lỗi mà bạn vừa bắt maker sửa ở lượt trước.

## Cách đo

Dựng thêm một mutant **phá đúng cơ chế mà mỏ neo khẳng định**, chứ không phải cơ chế mà ca kiểm thử
phán xét. Ở đây ca 22 phán xét đường *gỡ đăng ký*; mỏ neo khẳng định đường *dispatch* có chạy. Vậy
mutant phải làm dispatch không gọi handler nào (`[...handlers]` → `[...handlers].slice(0, 0)`), rồi
xác nhận ca đó fail **tại dòng mỏ neo** với đúng thông báo của mỏ neo — không phải fail ở khẳng định
cuối, cũng không phải vẫn xanh.

Ba kết quả, ba cách đọc:
- fail tại mỏ neo, đúng thông báo ⇒ mỏ neo có tác dụng thật, phê duyệt được.
- fail nhưng ở khẳng định khác ⇒ mỏ neo thừa, ca vẫn phân biệt được nhờ thứ khác; nói rõ trong notes.
- vẫn xanh ⇒ mỏ neo là trang trí, ca kiểm thử xanh rỗng nghĩa y như trước khi bạn REJECT.

## Quy tắc rút ra

Mỗi lần lượt trước bạn yêu cầu thêm một khẳng định, lượt sau bạn nợ đúng một mutant nhắm vào khẳng
định đó. Chi phí một lần chạy suite; không có nó thì vòng maker–checker chỉ chuyển từ "code chưa được
chứng minh" sang "yêu cầu của checker chưa được chứng minh". Áp dụng cùng lúc với việc dựng lại mutant
mà maker báo cáo — đừng tin số liệu, chạy lại.
