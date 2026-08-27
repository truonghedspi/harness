# Feature-planner memory — JDT MCP Server

Index of what the feature-planner has learned across planning passes for this project
(`harness/docs/reference/agent-memory.md` documents the schema and why). One line
per entry, always loaded — keep it short.

Write a new entry when a feature you sized turned out wrong mid-project (too big, wrongly cut, a
dependency you missed) and the reason wasn't obvious from `harness/docs/reference/feature-decomposition.md`
alone — something specific to how *this* project's requirements are shaped. Don't write one for a
routine re-plan; that's expected, not a lesson.

Write entries and hooks **in English**, whatever language the rest of the project uses: memory is
addressed to whichever agent reads it next, not to this project's readers. Entries already written
in another language stay as they are — this governs what gets written from now on.

<!-- - [Title](slug.md) — one-line hook -->

- [Một cổng được khai báo không có nghĩa là đã có ai sở hữu đầu nối](port-declared-but-connector-unowned.md) — component khai `interface` cổng trong tệp của chính nó là ranh giới đúng, nhưng nếu không tính năng nào sở hữu lớp triển khai cổng thì đó là scope chưa có chủ; grep tên cổng trên `src/`, chỉ một tệp nhắc tới là cổng đang treo.
- [Một mutant thứ tự chỉ tương đương khi cả kẻ kế nhiệm cũng không quan sát được](equivalent-mutant-claims-need-the-successor-check.md) — tài nguyên dọn dẹp khoá theo identity (hash của root) chứ theo thế hệ tiến trình thì luôn còn người quan sát thứ hai là workspace kế nhiệm; chép `src/` ra thư mục nháp, vá mutant, chạy probe thay vì kết luận bằng đọc.
- [Cạnh cổng-giai-đoạn trỏ vào một tính năng `prove` sẽ chặn cả chuỗi khi tính năng đó hết ngân sách](stage-gate-edge-into-a-prove-feature-dams-the-chain.md) — router báo "none routable" mà các tính năng được nêu tên đều sạch thì đi ngược `dependencies` tới mắt xích `blocked` đầu tiên; cạnh build→prove làm cổng thứ tự biến `maxAttempts` của tính năng `prove` thành hạn mức của cả nhánh phía sau.
- [Một oracle viết sẵn không thể quay lại lớp oracle sau khi đã có evidence](pre-authored-oracle-cannot-return-to-oracle-layer.md) — tính năng `prove` có `evidence` không rỗng thì router chỉ còn đưa cho maker, mà maker bị cấm sửa test: phải tự ghi quyền sửa có giới hạn vào entry, hoặc cắt tính năng oracle mới.
