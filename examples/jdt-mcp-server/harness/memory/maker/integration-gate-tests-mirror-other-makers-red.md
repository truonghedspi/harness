# Ca `feat-001` đỏ có thể là suite unit của maker khác, không phải tính năng của bạn

**Khi nào áp dụng:** nhiều maker chạy song song trên cùng cây nguồn, và `npm run test:integration`
báo đỏ ở các ca mang tên `feat-001: the standard baseline gate ...`. Gặp ở lượt
`feat-tool-diagnostics`, khi ba maker khác đang xây `hover`/`definition`/`references`.

## Hiện tượng

Lượt chạy đầu: `# tests 320 / # fail 5`, năm dòng đỏ đều thuộc `feat-001` —
`the standard baseline gate executes every required step`,
`a failed install/fixture/test step makes the standard baseline gate red`,
`the maintained fixture step installs the pinned JDT LS archive`.
Không dòng nào nêu tên tệp của tính năng đang làm. Chạy lại đúng lệnh đó vài phút sau:
`# tests 181 / # fail 0`.

## Nguyên nhân gốc

Các ca `feat-001` gọi chính cổng baseline (`init.mjs`) trong tiến trình con, và cổng đó chạy
`npm test` trên TOÀN BỘ suite unit. Vì vậy chúng phản chiếu trạng thái tức thời của mọi tệp đang
được sửa dở, kể cả tệp của maker khác. Trong khoảng thời gian một maker song song để
`src/tools/hover.ts` ở trạng thái đỏ, mọi ca `feat-001` đỏ theo.

Số ca cũng nhảy (320 → 181) vì đầu ra TAP của các tiến trình con được đếm gộp vào lượt chạy ngoài.
Chênh lệch lớn về `# tests` giữa hai lần chạy liên tiếp chính là dấu hiệu nhận biết.

## Cách xử lý

1. Đọc TÊN ca đỏ trước khi đọc số. Ca đỏ không nêu tên tệp thuộc tính năng của mình thì đừng sửa gì.
2. Chạy lại lệnh và so `# tests`. Số ca đổi giữa hai lần chạy nghĩa là cây nguồn đang bị sửa đồng
   thời, và kết quả của lần chạy trước không nói gì về mã nguồn của mình.
3. Bằng chứng riêng của tính năng luôn lấy từ lệnh hẹp
   (`node --experimental-strip-types --test test/tools/<của mình>.spec.ts`), không lấy từ suite gộp.
4. Ghi thẳng vào evidence rằng lượt gộp đầu tiên đỏ vì lý do gì. Bỏ qua im lặng một lượt đỏ rồi chỉ
   chép lượt xanh vào là làm hỏng chính thứ mà evidence dùng để chứng minh.

Lưu ý phụ đo được cùng lượt: `npm test -- test/tools/x.spec.ts` KHÔNG thu hẹp phạm vi. Script
`test` đã mang sẵn danh sách glob, nên tham số chỉ được nối thêm — tệp của mình chạy hai lần và số
đỏ bị nhân đôi, lẫn với đỏ của người khác.
