# Fixture đếm sai chỉ có răng khi độ lệch vượt bề rộng token

## Quan sát

`feat-prove-navigation-tools` cần chứng minh hover/definition/references đếm cột bằng UTF-16 code
unit. Fixture dựng một dòng astral chứa `𝄞𝒜` — hai cặp surrogate trước symbol `counter` — kèm chốt
chặn tự tin:

```
assert.equal(astralPrefix.length - [...astralPrefix].length, 2,
  "phần đầu dòng astral phải chứa đúng hai cặp surrogate để lỗi đếm codepoint lệch ra ngoài token");
```

Mười điều kiện đều xanh. Mutant "hiểu cột là chỉ số codepoint" vẫn **SỐNG SÓT**.

## Nguyên nhân gốc

Đếm bằng codepoint đẩy vị trí được hỏi sang phải đúng bằng **số cặp surrogate nằm trước nó**, ở đây
là 2. Token `counter` dài 7 ký tự. Lời gọi lệch 2 vì thế rơi từ `c` sang `u` — vẫn nằm TRONG token.
JDT LS giải ra đúng symbol đó, trả về đúng range của cả token, và mọi khẳng định vẫn đúng. Chốt chặn
tuyên bố một ranh giới mà fixture không hề chứa: nó đo có đủ hai cặp surrogate hay không, chứ không
đo điều thật sự cần thiết là độ lệch có ra khỏi token hay không.

Dòng BMP thì tình cờ đúng: độ lệch byte↔code unit của nó là 13, lớn hơn 7, nên mutant "đếm bằng
byte" chết ngay. Sự tình cờ đó che mất khiếm khuyết của dòng astral trong suốt lượt đo đầu.

## Quy tắc cho các lần sau

Một fixture "làm phép đếm khó" chỉ phân biệt được đúng/sai nếu **độ lệch mà cách đếm sai gây ra lớn
hơn bề rộng của token được hỏi**. Đo thẳng đại lượng đó trong chốt chặn, đừng đo đại lượng thay thế:

```
assert.ok(astralPrefix.length - [...astralPrefix].length > SYMBOL.length, ...);
assert.ok(Buffer.byteLength(bmpPrefix, "utf8") - bmpPrefix.length > SYMBOL.length, ...);
```

Cùng một hình dạng lỗi áp cho mọi oracle định vị: hỏi một vị trí rồi khẳng định range trả về, với một
subject có khả năng "hút" vị trí về token gần nhất. Lệch trong token là lệch vô hình. Sửa xong phải
đo **lại toàn bộ** các mutant trên fixture mới, vì con số cũ nói về một fixture khác.

Dấu hiệu nhận biết sớm: chốt chặn nào phát biểu bằng số lượng ký tự (`đúng hai cặp surrogate`) thay
vì bằng quan hệ với đại lượng nó phải thắng (`> SYMBOL.length`) đều đáng nghi.
