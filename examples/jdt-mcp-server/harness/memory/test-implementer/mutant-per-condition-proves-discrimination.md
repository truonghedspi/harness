# Oracle của tính năng prove có phụ thuộc đã done: mỗi điều kiện cần một mutant riêng

## Quan sát

`feat-prove-pool-crash-handling` không nêu tên mutant nào, nhưng cả hai phụ thuộc
(`feat-lsp-client`, `feat-workspace-pool`) đã `done`. Hành vi INV-POOL-3 vì thế đã tồn tại đúng, và
oracle xanh ngay lần chạy đầu. Đây không phải dấu hiệu oracle vô dụng, cũng không thuộc trường hợp
"mutant còn sống được nêu tên" đã ghi ở `mutant-kill-oracle-inverts-red-first.md`: ở đây bằng chứng
đỏ phải do chính test-implementer dựng ra.

## Bằng chứng

Ba điều kiện của kế hoạch mô tả ba chế độ hỏng khác nhau của cùng một invariant. Một mutant duy nhất
chỉ chứng minh được một chế độ. Bốn mutant tự dựng cho kết quả phân biệt rõ:

| Mutant | Chế độ hỏng | Điều kiện đỏ |
|---|---|---|
| Bỏ vòng reject trong handler `exit` | treo quá deadline | cả ba |
| `break` sau lần reject đầu tiên | chỉ settle một entry | chỉ TCON-POOL-0005 |
| Trả kết quả từ frame chưa đủ byte | câu trả lời dở dang | chỉ TCON-POOL-0006 |
| Resolve mọi pending bằng kết quả cũ | câu trả lời cũ | cả ba |

Hai mutant giữa mới là bằng chứng có giá trị: chúng cho thấy từng điều kiện bắt đúng chế độ hỏng
riêng của nó, chứ không phải cả ba cùng đỏ vì một nguyên nhân chung.

## Quy tắc cho các lần sau

Khi tính năng `prove` có mọi phụ thuộc đã `done` và không nêu tên mutant, dựng mỗi chế độ hỏng mà
falsifier liệt kê thành một mutant tạm, và ghi vào `evidence` cả những điều kiện KHÔNG đỏ dưới mutant
đó cùng lý do. Một mutant làm đỏ cả ba điều kiện không phân biệt được điều kiện thừa với điều kiện
cần. Luôn hoàn nguyên bằng `git checkout` và kiểm tra `git status --porcelain src/` rỗng trước khi
bàn giao.
