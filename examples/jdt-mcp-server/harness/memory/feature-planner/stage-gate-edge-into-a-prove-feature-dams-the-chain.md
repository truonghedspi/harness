# Cạnh cổng-giai-đoạn trỏ vào một tính năng `prove` sẽ chặn cả chuỗi khi tính năng đó hết ngân sách

**Bối cảnh.** 2026-08-25, router dừng ở `human` với thông báo "4 feature(s) open but none routable".
Bốn tính năng `feat-tool-completion`, `feat-tool-rename`, `feat-tool-code-actions`,
`feat-tool-apply-code-action` đều `not-started`, phụ thuộc đầy đủ, không ghi chú chặn. Nguyên nhân
nằm cách đó ba mắt xích: `feat-tool-completion` phụ thuộc `feat-prove-diagnostics`, mà tính năng ấy
vừa bị checker REJECT ở lượt thứ ba và chuyển sang `blocked`. Từ đó cả chuỗi bốn tính năng — và mọi
tính năng `prove` treo sau chúng — không bao giờ định tuyến được nữa.

**Vì sao cạnh đó tồn tại.** Lần cắt đầu tiên (`DECISIONS/2026-08-20.md`) mã hoá thứ tự build của
`docs/design/tool-surface.md` thành cạnh DAG thật: mỗi tính năng tool giai đoạn sau phụ thuộc tính
năng `prove` của giai đoạn trước, để không giai đoạn nào bắt đầu khi giai đoạn trước chưa được
chứng minh. Quyết định ấy vẫn đúng. Điều nó không lường trước: một tính năng `prove` có ngân sách
`maxAttempts` hữu hạn, nên nó có thể dừng vĩnh viễn ở `blocked` mà vẫn giữ nguyên vai trò cổng.
Một tính năng `build` chỉ chặn khi chưa ai làm; một tính năng `prove` chặn cả khi đã hết đường làm.

**Cách xử lý đã dùng.** Không gỡ `blocked` của `feat-prove-diagnostics` (lý do chặn của nó có thật),
cũng không xoá cạnh cổng. Thay vào đó cắt tính năng `prove` kế nhiệm thật sự chứng minh giai đoạn
đó (`feat-prove-diagnostics-identity`) rồi chuyển cạnh sang tính năng kế nhiệm. Cổng giai đoạn được
giữ nguyên ý nghĩa, chỉ đổi người gác.

**Dấu hiệu nhận biết lần sau.** Khi router báo "none routable" mà các tính năng được nêu tên đều
sạch, đừng đọc chính chúng — đi ngược `dependencies` cho tới mắt xích `blocked` đầu tiên. Và mỗi khi
đặt một cạnh từ tính năng `build` sang một tính năng `prove` làm cổng thứ tự, hãy nhớ rằng cạnh đó
biến hạn mức `maxAttempts` của tính năng `prove` thành hạn mức của cả nhánh phía sau.
