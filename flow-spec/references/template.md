# Flow Spec Template

Copy this structure for the output document. Fill every section from the verified inventory; attach evidence to every rule, branch, step, and side effect. Use `Không áp dụng` for sections that don't apply and `Chưa xác định — xem §15` for things the sources don't reveal. Write the body in the team's working language (default Vietnamese); keep the section numbering.

Confidence markers: ✅ Confirmed · 🟡 Inferred (state basis) · ❓ Unknown (→ §15).

---

# Flow Spec: <Tên luồng>

## 0. Metadata
- **ID / version / status**: FS-XXX / v1.0 / draft | verified
- **Author / date**:
- **Services in scope**: <svc-A, svc-B, …>
- **Out of scope**: <những gì cố tình loại trừ>
- **Source inventory** (mọi nguồn đã đọc):
  - Code: <repo/path …>
  - Docs: <link …>
  - DB: <migration/schema files …>
  - Config/Infra/MQ: <files, topics …>
- **Overall confidence**: ✅ / 🟡 / ❓ + một câu lý do

## 1. Business context (cho người đọc)
- **Mục đích nghiệp vụ**: vấn đề gì được giải quyết. `[evidence]`
- **Actor / trigger**: ai/cái gì khởi động (API call / cron / consumed event / user action). `[evidence]`
- **Khi nào / tần suất**:
- **Kết quả nghiệp vụ mong đợi**: outcome khi thành công.
- **Phạm vi**: ranh giới luồng (in/out), nêu rõ điểm bắt đầu và kết thúc.

## 2. Glossary / Domain terms
| Thuật ngữ | Ý nghĩa | Nguồn |
|---|---|---|
| | | `[evidence]` |

## 3. Services & communication map
| Service | Vai trò / trách nhiệm | Repo/path | Giao tiếp với | Kiểu (sync REST/gRPC, async event/MQ) |
|---|---|---|---|---|
| | | | | `[evidence]` |

## 4. Contract: Input / Output / Pre & Post conditions
- **Input**: trường, kiểu, bắt buộc?, nguồn dữ liệu. `[evidence]`
- **Output**: trường trả về theo từng outcome. `[evidence]`
- **Preconditions**: điều kiện phải đúng trước khi chạy. `[evidence]`
- **Postconditions**: trạng thái được đảm bảo sau khi chạy (theo từng outcome). `[evidence]`

## 5. Main flow — happy path
Numbered steps. Each step: hành động · service/component · evidence.
1. <bước> — <service> — `[evidence]`
2. …

## 6. Logic — pseudocode canonical  ⟵ NƠI CHỨA LOGIC (không dùng bảng)
Biểu diễn toàn bộ control flow bằng pseudocode dialect (xem `references/pseudocode-dialect.md`). Đây là "hợp đồng" mà hệ mới phải khớp 1:1. Mỗi service một `FUNCTION`. Bắt buộc qua lint trước khi xuất.

```pseudocode
FUNCTION <entry>(...) -> ...:
  ...  // mỗi điều kiện có [BR-xxx], mỗi outcome có [OUT-x], mỗi dòng có evidence
```

### 6b. Branch registry (PHÁI SINH từ §6 — chỉ để map test ↔ migration)
Không chứa logic; chỉ là chỉ mục từ pseudocode ra ngoài.

| ID | Điều kiện (tóm tắt) | Họ nhánh | Outcome(s) | Conf | Nguồn |
|---|---|---|---|---|---|
| BR-001 | | business/validation/error/state | OUT-x | ✅ | `[src: …]` |

## 7. Business rules
| ID | Quy tắc (ngôn ngữ nghiệp vụ) | Nhánh liên quan | Conf | Nguồn |
|---|---|---|---|---|
| RULE-001 | | BR-00x | ✅ | `[evidence]` |

## 8. Validation rules
| Trường / điều kiện | Quy tắc | Hành vi khi vi phạm (lỗi gì) | Conf | Nguồn |
|---|---|---|---|---|
| | | | | `[evidence]` |

## 9. Error & exception handling
| Lỗi / exception | Điều kiện kích hoạt | Cách xử lý (retry/rollback/compensate/propagate) | Kết quả trả ra | Conf | Nguồn |
|---|---|---|---|---|---|
| | | | | | `[evidence]` |

