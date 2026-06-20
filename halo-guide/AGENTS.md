# AGENTS.md — Halo Trading Platform

Hướng dẫn cho coding agent (và người) khi viết/sửa code trong repo này. **Đọc hết trước khi sửa bất kỳ thứ gì chạy trong hoặc sau `onSessionMessage()`.**

Stack: Aeron Cluster (Raft) + Java 21 + SBE + Agrona. Ràng buộc nền: **sub-millisecond latency, > 50k lệnh/giây, cluster thread single-threaded & deterministic per shard.**

### Tài liệu liên quan — đọc khi điều kiện kích hoạt đúng

- **`docs/logging.md`** — **Trước khi viết/sửa bất kỳ code logging, audit, diagnostic, hay cold-path nào, đọc file này.** Nó khai triển §4 và §7 dưới đây (format key=value, 3 loại text, `TextSlot`/`AsciiSequenceView`, byte[] vs String, migration phase 1→2, render explanation).

Quan hệ: `AGENTS.md` định nghĩa **luật bất biến** (ngắn, áp mọi task). `docs/logging.md` khai triển **cách làm** (dài, có ví dụ). Mâu thuẫn → `AGENTS.md` thắng.

---

## 0. Luật vàng

> **Mọi thứ trong `onSessionMessage()` là hot path. Trên hot path: KHÔNG allocation, KHÔNG I/O, KHÔNG nguồn non-deterministic, KHÔNG block, KHÔNG logging, KHÔNG String.**

Nếu một thay đổi vi phạm dòng trên, nó **sai** bất kể "chạy vẫn được". Vi phạm chỉ lộ ra dưới tải production (latency spike, GC pause, split-brain) — không phải lúc test.

---

## 1. Kiến trúc 4 layer — Dependency Rule

Mũi tên dependency **chỉ đi vào trong**. Domain ở tâm, không biết gì về hạ tầng.

```
domain  ←  application  ←  infrastructure
                        ←  cluster (entry point)
```

| Layer | Package | ĐƯỢC import | CẤM import |
|---|---|---|---|
| ① Domain | `com.halo.domain..` | chỉ `java.*` | **Aeron, Agrona, SLF4J, Chronicle, Spring — TẤT CẢ** |
| ② Application | `com.halo.application..` | domain, `java.*` | Aeron trực tiếp (phải qua port), Agrona |
| ③ Infrastructure | `com.halo.infrastructure..` | tất cả | — |
| ④ Cluster | `com.halo.cluster..` | tất cả | business logic (xem §6) |

**Luật:**
- R1.1 — Thêm dependency vào `domain` = **dừng lại**, gần như chắc chắn sai chỗ. Logic thuần ở domain; thứ chạm hạ tầng đặt ở infrastructure sau một port.
- R1.2 — Application chạm Aeron/Agrona **chỉ qua port interface** (`AuditPort`, `EgressPort`, `AccountStatePort`). Không import `io.aeron.*` trong application.
- R1.3 — Mỗi luật trên có ArchUnit test trong CI. Sửa code làm fail ArchUnit = sửa code, **không** sửa/nới test.

```java
// ArchUnit — đã có trong halo-archtest, KHÔNG xoá
noClasses().that().resideInAPackage("com.halo.domain..")
    .should().dependOnClassesThat()
    .resideInAnyPackage("io.aeron..", "org.agrona..", "org.slf4j..", "net.openhft..");
```

---

## 2. Hot path — zero-allocation & determinism

- R2.1 — **Không `new` trên hot path.** Object (header, payload, decoder, view) **pre-allocated, reused** per cluster thread. Verify bằng JMH `-prof gc` → mong đợi `0 B/op`.
- R2.2 — **Thời gian** lấy từ tham số `timestamp` của `onSessionMessage()` (cluster time, deterministic). **CẤM** `System.currentTimeMillis()`, `System.nanoTime()` trên hot path.
- R2.3 — **CẤM** `Math.random()`, `UUID.randomUUID()`, `ThreadLocalRandom`, đọc external state (DB/file/network), đọc clock — bất cứ thứ gì khiến hai Raft node tính ra kết quả khác nhau → **split brain, không recover được**.
- R2.4 — **Không block:** `offer()` non-blocking, không `lock`, không `Future.get()`, không `sleep`, không busy-wait.
- R2.5 — **Không autoboxing.** Dùng `org.agrona.collections` (`Int2ObjectHashMap`, `Long2LongHashMap`...) cho map có key primitive, không `HashMap<Integer,..>`.
- R2.6 — **Không String, không String concat, không `String.format`** (xem §4).
- R2.7 — `reset()` của object reused chỉ cần lo field primitive (set `len=0`, `errCode=0`). Vì model **không có reference object** (xem §3) nên không có rủi ro "sót reference khách trước".

