# Một oracle chị em viết trước có thể đỏ mà không ai chạy tới

Bối cảnh: feat-workspace-pool (build) dựng `src/workspace/workspace-pool.ts`. Lệnh verification của
tính năng chỉ chạy hai file test của chính nó và đều xanh.

## Vấn đề

Tầng test-design đã viết trước `test/integration/pool-lifecycle.integration.spec.ts` cho một tính năng
`prove` khác (feat-prove-pool-lifecycle, khi đó `not-started`). File này nhắm đúng vào module mà
tính năng build vừa tạo ra, và nó nạp module bằng `await import(...)`. Trước khi có triển khai, nó đỏ
vì thiếu module — nên nó nằm ngoài baseline gate. Sau khi có triển khai, nó chạy được thật, và
một trong ba điều kiện đỏ.

Không có gì trong quy trình chạm tới nó: lệnh verification của tính năng build không gọi nó,
`npm test` không bắt được thư mục `test/integration`, baseline gate cũng không.

## Cách phát hiện

Liệt kê toàn bộ cây test (`find test -type f`) thay vì chỉ đọc các file tính năng khai báo trong
`touches`. Bất kỳ file test nào đã tồn tại mà nhắc tên module vừa được triển khai đều phải chạy một
lượt, kể cả khi nó thuộc tính năng khác.

## Kết luận rút ra

Khi một tính năng `build` tạo module lần đầu, hãy tìm mọi oracle viết trước nhắm vào module đó và
chạy chúng. Kết quả rơi vào một trong ba nhóm, và cần phân loại rõ trong `checkerNotes`:

| Kết quả | Ý nghĩa | Xử lý |
|---|---|---|
| Xanh | Tính năng prove kế tiếp đã sẵn bằng chứng | Ghi nhận, không cản trở |
| Đỏ do lỗi triển khai | Falsifier của tính năng build chưa đủ rộng | REJECT |
| Đỏ do lỗi bản thân oracle | Tính năng prove kế tiếp sẽ vấp phải | APPROVE kèm `FOLLOW-UP:` nêu rõ dòng assertion sai |

Ở lần này kết quả thuộc nhóm ba: oracle khẳng định mọi workspace từng bị evict phải vắng mặt vĩnh
viễn trong `pool.status()`, nhưng chính fixture của nó lại acquire lại workspace đó, nên workspace
xuất hiện trở lại một cách hợp lệ. Phân loại sai nhóm này thành lỗi triển khai sẽ khiến maker sửa
code đang đúng.
