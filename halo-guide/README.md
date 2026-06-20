# Halo Diagnostic Skeleton — Phase-1-ready

Khung code để "logging trước (phase 1), emit SBE sau (phase 2)" mà phase 2 chỉ là **swap adapter**, không phải rewrite.

## Cây file

```
domain/diagnostic/          ① pure — KHÔNG Agrona/Aeron/SLF4J. Đây là MODEL phải FINAL từ phase 1.
  DiagnosticHeader.java       common context (giống mọi flow) — primitive-only
  DecisionPayload.java        sealed interface — phần biến thiên (tagged union)
  BuyingPowerPayload.java     payload số thuần (loại-1 code + loại-2 dựng-từ-số)
  AccountStatusPayload.java   enum code (loại-1) + TextSlot free-text (loại-3)
  TextSlot.java               byte[] bounded cho free-text — KHÔNG String
  DiagnosticAction.java
application/
  port/AuditPort.java         ★ SEAM. Phase 1 & 2 chỉ khác ở implementation của interface này
  flow/PlaceOrderFlow.java    orchestrate, capture-at-decision-point, gọi audit KHÔNG gọi log
infrastructure/audit/
  LoggingAuditPort.java       ★ PHASE 1: format + log đồng bộ. Chứa mọi // PHASE 2: markers
  ErrorCatalog.java           cold-path: code → severity + mô tả tiếng Việt (Agrona map)
cluster/
  HaloClusteredService.java   thin shell: decode + AsciiSequenceView + delegate
docs/
  logging.md                  hướng dẫn chi tiết logging (được AGENTS.md tham chiếu)
AGENTS.md                     luật coding bất biến cho agent + người
```

## Ranh giới phase (cái gì final ngay, cái gì hoãn)

| FINAL từ phase 1 (bỏ là rewrite) | Hoãn sang phase 2 (chỗ tiết kiệm công) |
|---|---|
| `DiagnosticHeader` + typed payload, **primitive-only** | `OneToOne/ManyToOneRingBuffer` |
| `TextSlot` (byte[]), KHÔNG `String`/`String[]` | SBE schema + encode/decode |
| `formulaVersion` = `short`; account/ticker = số | `AuditPublisher` thread + core affinity |
| `AuditPort` typed overload | Chronicle Queue / Logstash / ELK |
| Flow gọi `audit.record*()`, **không bao giờ `log`** | MDC, render VND `_fmt`, RuleRegistry mapping |
| `clusterTimeMs` từ param Aeron (deterministic) | drop counter + alert |

## Phase 1 → Phase 2: chính xác cái gì đổi

1. Đổi binding `AuditPort`: `LoggingAuditPort` → `RingBufferAuditPort`. **Flow không đổi dòng nào.**
2. Trong mỗi `record*()`: phần `StringBuilder + log.*` **di chuyển** (không xóa) xuống `AuditPublisher`. Adapter mới chỉ còn `tryClaim(payload.typeId(), len) → encode SBE → commit`.
3. `TextSlot`: phase 1 gọi `materialize()` (tạo String để log). Phase 2 copy `raw()[0..len]` thẳng vào SBE var-data → **không String trên cluster thread**.
4. Switch `log.info/warn/error` (trong `ErrorCatalog.severity` + `LoggingAuditPort.emit`) chuyển y nguyên sang publisher.

Tìm tất cả điểm đổi bằng: `grep -rn "PHASE 2:" .`

## Trả lời 2 câu hỏi abstraction

- **"Context mỗi flow khác nhau"** → phần GIỐNG nhau = `DiagnosticHeader` (1 class chung). Phần khác = payload.
- **"Mỗi decision result mang context khác nhau"** → đó CHÍNH LÀ lý do payload là sealed typed variant, không phải bag phẳng. Mỗi type có đúng field của nó (compile-time enforce, không lẫn).
- **Mô hình 1-record/message**: fail → return ngay ở validation đầu tiên fail → mỗi message phát đúng 1 payload (cái quyết định outcome). PASS cũng record (EXP-01).

## Free-text ("random String") — quy tắc quyết định

| Loại | Ví dụ | Cách làm |
|---|---|---|
| 1. Tập hữu hạn | account status, rule name, formula | `int`/`byte` code → text ở cold path. KHÔNG String hot path. |
| 2. Câu dựng lên | "vì sao lệnh fail" | Carry SỐ (cash, shortfall, ruleId, fv). Dựng câu ở cold path. |
| 3. Free-text từ ngoài | reason từ sàn, note downstream | `TextSlot` (byte[] bounded). Copy zero-alloc bằng `getBytes`/`AsciiSequenceView`. |

**Tại sao byte[] thay String**: String vẫn được tạo cuối cùng, nhưng dời từ **cluster thread (cấm alloc)** sang **publisher thread (được phép)**, và phase 2 đi byte→byte vào SBE không qua String trung gian.

**`AsciiSequenceView` (Agrona)**: zero-copy view lên inbound buffer, dùng ở shell. CHỈ an toàn khi tiêu thụ **đồng bộ** (buffer Aeron bị overwrite cho message sau). → luôn **copy ngay** vào `TextSlot` trong cùng lượt `onSessionMessage` để an toàn cả 2 phase. ⚠️ ASCII-only: tiếng Việt có dấu phải là loại-1 (code), hoặc dùng `byte[]` + decode UTF-8 ở cold path.

## Mục đích cuối: trả lời câu hỏi nhanh

- "Vì sao lệnh 10h fail?" → query `accountId + time` → 1 record → đọc số. Cần capture đủ inputs + ruleId + fv.
- "Vì sao pool lệch 200tr?" → **reconciliation**: cộng dồn mọi decision tác động pool. Yêu cầu: log **đầy đủ** (cả PASS) + **structured** (key=value) để aggregate được. Phase 2 (Chronicle replayable) mạnh hơn cho loại này, nhưng phase 1 structured + complete vẫn trả lời được trong hạn retention.

## Lưu ý vận hành phase 1
- Nếu lo cluster thread bị stall khi appender nghẽn: dùng **Log4j2 AsyncLogger (disruptor) + bounded queue + discard policy** (enqueue non-blocking). Vẫn sau `AuditPort` → phase 2 vẫn là swap. ("phase 1.5")
- `StringBuilder` reused không thread-safe — OK vì single-threaded per shard. Đừng share.
