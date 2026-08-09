# Anti-Patterns — rules R-T1…R-T9

Mỗi rule có mã số để Reviewer trích dẫn khi REJECT. Implementer tự đối chiếu
trước khi output. Mỗi rule gồm: phát biểu, lý do, cách phát hiện (máy móc được
càng tốt), ví dụ vi phạm.

---

**R-T1 — Fixture/generator của mapping test phải pairwise-distinct.**
Mọi field của base object mang giá trị đôi một khác nhau.
*Lý do:* hai field trùng giá trị làm phép hoán field vô hình — field-sensitivity
và recursive comparison đều mù.
*Phát hiện:* generator có `.filter(x -> x.allFieldValuesPairwiseDistinct())`
hoặc fixture có assertion distinct trong factory; thiếu → vi phạm.
*Vi phạm điển hình:* `price = 100, stopPrice = 100`; `symbol = "VNM",
isinCode = "VNM"` (placeholder lười).

**R-T2 — Test của shape `mapping` phải so sánh toàn bộ object.**
Dùng `usingRecursiveComparison()` (hoặc equals của record phủ đủ field).
Cấm assert một tập con field "quan trọng".
*Lý do:* bug hoán/bỏ quên field sống ở đúng những field không được assert.
*Phát hiện:* mapper test có chuỗi `assertThat(x.getA())...` field lẻ mà không có
recursive comparison → vi phạm.

**R-T3 — Expected value không được tính bằng logic đang test (tautology).**
Expected tính tay từ spec (kèm comment phép tính), từ reference model độc lập,
hoặc là quan hệ metamorphic. Cấm gọi lại production code (hoặc copy công thức
của nó) để tạo expected.
*Lý do:* code sai → expected sai giống hệt → test vĩnh viễn xanh.
*Phát hiện:* expected side của assertion gọi cùng class/method đang test, hoặc
lặp lại nguyên văn công thức của implementation.
*Lưu ý mutant-killing:* viết test "assert giá trị hiện tại code trả về" chỉ để
kill mutant là R-T3 dạng tinh vi — behavior phải truy về spec/condition.

**R-T4 — Assertion phải chạm kết quả thật, không dừng ở mock.**
`verify(mock).someCall()` chỉ được là bổ trợ cho contract tương tác; test không
có assertion nào trên state/return/event thật → vi phạm.
*Lý do:* test chỉ verify mock khẳng định "code gọi hàm", không khẳng định
"kết quả đúng" — mọi mutant trong logic thật sống sót.
*Phát hiện:* test body chỉ có `verify(...)`/`verifyNoMoreInteractions` mà không
có `assertThat` trên output.

**R-T5 — Cấm test không assertion hoặc assertion rỗng nghĩa.**
`assertDoesNotThrow`, `assertNotNull(result)` đơn độc, hoặc gọi method rồi kết thúc.
Ngoại lệ duy nhất: shape `parsing` với property "không crash trên input dị dạng" —
và khi đó phải kèm assertion "reject có kiểm soát" (outcome/error code cụ thể).

**R-T6 — Test không truy vết được về requirement bị reject tự động.**
Mỗi test file có comment khối `Conditions: ... | Requirements: ...`; mỗi test
case metadata có `requirement_id` tồn tại trong spec registry.
*Lý do:* đây là chốt chặn "test đo code làm gì thay vì code phải làm gì".

**R-T7 — Cấm nguồn không tất định trong test và generator.**
Không `Instant.now()`, `System.currentTimeMillis()`, `new Random()`,
`Thread.sleep` để "đợi cho ổn định", không phụ thuộc thứ tự chạy test khác.
Clock đi qua `Clock` injectable; ngẫu nhiên đi qua jqwik.
*Lý do:* flaky test phá hoại gate — fail không tái lập được thì arbitration bất khả.

**R-T8 — Property phải có generator thỏa G1–G4** (xem `references/generators.md`).
Đặc biệt: command-sequence property dùng generator toàn miền không va chạm
(price toàn dải long, cancel bằng ID ngẫu nhiên) → vi phạm G1 → REJECT.

**R-T9 — Test không được nhìn implementation để chọn case.**
Case sinh từ spec/conditions. Comment kiểu "cover nhánh else ở dòng 142" là
bằng chứng Designer/Implementer đã đọc body → vi phạm ranh giới thông tin.
Ngoại lệ: task kill-mutant được biết (class, line, mutator) nhưng behavior
assert vẫn phải trích từ spec.

**R-T10 — Cấm sửa artifact JSON bằng text-edit; mutation qua operation hoặc ghi đè nguyên tử file shard.**
Artifact (plan.json, condition, case metadata) chỉ được thay đổi bằng:
(1) operation của harness (`upsert_condition`…), (2) regenerate + ghi đè toàn bộ
một file shard, hoặc (3) JSON Patch trong luồng review do harness áp.
*Lý do:* string-replace trên JSON dài có anchor không duy nhất, tạo file hỏng
dở dang giữa hai lần edit, và né tránh tầng validation — phá vỡ nguyên tắc
"buộc phải parse" ở chiều ghi.
*Phát hiện:* diff cho thấy sửa cục bộ giữa file JSON (thay một giá trị giữa
file lớn), file gộp nhiều condition, hoặc JSON không parse được sau edit.

---

## Bảng tra nhanh cho Reviewer

| Triệu chứng trong diff | Rule nghi vấn |
|---|---|
| Fixture nhiều field cùng `100`, `"TEST"`, `1L` | R-T1 |
| Mapper test assert 3/12 field | R-T2 |
| Expected = `calculator.fee(...)` hay công thức copy | R-T3 |
| Test body toàn `verify(...)` | R-T4 |
| `assertDoesNotThrow` trần | R-T5 |
| Không có comment Conditions/Requirements | R-T6 |
| `Instant.now()`, `sleep(50)` | R-T7 |
| `Arbitraries.longs()` cho price, cancel bằng random ID | R-T8 |
| Comment nhắc line number / branch của implementation | R-T9 |
| Diff sửa cục bộ giữa file JSON, file gộp nhiều condition | R-T10 |
