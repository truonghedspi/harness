# Bằng chứng đỏ của oracle giết mutant đến từ mutant, không từ tính năng thiếu

## Quan sát

`feat-prove-workspace-identity` là nhiệm vụ giết mutant còn sống, không phải hành vi mới.
`project-router.ts:47` và `workspace-pool.ts:171` đã đồng thuận sẵn, nên oracle bắt buộc XANH ở
lần chạy đầu tiên trên mã nguồn chưa sửa. Quy tắc red-first mặc định ("test phải đỏ trước") bị đảo:
một lần đỏ ở đây chỉ có thể nghĩa là oracle sai, hoặc hai component thật sự đã lệch nhau.

## Bằng chứng

Chu trình đúng cho loại nhiệm vụ này gồm bốn bước, và cả bốn đều phải ghi vào `evidence`:

1. Chạy trên mã nguồn sạch, phải xanh.
2. Áp mutant tạm thời tại đúng dòng mà báo cáo mutant nêu tên, chạy lại, phải đỏ vì lỗi assertion.
3. Hoàn nguyên mutant, kiểm tra `git diff src/` rỗng.
4. Chạy lại lần cuối, phải xanh trở lại.

Trên tính năng này, mutant đổi kiểu mã hoá digest (`hex` -> `base64url`) tại phía router chỉ làm đỏ
điều kiện so sánh chéo seam. Mutant đổi input hash (`canonicalRoot` -> `basename(canonicalRoot)`)
tại phía pool làm đỏ thêm điều kiện chống gộp hai project. Áp mutant ở một phía là đủ theo yêu cầu,
nhưng chạy cả hai dòng cho thấy oracle bắt được cả hai kiểu đột biến, không chỉ một.

## Quy tắc cho các lần sau

Khi feature có `kind: prove` và `context.note` mô tả một mutant còn sống, không được coi lần chạy
xanh đầu tiên là dấu hiệu "test vô dụng" rồi bỏ đi. Ngược lại, không được kết thúc nhiệm vụ khi mới
có bằng chứng xanh: thiếu bước áp mutant thì không có gì chứng minh oracle nhìn thấy dòng mã đó.
Luôn hoàn nguyên mutant và kiểm tra cây làm việc sạch trước khi bàn giao.

Ràng buộc đi kèm khi spec để ngỏ thuật toán (ở đây là X-005): chỉ so hai phía với NHAU, không so với
literal. Hệ quả phải ghi rõ vào `evidence` để checker không kỳ vọng sai — mutant áp giống hệt lên cả
hai phía sẽ sống sót, và đó không phải lỗi của oracle.
