# `npm test -- <file>` nối thêm vào glob, không thu hẹp nó

**Khi nào áp dụng:** mọi lượt maker trên repo này, vì `verification` của phần lớn tính năng được
viết dưới dạng `npm test -- test/<vùng>/<tên>.spec.ts`. Gặp ở `feat-tool-references`.

## Điều gì thật sự xảy ra

Script `test` trong `package.json` đã chứa sẵn ba glob:

```
node --experimental-strip-types --test test/lsp/*.spec.ts test/workspace/*.spec.ts test/tools/*.spec.ts
```

`npm test -- X` **nối** `X` vào cuối dòng lệnh đó. Kết quả là toàn bộ ba glob vẫn chạy, còn tệp
được nêu tên chạy thêm một lần nữa. Lệnh trông như "chỉ chạy đúng oracle của tôi" nhưng thực tế là
"chạy tất cả".

## Vì sao điều đó làm hỏng phán đoán

Lượt này chạy song song với ba maker khác, mỗi người đang viết dở một tệp trong `test/tools/`. Lần
chạy `npm test -- test/tools/references.spec.ts` đầu tiên báo **9 fail / 100**, trong khi oracle của
chính tính năng đang xanh hoàn toàn. Nếu đọc con số tổng đó là "bằng chứng đỏ của tôi", cả lần đỏ
lẫn lần xanh ghi vào `evidence` đều nói về công việc của người khác.

Cách làm đúng, theo thứ tự:

1. Đo tính năng của mình bằng lệnh hẹp thật sự:
   `node --experimental-strip-types --test test/tools/<tên>.spec.ts`.
2. Chỉ khi đó mới chạy `npm test` đầy đủ, và nếu có lỗi thì **quy trách nhiệm theo tệp** trước khi
   kết luận, bằng một vòng lặp cho từng spec:
   `for f in test/tools/*.spec.ts; do node --experimental-strip-types --test "$f"; done`.
   Bảng pass/fail theo tệp biến "8 lỗi ở đâu đó" thành "8 lỗi nằm trọn trong hai tệp không thuộc
   phạm vi lượt này" — một khẳng định kiểm chứng được, không phải một lời bào chữa.
3. Ghi cả hai con số vào `evidence`: số của lệnh hẹp là bằng chứng, số của `npm test` là ngữ cảnh.

## Hệ quả cho checker

`verification` ghi trong `feature_list.json` vẫn là lệnh rộng. Người review chạy đúng lệnh đó sẽ
thấy lỗi của các tính năng đang chạy song song và có thể quy nhầm cho tính năng đang xét. Nên nêu
thẳng phân bổ lỗi theo tệp trong `checkerNotes` hoặc `progress.md`.
