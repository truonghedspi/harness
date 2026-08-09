# Reviewer Checklist

Verdict: `APPROVE` | `REJECT` | `ESCALATE_SPEC`. Mỗi REJECT trích mã rule (R-T*)
hoặc mã mục checklist (V*) + vị trí cụ thể. Không nhận xét chung chung. Không
"approve nhưng nên sửa" — nếu điều "nên sửa" chặn được bug thì là REJECT.

Nhắc lại nguyên tắc anti-sycophancy: số lượng test, coverage %, code gọn đẹp,
và giọng điệu tự tin của Implementer KHÔNG phải bằng chứng. Bằng chứng duy nhất:
traceability về spec + không vi phạm R-T* + kill được mutant tương ứng.

## V1 — Review test plan (output của Designer)
- [ ] Chạy lại toàn bộ `checklists/designer-checklist.md` với tư cách bên thứ ba.
- [ ] Đối chiếu xác suất bỏ sót: chọn ngẫu nhiên 3 requirement P0/P1 trong spec,
      kiểm tra chúng có condition — cách rẻ để phát hiện Designer đọc sót spec.
- [ ] `spec_gaps` hợp lý: mở spec tại `location` từng gap, xác nhận gap là thật.
      Gap "bịa" để né việc design cũng là lỗi.
- [ ] Layout & mutation: artifact đúng sharded layout, mutation qua operation
      hoặc ghi đè nguyên tử file shard, referential integrity nguyên vẹn
      (plan_id ↔ thư mục, id ↔ tên file, condition_id được case tham chiếu
      tồn tại) — vi phạm → REJECT kèm R-T10.

## V2 — Review test code (output của Implementer)
- [ ] Đối chiếu TỪNG rule R-T1…R-T9 trong `references/anti-patterns.md`,
      dùng bảng tra nhanh triệu chứng. Trích mã rule khi reject.
- [ ] Mỗi test file có comment khối `Conditions | Requirements`; mỗi condition_id
      trong metadata tồn tại trong test plan đã approve.
- [ ] Test hiện thực hóa ĐÚNG behavior của condition — đọc lại câu `behavior`,
      đối chiếu assertion. Test đúng kỹ thuật nhưng assert behavior khác là REJECT.
- [ ] Property test: generator thỏa G1–G4 (`references/generators.md`).
      Kiểm cụ thể: miền price có hẹp đủ để match? cancel có theo local index?
      biên nghiệp vụ có được trộn tường minh?
- [ ] Field-sensitivity: enum `Field` liệt kê ĐỦ mọi field của message —
      đếm field trong schema/SBE XML, so với enum. Thiếu field nào, lỗ hổng
      đúng bằng field đó.
- [ ] Model-based: xác nhận reference model đến từ nguồn độc lập (người viết
      hoặc task riêng), không nằm trong cùng diff với engine.

## V3 — Đối chiếu gate output (khi có)
- [ ] PIT report: surviving mutant trong vùng diff → REJECT kèm danh sách
      mutant, trừ khi Implementer đã đánh dấu equivalent-mutant có giải trình
      và Reviewer đồng thuận từng con.
- [ ] Test mới thêm có kill được mutant nó nhắm tới không (task kill-mutant) —
      xem report trước/sau.
- [ ] Không test nào bị disable/`@Disabled`/comment-out để "cho xanh".

## V4 — Audit ranh giới thông tin
- [ ] Đọc log file-access của Designer/Implementer (harness cung cấp):
      không truy cập nào ngoài allowlist của vai trò. Vi phạm → REJECT toàn bộ
      artifact bất kể chất lượng, vì oracle độc lập đã hỏng.

## V5 — Arbitration (khi có test fail cần phân xử)
Quy trình cố định:
1. Trích câu spec liên quan (verbatim, kèm vị trí).
2. Đối chiếu hành vi code với câu spec → code khớp hay lệch?
3. Đối chiếu assertion của test với câu spec → test khớp hay lệch?
4. Kết luận:
   - Code lệch, test khớp → verdict lỗi code, định tuyến Coder, đính kèm
     trích spec + counterexample (kèm seed jqwik nếu là property).
   - Test lệch, code khớp → verdict lỗi test, định tuyến Test-Implementer,
     nêu rule/điểm lệch.
   - Cả hai đều là cách đọc hợp lệ của spec → `ESCALATE_SPEC`, trích đoạn
     mơ hồ + hai cách hiểu. KHÔNG tự chọn.
5. Reviewer không sửa code, không sửa test — chỉ phân loại, trích dẫn, định tuyến.
6. Cùng một failure quay lại vòng thứ 3 chưa hội tụ → dừng, escalate người.
