---
name: test-design
description: Sinh test plan, test conditions, property-based tests và example tests chất lượng cao từ spec — theo quy trình 5 bước với ma trận chọn chiến lược theo hình dạng logic (logic shape). BẮT BUỘC dùng skill này mỗi khi được yêu cầu viết test plan, test case, test conditions, property test, unit test, hoặc review chất lượng test — kể cả khi yêu cầu chỉ là "viết test cho class X" hay "bổ sung test để kill surviving mutants". Cũng dùng khi cần phân xử (arbitrate) test fail là do code sai, test sai hay spec mơ hồ.
---

# Test Design

Skill này định nghĩa quy trình sinh test plan và test case cho harness. Vai trò của agent
được xác định bởi harness khi giao task: **Test-Designer** (sinh test plan/conditions từ spec),
**Test-Implementer** (hiện thực hóa conditions thành test code), hoặc **Reviewer**
(thẩm định output của hai vai trò trên). Đọc phần tương ứng với vai trò được giao.

Nguyên lý nền, áp dụng cho mọi vai trò:

1. **Spec là nguồn sự thật duy nhất.** Test đo "code PHẢI làm gì" (theo spec),
   không đo "code ĐANG làm gì" (theo implementation). Test không truy vết được
   về requirement là test vô giá trị và sẽ bị harness reject.
2. **Kỹ thuật test chọn theo hình dạng logic (logic shape), không theo thói quen.**
   Phân loại behavior trước, tra ma trận chiến lược sau. Không mặc định example-based
   cho mọi thứ.
3. **Property test và example test ngang hàng nhau** — cùng là hiện thực hóa của
   test condition, mỗi loại đúng cho một hình dạng logic.
4. **Mọi output là artifact có schema.** Không output văn xuôi tự do. Output không
   pass schema validation sẽ bị trả lại kèm lỗi; sửa theo lỗi, không diễn giải lại.

---

## Ranh giới thông tin (information asymmetry) — KHÔNG ĐƯỢC VI PHẠM

| Vai trò | Được đọc | KHÔNG được đọc |
|---|---|---|
| Test-Designer | spec, interface/API signature, schema | implementation body, test code hiện có của component đang design |
| Test-Implementer | test conditions, interface, `references/`, surviving-mutant report | implementation body (trừ khi task là kill mutant — chỉ đọc đúng dòng được chỉ định) |
| Reviewer | tất cả | — |

Lý do: nếu Designer đọc implementation, test suy biến thành bản chép lại hành vi
của code — kể cả hành vi sai — và toàn bộ giá trị oracle độc lập sụp đổ. Nếu nhận
được nội dung implementation trong context mà vai trò không cho phép, dừng lại và
báo harness thay vì sử dụng nó.

---

## Quy trình 5 bước (vai trò Test-Designer)

### Bước 1 — Liệt kê behaviors từ spec

Đọc spec, tách thành danh sách behavior nguyên tử. Mỗi behavior:
- Một câu, dạng kiểm chứng được (given/when/then hoặc "X luôn/không bao giờ Y").
- Gắn `requirement_id` (định dạng `REQ-<AREA>-<NNN>`). Behavior không có
  requirement_id trong spec → ghi vào mục `spec_gaps` của test plan, KHÔNG tự bịa.
- Nếu spec mơ hồ (hai cách hiểu hợp lệ), ghi vào `spec_gaps` kèm cả hai cách hiểu.
  Không tự chọn một cách hiểu rồi đi tiếp.

### Bước 2 — Phân loại hình dạng logic (logic shape)

Với mỗi behavior, gán đúng một `behavior_shape` theo bảng nhận diện nhanh dưới đây.
Khi có dấu hiệu của nhiều shape, tách behavior nhỏ hơn cho đến khi mỗi behavior
một shape. Chi tiết nhận diện và ví dụ: đọc `references/strategy-matrix.md`.

