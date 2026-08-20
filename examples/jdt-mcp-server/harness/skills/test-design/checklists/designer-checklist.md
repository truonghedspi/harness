# Designer Checklist — chạy TOÀN BỘ trước khi output test plan

Mục nào fail → quay lại bước tương ứng của SKILL.md sửa, rồi chạy lại từ đầu
checklist. Chỉ output khi mọi mục pass.

## D1 — Traceability & coverage
- [ ] Mọi requirement priority P0 trong spec có ≥ 1 condition tham chiếu tới.
- [ ] Mọi `requirement_id` trong plan tồn tại trong spec_refs đã khai báo.
- [ ] Không condition nào "mồ côi" — behavior không tìm được câu spec tương ứng.
      (Nếu behavior đáng test mà spec thiếu → chuyển sang `spec_gaps`, không giữ
      làm condition.)

## D2 — Phân loại shape
- [ ] Mỗi condition đúng một `behavior_shape`; không behavior nào bị ép chung
      hai shape (nếu có → đã tách).
- [ ] Không có shape `concurrent` gán cho code chạy trong single-threaded
      event loop (Aeron Cluster logic → `stateful` + deterministic_replay).

## D3 — Khớp technique với shape (tra strategy-matrix.md)
- [ ] Shape `mapping`: có ĐỦ cả condition `round_trip` VÀ `field_sensitivity`.
- [ ] Shape `stateful`: có ≥ 1 condition `property_kind: invariant`;
      nếu reference model khả thi → có condition `model_based`.
- [ ] Shape `decision`: condition `decision_table`; biểu thức boolean ≥ 3
      toán hạng → thêm condition `mcdc`.
- [ ] Shape `fixed_rule`: technique `example`, không property hóa gượng ép.
- [ ] `property_kind` hiện diện khi và chỉ khi `technique = property`.

## D4 — Chất lượng từng condition
- [ ] `behavior` là một câu kiểm chứng được (có chủ thể, hành vi, kết quả
      quan sát được) — không phải mô tả chung chung kiểu "test order book".
- [ ] `rationale` giải thích vì sao technique khớp shape — không lặp lại
      behavior.

## D5 — Spec gaps
- [ ] Mọi điểm spec mơ hồ gặp trong quá trình design đã ghi vào `spec_gaps`
      kèm cả hai cách hiểu — KHÔNG tự chọn một cách hiểu.
- [ ] Field `spec_gaps` hiện diện kể cả khi rỗng (schema bắt buộc — buộc
      Designer xác nhận đã cân nhắc).

## D6 — Ranh giới thông tin
- [ ] Toàn bộ plan sinh được mà không tham chiếu implementation body.
      Nếu trong context có implementation (do lỗi cấu hình), đã báo harness
      thay vì sử dụng.

## D7 — Schema & layout
- [ ] `plan.json` hợp lệ theo `schemas/test-plan.schema.json`; TỪNG file
      condition hợp lệ theo `schemas/test-condition.schema.json` — đủ required
      fields, đúng pattern ID, không field ngoài schema.
- [ ] Layout sharded đúng: tên file trùng `id`, `plan_id` trong mỗi condition
      trùng thư mục cha, không file nào gộp nhiều condition (R-T10).
- [ ] Mọi mutation thực hiện qua operation của harness hoặc ghi đè nguyên tử
      file shard — không text-edit cục bộ (R-T10).
