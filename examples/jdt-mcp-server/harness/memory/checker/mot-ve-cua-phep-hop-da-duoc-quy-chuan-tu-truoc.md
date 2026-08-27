# Một vế của phép hợp đã được quy chuẩn từ trước, nên chỉ nửa phần sửa là đo được

**Bối cảnh.** `feat-prove-diagnostics-identity` (2026-08-26). Lỗi thật: `projectUris()` hợp
`facade.projectFiles()` với `reader.list()` bằng một `Set`, hai vế mang hai cách viết khác nhau cho
cùng một tệp, nên MỘT tệp vật lý cho HAI mục. Phần sửa đối xứng, đọc rất thuyết phục:

```ts
const uris = new Set(facade.projectFiles(workspaceId).map(canonicalFileUri));
for (const report of reader.list(workspaceId)) uris.add(canonicalFileUri(report.uri));
```

Khối chú thích ngay trên đó khẳng định: *cả hai vế phải đi qua ĐÚNG hàm quy chuẩn — nếu không, MỘT
tệp vật lý cho HAI mục*.

## Điều mutant nói ngược lại

Tôi tách phần sửa thành hai nửa thay vì chỉ hoàn nguyên trọn gói:

| Mutant | Nội dung | Kết quả |
|---|---|---|
| m3 | hoàn nguyên cả hai vế | điều kiện identity ĐỎ |
| m3a | bỏ `.map(canonicalFileUri)` ở vế `projectFiles()` | điều kiện identity ĐỎ |
| m3b | bỏ `canonicalFileUri(...)` ở vế `reader.list()` | XANH toàn bộ — oracle integration 3/3, oracle đơn vị 19/19 |

Nguyên nhân: `absorb()` của cache đã gọi `canonicalFileUri` TRƯỚC khi lưu, nên `report.uri` luôn ở
dạng canonical và lời gọi thứ hai không bao giờ đổi giá trị. Nửa sau của phần sửa là phần dư thừa
phòng thủ ở ranh giới cổng, không phải cơ chế chịu lực. Chú thích khẳng định quá tay đúng một nửa.

## Cách kiểm tra, áp dụng cho mọi phần sửa dạng "đưa hai vế về cùng một không gian"

Mọi phép hợp, phép trộn, phép so sánh được sửa bằng cách bọc hàm chuẩn hoá `F` lên nhiều vế đều cần
một bước trước khi tin: **truy về nơi SINH ra giá trị của từng vế và hỏi `F` đã được áp ở đó chưa.**
Vế nào đã đi qua `F` trên đường ghi thì lời gọi `F` trên đường đọc là idempotent, và không mutant nào
giết được nó. Cùng họ với `mot-nguyen-tac-ap-hai-phan-ba.md`, chỉ khác chiều: ở đó hai cơ chế đỡ cho
nhau nên mutant đơn lẻ sống sót; ở đây một cơ chế đã chạy sớm hơn ở tầng khác.

Hệ quả thao tác: **đừng chỉ hoàn nguyên trọn gói phần sửa của maker.** Tách nó thành đúng số nửa mà
nó có, mỗi nửa một mutant. Hoàn nguyên trọn gói cho một màu đỏ đẹp và giấu mất việc chỉ một nửa được
đo. Con số cần đếm là số vế mà phần sửa chạm, không phải số dòng nó đổi.

Kết luận đúng mức: mutant sống sót ở đây KHÔNG phải khiếm khuyết (cổng `DiagnosticsReader` là cổng
cấu trúc, một hiện thực khác cache có quyền trả URI thô), nên nó không chặn phê duyệt. Thứ phải sửa
là câu chú thích: hạ từ "cả hai vế phải" xuống "phần dư thừa phòng thủ, chưa có ca nào đo" — hoặc
thêm một ca đơn vị rẻ tiêm reader giả trả URI không canonical. Đây là FOLLOW-UP, không phải REJECT.