| behavior_shape | Dấu hiệu nhận diện nhanh |
|---|---|
| `mapping` | field-to-field giữa hai representation (DTO↔SBE, entity↔message), không branch nghiệp vụ |
| `stateful` | kết quả phụ thuộc lịch sử thao tác (order book, session, FSM) |
| `computational` | công thức, làm tròn, đơn vị, tích lũy số học (fee, interest, risk metric) |
| `decision` | nhiều điều kiện kết hợp quyết định output (validation, routing, phân loại) |
| `parsing` | nhận byte/text không tin cậy từ bên ngoài |
| `concurrent` | đúng đắn phụ thuộc thread interleaving / memory visibility |
| `integration` | phối hợp nhiều component/service theo thứ tự và contract |
| `fixed_rule` | "nếu X thì đúng bằng Y" — giá trị chốt cứng, quy định pháp lý |

### Bước 3 — Tra chiến lược từ ma trận

Với mỗi `(behavior, shape)`, tra `references/strategy-matrix.md` để lấy chiến lược
chủ lực + bổ trợ, sinh một hoặc nhiều test condition. Quy tắc:
- Shape `mapping` → BẮT BUỘC có cả round-trip property và field-sensitivity
  property (template trong `references/property-catalog.md`, mục 2 và mục kèm theo).
- Shape `stateful` → BẮT BUỘC có ít nhất một invariant property trên command
  sequence; model-based property nếu spec đủ để viết reference model.
- Shape `fixed_rule` → example test, một test case cho mỗi giá trị chốt.
- Mọi requirement priority P0 → tối thiểu 1 condition. Không có ngoại lệ.

### Bước 4 — Sinh test plan theo sharded layout

Output theo layout sharded (xem mục "Artifact layout & mutation protocol"):
`plan.json` hợp lệ theo `schemas/test-plan.schema.json` + mỗi condition một
file riêng hợp lệ theo `schemas/test-condition.schema.json`. Điền `technique`
từ enum của schema, `rationale` giải thích ngắn vì sao technique khớp shape.
Tự validate từng file trước khi output (đủ required fields, đúng pattern ID,
không field lạ — schema đặt `additionalProperties: false`). Ghi qua operation
của harness, không ghi file trực tiếp (R-T10).

### Bước 5 — Tự kiểm bằng checklist

Chạy qua `checklists/designer-checklist.md` từng mục. Mục nào fail → quay lại
bước tương ứng sửa. Chỉ output khi toàn bộ checklist pass.

---

## Quy trình vai trò Test-Implementer

1. Nhận test conditions (JSON đã validate) + interface. Với mỗi condition,
   đọc đúng reference tương ứng với `technique`:
   - `property` → `references/property-catalog.md` (chọn đúng loại property
     theo `property_kind` của condition) + `references/generators.md`
   - `decision_table` → `references/decision-table.md`
   - `boundary_value`, `equivalence_partition`, `state_transition`, `example`
     → template trong `references/strategy-matrix.md`
2. Điền vào template — không sáng tác cấu trúc test mới khi template đã có.
   Stack: Java 21, JUnit 5, jqwik 1.8+, AssertJ. Test đặt tên theo behavior
   (`quantityIsConservedAcrossAnyCommandSequence`), không theo method
   (`testApply1`).
3. Mỗi test file mở đầu bằng comment khối liệt kê `condition_id` và
   `requirement_id` mà file hiện thực hóa — đây là mắt xích traceability
   mà Reviewer và harness đối chiếu.
4. Trước khi output, đối chiếu `references/anti-patterns.md` (rules R-T1…R-T9).
   Vi phạm bất kỳ rule nào → Reviewer sẽ reject kèm mã rule, nên tự sửa trước.
5. **Task kill surviving mutant:** input là mutant report (class, line, mutator).
   Xác định behavior tại dòng đó *từ spec/conditions*, viết test assert behavior
   đó. KHÔNG viết test "assert giá trị hiện tại của code" chỉ để kill mutant —
   đó là tautology hợp pháp hóa (vi phạm R-T3).
6. **Property fail → regression:** khi jqwik shrink ra counterexample, tạo thêm
   một example test cố định từ counterexample đã shrink, gắn
   `technique: regression_from_property` và giữ vĩnh viễn.

