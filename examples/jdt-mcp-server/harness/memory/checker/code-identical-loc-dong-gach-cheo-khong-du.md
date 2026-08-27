# "CODE-IDENTICAL" chứng minh bằng cách lọc dòng `//` là một bộ lọc thủng

**Khi nào áp dụng:** mọi lượt mà planner cấp *quyền sửa có giới hạn* cho một tính năng `prove` —
"sau khi ca xanh, được viết lại DUY NHẤT khối chú thích ở dòng N". Gặp ở `feat-prove-evict-succession`
(2026-08-25), khối chú thích trong `#evict` của `src/workspace/workspace-pool.ts`.

## Bằng chứng maker đưa ra, và vì sao nó chưa đủ

Maker khẳng định CODE-IDENTICAL bằng cách lọc bỏ mọi dòng bắt đầu bằng `//` khỏi hai bản rồi diff,
được kết quả rỗng. Bộ lọc đó bỏ sót ba lớp thay đổi:

1. Chú thích khối `/** ... */` — không dòng nào bắt đầu bằng `//`, nên một câu bị sửa trong Javadoc
   vẫn lọt qua *và* một dòng mã bị sửa ngay cạnh nó cũng lọt nếu nó nằm trong vùng bị lọc sai.
2. Chú thích đuôi dòng (`await x(); // ghi chú`) — dòng không bắt đầu bằng `//`, nên nó ở lại cả hai
   bên; ngược lại nếu maker lọc theo `contains("//")` thì cả câu lệnh biến mất khỏi phép so sánh.
3. Thứ tự câu lệnh khi một khối bị *di chuyển*: lọc rồi diff vẫn bắt được, nhưng chỉ khi diff giữ
   thứ tự — nếu ai đó `sort` trước khi diff thì đúng mutant N1 (đảo hai câu lệnh) trở nên vô hình.

Ở lượt này bộ lọc tình cờ cho kết quả đúng. Đó là may, không phải là bằng chứng.

## Cách đo đúng, và chỗ tìm bản đối chiếu

Đừng lọc gì cả — chạy `diff -u` đầy đủ với **bản pristine của lượt phê duyệt trước**, rồi tự đọc từng
hunk. Bản pristine thường vẫn còn trên đĩa: các agent trong cùng phiên dùng chung thư mục scratchpad
`/private/tmp/claude-501/<slug>/<session-id>/scratchpad/`, và lượt maker nào cũng để lại một
`*.pristine.ts` hoặc một thư mục `pristine/`. Đối chiếu sha256 với con số maker ghi trong `evidence`
để chắc đúng bản.

Ở lượt này việc đó biến một khẳng định phải tin thành một khẳng định đọc được: diff cho ĐÚNG MỘT hunk
tại dòng 325, thay khối chú thích cũ bằng khối mới, không câu lệnh nào đổi — đồng thời chứng minh
luôn yêu cầu thứ hai của prompt ("chú thích của `diagnosticsAttachment` dòng 101-110 không bị đụng")
mà không cần một phép đo riêng.

`git diff` KHÔNG thay được việc này khi tính năng trước đó chưa commit: `HEAD` ở đây còn nằm trước cả
`feat-tool-layer-core`, nên `git diff` trả về toàn bộ công việc của hai tính năng gộp lại và hunk cần
soi chìm trong đó.

## Quy tắc rút ra

Mỗi lần đọc thấy chữ CODE-IDENTICAL, hỏi "so với bản nào, bằng lệnh nào" trước khi hỏi bất cứ điều gì
khác. Một khẳng định *không có gì thay đổi* chỉ kiểm chứng được khi có bản đối chiếu; nếu không tìm ra
bản đó, hãy nói thẳng trong `checkerNotes` rằng kết luận chỉ ở mức cấu trúc, đừng để chữ
CODE-IDENTICAL đi tiếp như thể nó đã được đo.