`switch` để **route** theo `(templateId, schemaId)` **được phép** trên hot path — đó là dispatch, không phải business logic.

---

## 3. Diagnostic model — header chung + payload typed (KHÔNG bag)

Model này đã **FROZEN từ phase 1**. Sửa shape = ảnh hưởng cả phase 2 → cần review kiến trúc, không tự ý.

- R3.1 — Context **giống mọi flow** → `DiagnosticHeader` (một class chung). Context **khác nhau theo decision** → typed payload implements `sealed DecisionPayload`. **KHÔNG** nhồi tất cả vào một class phẳng.
- R3.2 — **CẤM generic bag** kiểu `int[] factorCode; long[] factorValue; String[] stringValue`. Mỗi decision type = một class với đúng field của nó (DEC-01). Thêm type mới: thêm enum entry + typed payload + SBE message + 1 case ở publisher — **không sửa class chung, không sửa ring buffer code** (DEC-03).
- R3.3 — Payload là **primitive-only**. Tiền → `long` (đơn vị đồng). Ratio → `int` bps. Trạng thái/loại hữu hạn → `byte`/`int` code. Phiên bản công thức → `short formulaVersion` (**không** `String formula`). Account/ticker → số nếu thuần số.
- R3.4 — **CẤM `String` và `String[]` trong header/payload.** Free-text dùng `TextSlot` (§4).
- R3.5 — Mô hình **1 record / message**: flow `return` ngay tại validation đầu tiên fail → mỗi message phát đúng một payload (cái quyết định outcome). **PASS cũng record** (EXP-01), không chỉ REJECT.

---

## 4. String & free-text (tóm tắt — chi tiết ở `docs/logging.md`)

> **Trước khi viết/sửa code chạm tới text, logging, audit, hay cold-path: đọc `docs/logging.md`.** Phần dưới chỉ là invariant phải nhớ ở mọi task.

- R4.1 — **CẤM `String`/`String[]` trong model** (header/payload) — xem R3.4. Free-text dùng `TextSlot` (byte[] bounded).
- R4.2 — Trước khi viết field text, **phân loại 3 loại**: (1) tập hữu hạn → `int`/`byte` code; (2) câu dựng lên → carry số, dựng ở cold path; (3) free-text từ ngoài → `TextSlot`. ~80–90% là loại 1/2 → không cần String. *(bảng + ví dụ: `docs/logging.md` §4)*
- R4.3 — **CẤM** `decoder.getXxxText()` trả `new String` trên hot path. `AsciiSequenceView` zero-copy **chỉ an toàn khi tiêu thụ đồng bộ** → **copy ngay vào `TextSlot`** trong cùng lượt `onSessionMessage`; CẤM pass view sang cold path khi chưa copy. ASCII-only — tiếng Việt phải là code (loại-1).
- R4.4 — Correlation key (username, accountNo) **đi off-heap** ở phase 2; reference String không sống off-heap → lưu `byte[]`/số, **không** String. Convert một lần ở `onSessionOpen`, cache, hot path chỉ `arraycopy`. *(lý do đầy đủ: `docs/logging.md` §5)*

---

## 5. AuditPort — seam phase 1 ↔ phase 2

`AuditPort` là **ranh giới duy nhất** giữa hai phase. Giữ nó sạch thì phase 2 là **swap adapter**, không phải rewrite.

- R5.1 — Flow gọi `audit.recordXxx(header, payload)`. Flow **KHÔNG bao giờ** gọi `log.*`, không format String, không biết SBE/Chronicle/ELK tồn tại.
- R5.2 — `AuditPort` dùng **typed overload** (`recordBuyingPower`, `recordAccountStatus`...) → dispatch tĩnh compile-time. **CẤM** `instanceof`, reflection, virtual dispatch trên dispatch path (DEC-02).
- R5.3 — Phase 1: binding = `LoggingAuditPort` (format + log đồng bộ). Phase 2: đổi binding sang `RingBufferAuditPort` (`tryClaim`/encode SBE/`commit`). **Flow không đổi một dòng.**
- R5.4 — Đoạn `StringBuilder + log.*` ở `LoggingAuditPort` khi sang phase 2 thì **di chuyển** (không xóa) xuống `AuditPublisher` (cold path) — ELK vẫn cần dòng human-readable. Đánh dấu mọi điểm này bằng comment `// PHASE 2:`. Tìm bằng `grep -rn "PHASE 2:"`.
- R5.5 — Thêm bất kỳ field nào vào model phải hỏi: "field này đi off-heap được không?" Nếu không (vd reference object) → **không** thêm vào model.

