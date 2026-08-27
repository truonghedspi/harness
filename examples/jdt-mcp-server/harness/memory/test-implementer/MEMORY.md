# Test implementer memory — JDT MCP Server

Index of what the test-implementer agent has learned across runs (`harness/docs/reference/agent-memory.md`
documents the schema and why). One line per entry, always loaded — keep it short; the reasoning
lives in the linked file, read that only when the line looks relevant.

Write a new entry when a test could not be made to fail red for a non-obvious reason, when a
generator produced useless inputs until it was fixed, or when a mutant survived a test that looked
sufficient. Don't write one for a routine red-green cycle.

Write entries and hooks **in English**, whatever language the rest of the project uses: memory is
addressed to whichever agent reads it next, not to this project's readers. Entries already written
in another language stay as they are — this governs what gets written from now on.

<!-- - [Title](slug.md) — one-line hook -->
- [Behavioral red requires a callable seam](behavioral-red-requires-callable-seam.md) — Do not scaffold an integration oracle before its dependency interfaces exist; missing-module red is not behavioral evidence.
- [Mutant-kill oracle inverts red-first](mutant-kill-oracle-inverts-red-first.md) — A `prove` feature naming a surviving mutant must be green on clean source; the red run comes from temporarily applying that named mutant, then reverting.
- [Một mutant cho mỗi điều kiện](mutant-per-condition-proves-discrimination.md) — Tính năng `prove` có phụ thuộc đã done thì xanh ngay; phải tự dựng mỗi chế độ hỏng của falsifier thành một mutant để chứng minh từng điều kiện bắt đúng chế độ riêng.
- [Chốt chặn nằm trong vùng đột biến](chot-chan-nam-trong-vung-dot-bien.md) — Với mutant đảo thứ tự, deferred đặt trong một trong hai câu lệnh phát ra ở hai thời điểm khác nhau; fixture sau chốt chặn phải hợp lệ dưới cả hai thứ tự, chỉ khẳng định mới được phân biệt.
- [Một fixture hai loại bằng chứng](mot-fixture-hai-loai-bang-chung.md) — Khi một fixture vừa giết mutant vừa phơi lỗi thật, đo mutant lần nữa TRÊN bản đã sửa; chỉ lượt đó mới phân biệt được từng điều kiện.
- [Fixture ghi fragment song song tự buộc tội subject](fixture-ghi-fragment-song-song-tu-buoc-toi-subject.md) — Fixture dựng hazard framing phải tuần tự hoá theo từng message; trộn byte của hai message là lỗi của fixture, không phải vi phạm của subject.
- [Độ lệch phải vượt bề rộng token](do-lech-phai-vuot-be-rong-token.md) — Fixture đếm sai chỉ có răng khi độ lệch lớn hơn bề rộng token được hỏi; lệch trong token bị subject hút về đúng symbol và mutant sống sót.
- [Hook after chạy theo thứ tự đăng ký](hook-after-chay-theo-thu-tu-dang-ky.md) — `t.after` của node:test là FIFO, nên `rmSync` đăng ký trước `pool.close` xoá thư mục lúc tiến trình con còn sống và treo cả tiến trình test.