---

## Quy trình vai trò Reviewer

1. Đọc `checklists/reviewer-checklist.md` và `references/anti-patterns.md` TRƯỚC
   khi đọc artifact cần review. Review là đối chiếu checklist, không phải cảm nhận.
2. Verdict chỉ có ba giá trị: `APPROVE`, `REJECT`, `ESCALATE_SPEC`. Mỗi REJECT
   phải trích dẫn mã rule (R-T*) hoặc mục checklist cụ thể + vị trí vi phạm.
   Không reject bằng nhận xét chung chung; không approve kèm "nhưng nên…" —
   nếu có "nhưng" chặn được bug thì đó là REJECT.
3. Chống sycophancy: số lượng test lớn, coverage cao, code đẹp KHÔNG phải
   bằng chứng chất lượng. Bằng chứng duy nhất được chấp nhận: test truy vết
   về spec + không vi phạm anti-pattern + kill được mutant tương ứng.
4. **Arbitration** (khi test fail): phân loại nguyên nhân bằng cách đối chiếu
   cả code và test với spec — bên nào lệch spec bên đó sai. Nếu cả hai đều
   là cách đọc hợp lệ của spec → verdict `ESCALATE_SPEC`, trích dẫn đoạn spec
   mơ hồ và hai cách hiểu. Reviewer KHÔNG tự sửa code hay test.

---

## Artifact layout & mutation protocol

Artifact được **shard theo ID** — không bao giờ tồn tại file monolithic dài:

```
plans/TP-OB-0001/
├── plan.json                  # metadata + spec_gaps (test-plan.schema.json)
└── conditions/
    ├── TCON-OB-0001.json      # một condition = một file (test-condition.schema.json)
    └── TCON-OB-0002.json
cases/
└── TC-OB-0001.json            # metadata mỗi test case (test-case.schema.json)
```

Quy tắc bất biến: tên file trùng field `id`; `plan_id` trong condition trùng
thư mục cha; thư mục `conditions/` là nguồn sự thật về danh sách condition
(không duy trì danh sách trùng lặp trong plan.json).

Quy tắc mutation, theo thứ tự ưu tiên:
1. **Operation của harness** (khi được cấp tool): `upsert_condition`,
   `delete_condition`, `add_spec_gap`, `upsert_case`. Mỗi operation tự
   validate schema + referential integrity trước khi ghi; lỗi trả về có
   cấu trúc — sửa theo lỗi rồi gọi lại, tối đa 3 lần rồi báo harness.
2. **Ghi đè nguyên tử một file shard** (khi không có tool operation):
   regenerate TOÀN BỘ nội dung file nhỏ đó và ghi đè — không patch cục bộ.
3. **JSON Patch (RFC 6902)** — chỉ dùng làm ngôn ngữ *đề xuất* thay đổi
   trong luồng review (Reviewer đề xuất, harness áp và re-validate).

CẤM (R-T10): sửa artifact bằng string-replace/text-edit trên nội dung JSON,
hoặc output một file gộp nhiều condition.

---

## Bản đồ tài liệu

| File | Đọc khi nào |
|---|---|
| `references/strategy-matrix.md` | Bước 2–3 của Designer; Implementer cần template example-based |
| `references/property-catalog.md` | Implementer hiện thực hóa condition `technique: property`; Designer cần chọn `property_kind` |
| `references/generators.md` | LUÔN đọc kèm property-catalog — generator kém là lý do số một khiến property vô dụng |
| `references/decision-table.md` | Condition `technique: decision_table` |
| `references/anti-patterns.md` | Implementer trước khi output; Reviewer trước khi review |
| `schemas/test-plan.schema.json` | Designer, Bước 4 — validate `plan.json` |
| `schemas/test-condition.schema.json` | Designer, Bước 4 — validate từng file condition |
| `schemas/test-case.schema.json` | Implementer khi output metadata cho từng test case |
| `checklists/designer-checklist.md` | Designer, Bước 5 |
| `checklists/reviewer-checklist.md` | Reviewer, luôn luôn |
