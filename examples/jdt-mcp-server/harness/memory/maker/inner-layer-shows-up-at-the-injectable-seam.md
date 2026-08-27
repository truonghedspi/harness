# Lớp trong "không quan sát được" thường lộ ra ngay ở cổng tiêm được

**Khi nào áp dụng:** lượt vá oracle sau khi checker liệt kê mutant sống sót, và checker tự nhận rằng
một mutant "không đòi ca vì hiệu ứng không quan sát được qua seam hiện tại". Gặp ở
`feat-readiness-gate`, lượt 2, mutant RM8.

## Bài học chính

RM8 bỏ kẹp `Math.min(#probeTimeoutMs, Math.max(1, at - Date.now()))` trong `#probeOnce`. Hiệu ứng
theo mô tả — một request bị bỏ rơi sống lâu hơn ngân sách của caller — đúng là không đo được từ phía
caller, vì caller đã được lớp `settleBy` bên ngoài buông đúng hạn rồi. Nhưng đại lượng bị mutant làm
sai **được trao qua một tham số của cổng công khai**: `ReadinessGateOptions.probe` nhận
`ProbeOptions.timeoutMs`. Tiêm một probe, ghi lại `timeoutMs` mỗi lần được trao, rồi khẳng định mọi
ngân sách nằm trong `[1, hạn của caller]` trong khi trần probe là 5000 ms — RM8 trao 5000 ms cho một
lời gọi 150 ms và chết ngay.

Quy tắc rút ra: trước khi chấp nhận "không quan sát được", liệt kê mọi giá trị mà thành phần **trao
ra ngoài** qua cổng tiêm được, không chỉ giá trị nó **trả về**. Một tham số truyền cho collaborator
là hành vi công khai y như giá trị trả về, và nó thường là chỗ duy nhất lớp trong hiện hình. Điều
kiện để khẳng định này không phải là kiểm thử nội bộ: cổng đó phải đã công khai vì một lý do khác
(ở đây `probeSemanticIndex` được `feat-prove-sync` gọi trực tiếp).

## Bài học phụ: ca treo là bằng chứng đỏ yếu

Dưới mutant RM2, ca 5 treo hết 10 s rồi `node:test` huỷ (`cancelled`) toàn bộ ca đứng sau. Mutant vẫn
bị giết, nhưng lượt đo đó không nói gì về các ca còn lại, và thông điệp chỉ là "test timed out".

Cách sửa không làm yếu ca: giữ nguyên mọi khẳng định cũ, chỉ thay `await` không giới hạn bằng
`Promise.race` với một watchdog dài gấp hơn mười lần hạn đang kiểm, rồi thêm một khẳng định "caller
vẫn còn chờ sau N ms". Bất biến được kiểm không đổi, nhưng vi phạm trở thành một dòng đỏ nêu đúng
tên bất biến, và 0 ca bị huỷ nên cùng một lần chạy vẫn đo được các mutant khác.
