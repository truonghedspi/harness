# Lỗi flaky được sửa bên trong oracle có thể là lỗi sản phẩm bị dời khỏi tầm nhìn

**Khi nào áp dụng:** maker báo cáo đã sửa một ca kiểm thử chập chờn bằng cách thêm cơ chế vào tệp
spec — tệp mồi, vòng chờ, độ trễ khởi động, retry — mà không chạm `src/`. Gặp ở
`feat-file-sync-watcher`, lượt 2.

## Điều trông như một lượt sửa oracle sạch

Maker đo được 2 trên 4 lần chạy đỏ, chẩn đoán đúng nguyên nhân gốc (libuv khởi động luồng FSEvents
sau khi `fs.watch()` đã trả về; lần ghi rơi vào cửa sổ đó không bao giờ được chuyển tới), rồi đóng
cửa sổ bằng một tệp mồi ghi trong spec. Anh ta còn ghi rõ ranh giới: sửa `src/` trong một lượt sửa
oracle là cách nhanh nhất để bị từ chối. Ranh giới đó đúng, và cú hích thật sự không làm yếu oracle
— tôi kiểm chứng bằng hành vi: ba mutant làm tệp biến mất khỏi tập quét vẫn chết, nên cú hích không
có khả năng cứu một thông báo thiếu.

## Câu hỏi mà cả hai bên đều bỏ qua

Cơ chế vừa thêm có bản đối ứng trong sản phẩm không? Ở đây là không: không ai ghi `.fs-watch-probe`
giúp daemon. Nghĩa là hiện tượng chập chờn không phải tạo tác của kiểm thử — nó là một lỗ hổng thật
của bản triển khai, và lượt sửa vừa rồi làm cho không còn ca nào phát hiện được nó nữa.

Cách xác nhận nhanh, không cần tranh luận thiết kế: tra `harness/docs/assumptions.md` xem có dòng
nào đang khẳng định điều ngược lại. A-014 ghi "A recursive filesystem watcher observes every relevant
change", trạng thái vẫn là `assumed`, ô bằng chứng để trống — trong khi maker đã có số đo bác bỏ nó.
Một giả định bị bằng chứng đo được bác bỏ mà dòng tương ứng không đổi trạng thái là một khiếm khuyết
cụ thể, nêu tên được, không phải cảm giác.

## Việc checker phải làm

1. Hỏi cơ chế mới có bản đối ứng trong sản phẩm không. Nếu không, đó là lỗi sản phẩm, không phải
   lỗi kiểm thử.
2. Tra `assumptions.md` trước khi kết luận. Dòng mâu thuẫn biến một nghi ngờ thành một việc có chủ
   sở hữu rõ ràng.
3. Vẫn tôn trọng ranh giới phạm vi của maker. Đừng bắt anh ta sửa `src/` trong lượt sửa oracle; hãy
   nêu tên phần việc còn thiếu và giao cho planner hoặc design layer tạo phạm vi. Không nêu tên tức
   là chấp nhận một lỗi im lặng.

## Bài học thứ hai của cùng lượt: một phép so nhiều trường cần một ca cho mỗi trường

Bản triển khai quyết định "đã thay đổi" bằng bộ ba `(mtimeMs, size, ino)`. Lượt 1 phát hiện vế `ino`
không ca nào ghim; maker thêm đúng một ca cho `ino` và dừng lại. Hai vế còn lại vẫn xoá được mà bộ
kiểm thử không đỏ — trong đó vế `mtime` là vế nặng nhất, vì `writeFileSync` ghi đè giữ nguyên inode
nên một lần sửa tại chỗ cùng số byte chỉ khác đúng mtime.

Quy tắc rút ra: khi thấy một biểu thức `a !== a' || b !== b' || c !== c'`, đòi một ca cho MỖI vế
trong CÙNG một lượt, mỗi ca ghim các vế còn lại bằng nhau. Nêu đủ danh sách ngay lần từ chối đầu
tiên; đóng một trục mỗi lượt là cách nhỏ giọt các lỗ hổng đến vô hạn và đốt hết `maxAttempts`.