---

## 6. Capture-at-decision-point & thin shell

- R6.1 — Capture context **ngay tại điểm ra quyết định** (validator buying-power đã cầm `cash` & `required` → ghi thẳng vào payload tại đó). **CẤM** tách một `diagnose(errCode)` switch riêng đi lấy lại context — fragile, dễ quên gọi, dễ lệch case.
- R6.2 — `HaloClusteredService` (shell ④) chỉ được: **decode SBE + điền header + delegate**. **CẤM** business condition (`if/else` nghiệp vụ) trong shell (MNT-05). Toàn bộ nghiệp vụ ở application/domain.
- R6.3 — Flow nhận **primitive đã decode**, không nhận `DirectBuffer`/SBE decoder → giữ application sạch khỏi Aeron.

---

## 7. Logging (tóm tắt — chi tiết ở `docs/logging.md`)

> **Đọc `docs/logging.md` trước khi viết/sửa code logging hoặc cold-path.**

- R7.1 — Log **structured key=value** (không văn xuôi) → aggregate được (vd cộng dồn `poolId` tìm pool lệch). Tên field ổn định (= ELK field phase 2).
- R7.2 — Log **đầy đủ cả PASS lẫn REJECT** cho decision tác động state cộng dồn (pool/room) → mới reconcile.
- R7.3 — Log level theo **severity** map từ code (`ErrorCatalog`), gom một chỗ — không rải `log.info/warn/error`. `getDescription()` không bao giờ null (EXP-05).
- R7.4 — Flow **không** logging (R5.1). Mọi format String sống trong adapter (phase 1) / `AuditPublisher` (phase 2), sau `AuditPort`.

---

## 8. Testing & Definition of Done

- R8.1 — Domain & application test **không cần khởi động Aeron**: `new RiskEngine()`, `new PlaceOrderFlow(mockPort, stubRisk)`. Nếu một class cần Aeron để test → nó sai layer.
- R8.2 — Application test bằng **mock port** (`Mockito.mock(AuditPort.class)`), `InOrder` verify thứ tự gọi (record trước, reject sau).
- R8.3 — Infrastructure test với **real `OneToOneRingBuffer`**: write→read round-trip, drop khi đầy, SBE encode/decode khớp.
- R8.4 — Hot path mới/sửa → **JMH** confirm `0 B/op` (alloc) và đo overhead. Số performance phải verify bằng JMH trên hardware thật, **không** tin con số trên giấy.
- R8.5 — ArchUnit pass trong CI là điều kiện merge bắt buộc.

---

## 9. Anti-patterns — tuyệt đối tránh

- ❌ `log.info()` / `String.format()` / `new String` trong `onSessionMessage()` hay bất kỳ code path nào gọi từ đó.
- ❌ God class chứa mọi field của mọi decision; generic `factorCode[]/factorValue[]/String[]` bag.
- ❌ `String` / `String[]` trong frozen model (header/payload).
- ❌ `instanceof` chain hay virtual dispatch để phân loại decision trên hot/dispatch path.
- ❌ `System.currentTimeMillis()` / random / external read trên hot path.
- ❌ Import Aeron/Agrona vào `domain`; import Aeron trực tiếp vào `application`.
- ❌ Business `if/else` trong `HaloClusteredService`.
- ❌ `diagnose(errCode)` switch tách rời điểm quyết định.
- ❌ Pass `AsciiSequenceView` sang cold path mà chưa copy (buffer đã bị overwrite → đọc rác).
- ❌ Nới/xóa ArchUnit test để code build qua.

---

## 10. Checklist trước khi mở PR

- [ ] Không vi phạm Luật vàng (§0) ở bất kỳ code path nào từ `onSessionMessage()`.
- [ ] Không thêm dependency vào `domain`; không Aeron trực tiếp trong `application`.
- [ ] Field mới là primitive / `byte[]` / số — **không** String reference trong model.
- [ ] Text mới đã phân loại 1/2/3 đúng (§4); loại 3 dùng `TextSlot`, copy đồng bộ.
- [ ] Flow gọi `audit.record*()`, **không** gọi `log` / không format String.
- [ ] Decision type mới: enum + typed payload + SBE message + case publisher — không đụng class chung.
- [ ] Mọi điểm sẽ đổi ở phase 2 đã đánh dấu `// PHASE 2:`.
- [ ] Test domain/app chạy không cần Aeron; ArchUnit pass; JMH `0 B/op` cho hot path mới.
- [ ] PASS cũng được record (không chỉ REJECT); log structured key=value.