## 10. State transitions  (nếu có trạng thái)
| Từ trạng thái | Sự kiện / điều kiện | Sang trạng thái | Side effect | Conf | Nguồn |
|---|---|---|---|---|---|
| | | | | | `[evidence]` |

(Kèm Mermaid `stateDiagram-v2` ở §14 nếu có.)

## 11. External integrations & side effects  ⟵ nguồn chính cho migration
| Tương tác | Khi nào | Target / payload | Idempotency | Retry / timeout | Khi thất bại | Conf | Nguồn |
|---|---|---|---|---|---|---|---|
| HTTP/gRPC/DB write/event publish/consume | | | | | | | `[evidence]` |

## 12. Data & persistence
| Bảng / collection | Trường chính | Thao tác (read/insert/update/delete) | Transaction / isolation | Conf | Nguồn |
|---|---|---|---|---|---|
| | | | | | `[db: …]` |

## 13. Cross-cutting concerns (chỉ ghi cái có bằng chứng)
Auth/authz · idempotency keys · timeouts · concurrency/locking · transactions/saga · rate limit · logging/audit · feature flags. Mỗi mục: mô tả + `[evidence]` hoặc `Chưa xác định`.

## 14. Diagrams (companion — phải khớp §6)
- **BPMN orchestration** (cho luồng xuyên service; gateway phải khớp nhánh §6 — XOR=chọn một, parallel=chạy cùng, sequence=chạy cả hai tuần tự):
```xml
<process id="..."> ... </process>
```
- **Flowchart** (Mermaid, đầy đủ nhánh):
```mermaid
flowchart TD
```
- **Sequence** (xuyên service):
```mermaid
sequenceDiagram
```
- **State** (nếu có):
```mermaid
stateDiagram-v2
```

## 15. Assumptions, open questions & gaps  ⟵ chống bịa
- **Giả định** (🟡): <giả định> — cơ sở: <…>
- **Câu hỏi mở** (❓ — cần người xác nhận): <câu hỏi>
- **Code/path chưa truy được**: <vị trí/lý do>
- **Xung đột giữa các nguồn**: <code nói X `[src]`, doc nói Y `[doc]` — coi code là chuẩn runtime, doc có thể stale>

## 16. Traceability & coverage
- **Lint status**: `lint_pseudocode.py` trên §6 phải PASS (0 errors). Dán dòng kết quả.
- **Branch reconciliation**: số điều kiện đếm được trong code = N ; số `[BR-]` trong §6 = M. Chạy lint với `--expected-branches N`; phải khớp.
- **Per-family count**: business/validation = … · error/exception = … · external = … · state = …
- **Matrix**: mỗi RULE/BR/side effect ↔ vị trí nguồn (đã nhúng ở pseudocode & bảng; tổng hợp ở đây nếu cần).

## 17. Downstream readiness checklists

### A. Cho migration (AI agent)
- [ ] Mỗi RULE có tiêu chí chấp nhận (acceptance criteria) rõ ràng
- [ ] Mỗi side effect ở §11 đủ thông tin để tái tạo (target, payload, idempotency, retry, failure)
- [ ] Mọi contract input/output (§4) đầy đủ
- [ ] Mọi ràng buộc DB (§12) được liệt kê
- [ ] Open questions (§15) đã được giải quyết hoặc đánh dấu "migrate as-is, cần xác nhận"

### B. Cho test plan / test case (AI agent)
- [ ] Mỗi BR-ID ở §6 có ≥1 case positive + ≥1 case negative
- [ ] Mỗi error path ở §9 có ≥1 case
- [ ] Mỗi state transition ở §10 có ≥1 case (kể cả transition không hợp lệ)
- [ ] Mỗi validation rule ở §8 có case biên (boundary)
- [ ] Mỗi external integration ở §11 có case success + case failure/timeout

### C. Cho người đọc
- [ ] §1 nêu rõ outcome nghiệp vụ
- [ ] Diagrams (§14) khớp với phần text
- [ ] §15 không rỗng (luồng legacy thật luôn có điểm chưa chắc)
