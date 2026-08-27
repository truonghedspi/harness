# Một fixture mang hai loại bằng chứng: đo lại mutant TRÊN bản đã sửa

## Quan sát

`feat-prove-diagnostics-identity` trộn hai loại nhiệm vụ mà hai ghi chú trước tách rời: một khẳng
định giết mutant còn sống (mã đã đúng, phải XANH ngay) và một khẳng định phơi lỗi thật (phải ĐỎ
ngay). Hai khẳng định dùng CHUNG một fixture JDT LS. Lượt đo mutant đầu tiên vì thế cho kết quả
lẫn lộn: cả hai điều kiện đều đỏ dưới m1 và dưới m2, nhưng một trong hai đỏ vì lỗi chưa sửa, không
vì mutant.

## Bằng chứng

| Lượt | m1 | m2 | Đọc được gì |
|---|---|---|---|
| Trên mã chưa sửa | 0005 đỏ, 0006 đỏ | 0005 đỏ, 0006 đỏ | không phân biệt được nguyên nhân của 0006 |
| Trên mã đã sửa | 0005 đỏ, 0006 xanh | 0005 đỏ, 0006 xanh | mỗi mutant chạm đúng một trục |

Chỉ lượt thứ hai chứng minh được điều cần chứng minh: khẳng định khoá cache bắt mutant khoá cache,
và khẳng định identity URI không đỏ lây. Lượt thứ nhất vẫn phải ghi vào evidence vì nó là bằng
chứng đỏ hành vi của phần lỗi thật, nhưng nó không phải bằng chứng phân biệt.

## Quy tắc cho các lần sau

Khi một tính năng `prove` vừa giết mutant vừa phơi lỗi thật trong cùng một fixture, đo mutant HAI
lần: một lần trước khi sửa (lấy lượt đỏ hành vi), một lần sau khi sửa (lấy lượt phân biệt). Bằng
chứng mutant có giá trị là bằng chứng đo trên đúng bản mã sẽ giao nộp. Giữ bản sao pristine ngoài
cây nguồn: `src/` ở repo này không được git theo dõi nên `git checkout` không hoàn nguyên được.

Kèm theo: khi chạy song song với một test-implementer khác, so mtime của tệp src trước khi quy lỗi
cho thay đổi của mình — ba ca astral-plane đỏ ở lượt `npm test` cuối đến từ `tool-layer.ts` mà agent
kia vừa ghi, không từ hai dòng sửa trong `projectUris()`.
