# Logging Guide — Halo

> Hướng dẫn **làm logging/audit cho đúng**. Đọc file này trước khi viết/sửa bất kỳ code logging, audit, hay cold-path nào.
>
> **Nguồn sự thật cho các invariant** là `AGENTS.md` §0 (Luật vàng), §3 (model), §5 (seam `AuditPort`). File này **khai triển cách làm**, không định nghĩa lại luật. Nếu thấy mâu thuẫn, `AGENTS.md` thắng.

Bối cảnh: logging trải **cả hot path lẫn cold path**. Hot path chỉ *capture số/byte vào object reused và đẩy qua `AuditPort`*. Mọi việc format/String/I/O sống ở cold path (phase 2) hoặc trong adapter đồng bộ (phase 1).

---

## 1. Mục đích — log để trả lời câu hỏi nhanh

Mọi quyết định logging phải phục vụ hai dạng câu hỏi thực tế:

- **Câu hỏi về một decision** — "vì sao lệnh của ACC001 lúc 9:32 bị từ chối?" → query `accountId + time range` → ra một record → đọc inputs + ruleId + formulaVersion. Yêu cầu: mỗi decision capture **đủ nguyên liệu** để tái dựng lý do.
- **Câu hỏi reconciliation** — "vì sao pool/room lệch 200 triệu?" → **cộng dồn** mọi decision tác động pool đó. Yêu cầu: log **đầy đủ** (cả PASS) + **structured** (sum được) + có `poolId`/`deltaExposure`/`runningTotal`.

Hệ quả thiết kế: log **structured numerics**, không phải prose. Một câu văn xuôi "thiếu tiền" không trả lời được câu reconciliation; một dòng `key=value` có số thì có.

---

## 2. Format structured key=value

- Mỗi record một dòng, `key=value` cách nhau bởi space. Value có space → bọc `"..."`.
- Thứ tự: **header trước** (correlation keys), rồi `decision=`, rồi field payload, rồi `msg=` (explanation người đọc).
- Đặt tên field **ổn định** — vì phase 2 chúng thành ELK field name. Đổi tên = vỡ Kibana saved search.

Quy ước tên field (giữ nhất quán giữa phase 1 log và phase 2 ELK):

| Field | Nguồn | Kiểu ELK (phase 2) |
|---|---|---|
| `ts` | `header.clusterTimeMs` | date |
| `reqId` | `header.requestId` (correlationId int64) | keyword |
| `causalId` | projection cold-path (xem §6) | keyword |
| `date` | `header.tradingDate` | integer |
| `shard` | `header.shardId` | integer |
| `acct` | `header.accountId` | keyword |
| `action` | `DiagnosticAction.name(...)` | keyword |
| `decision` | `payload.typeId()` → tên | keyword |
| `rule` | `payload.ruleId` | integer |
| `err` | `header.errCode` | integer |
| `verdict` | suy từ shortfall/errCode | keyword |
| `<amount>` + `<amount>_fmt` | số raw + chuỗi VND | long + keyword |
| `msg` | explanation tiếng Việt | text |

Ví dụ dòng log phase 1:

```
ts=1710466334000 reqId=72340172838076929 date=20250315 shard=0 acct=1001 action=PLACE_ORDER
  decision=BUYING_POWER verdict=REJECT rule=1001 cash=150000000 required=178500000
  bp=170000000 bp_fmt="170,000,000 đ" shortfall=8500000 shortfall_fmt="8,500,000 đ"
  fv=7 msg="Sức mua 170,000,000 đ < lệnh 178,500,000 đ. Thiếu 8,500,000 đ sau khi trừ T0 chưa hạch toán."
```

---

## 3. Log level — map qua ErrorCatalog (một chỗ)

Không rải `log.info/warn/error` khắp code. Log level suy từ **severity** map từ `errCode`/`ruleId` trong `ErrorCatalog`, gom tại `LoggingAuditPort.emit()`:

| severity | level | ví dụ |
|---|---|---|
| `SEV_INFO` | `log.info` | success / PASS |
| `SEV_WARN` | `log.warn` | business reject (not_enough_bp, account_not_active) |
| `SEV_ERROR` | `log.error` | system error (decode fail, state corrupt) |

- `ErrorCatalog.getDescription()` / `RuleRegistry` **không bao giờ trả null** (EXP-05) — luôn có fallback `"Mã chưa đăng ký: <id>"`.
- Dùng `org.agrona.collections.Int2ObjectHashMap` cho catalog (key primitive, tránh autoboxing).
- **Lưu ý quyết định mở:** hiện severity suy từ `errCode`. Nếu một `errCode` có thể vừa là business vừa là system tùy ngữ cảnh → chuyển sang carry `byte severity` trong header (primitive, rẻ) và cập nhật quy tắc này + `AGENTS.md` R7.3.

---

## 4. Ba loại text — chi tiết & ví dụ

Trước khi viết bất kỳ field text nào, **phân loại 1/2/3**. ~80–90% là loại 1 hoặc 2 → không cần String.

### Loại 1 — tập hữu hạn → code

account status, rule name, loại lệnh, tên công thức. Carry `byte`/`int`, render ở cold path.

```java
// model: primitive
public byte accountStatus;          // ACTIVE/SUSPENDED/CLOSED/RESTRICTED
// cold path: render
AccountStatusPayload.statusName(p.accountStatus);   // "SUSPENDED"
```

### Loại 2 — câu giải thích DỰNG từ số

"vì sao lệnh fail". **Không** pre-build chuỗi trên hot path. Carry các số; dựng câu ở cold path:

```java
// cold path (LoggingAuditPort phase 1, hoặc AuditPublisher phase 2)
String msg = bp.verdict == REJECT
    ? "Sức mua " + vnd(bp.computedBuyingPower) + " < lệnh " + vnd(bp.requiredAmount)
        + ". Thiếu " + vnd(bp.shortfall) + " sau khi trừ T0 chưa hạch toán."
    : "Đủ điều kiện.";
```

### Loại 3 — free-text THẬT từ ngoài → TextSlot (byte[])

reason text từ sàn, note downstream. Dùng `TextSlot` (byte[] bounded), **không `String`**.

```java
// hot path (shell): wrap zero-copy rồi COPY NGAY trong cùng lượt onSessionMessage
noteView.wrap(inboundBuffer, decoder.noteOffset(), decoder.noteLength());
noteScratch.copyFromAscii(noteView);     // copy → sở hữu được → an toàn cả phase 2
// flow gán vào payload tại điểm quyết định
payload.externalNote.copyFrom(noteScratch);
```

Luật loại 3:
- Lấy text từ inbound SBE bằng **copy byte vào buffer reused** (`DirectBuffer.getBytes` hoặc `AsciiSequenceView`+`copyFromAscii`). **CẤM** `decoder.getXxxText()` trả `new String` trên hot path.
- `AsciiSequenceView` zero-copy **chỉ an toàn khi tiêu thụ đồng bộ** (buffer Aeron bị overwrite cho message sau) → **luôn copy ngay** trong cùng lượt `onSessionMessage`. CẤM pass view sang cold path khi chưa copy.
- `AsciiSequenceView`/`AsciiEncoding` là **ASCII-only**. Tiếng Việt có dấu → phải là loại-1 (code), hoặc `byte[]` + decode UTF-8 ở cold path. Không ép tiếng Việt qua ASCII view.

---

## 5. String đã có sẵn (username, accountNo) — byte[] hay String?

**Convert String-sẵn-có → byte[] KHÔNG gây allocation** (ghi vào buf reused). Mối lo allocation chỉ áp cho `new String` từ decode inbound, không áp cho convert chuỗi đã có.

Vấn đề thật: correlation key (username, accountNo) sẽ **đi off-heap** ở phase 2, mà **reference String không sống trong off-heap** → buộc serialize ra byte lúc encode dù sao. Vậy:

- Lưu `byte[]`/số **ngay từ đầu**, không lưu String → model đồng nhất, off-heap-ready.
- **Convert một lần ở `onSessionOpen`**, cache `byte[]` theo session (username/accountNo không đổi trong phiên); hot path chỉ `System.arraycopy`. Không convert lại mỗi message.

```java
// onSessionOpen: 1 lần / phiên
sessionCtx.accountNoBytes = toAscii(accountNoString);
// hot path: chỉ memcpy ~10 byte
header.accountNo.copyFrom(sessionCtx.accountNoBytes);
```

- accountNo thuần số → `long`. accountNo có chữ → **fixed-width `byte[]`** (vd 10 byte), không String.
- Chỉ giữ `String` reference khi cả ba: phase-1-only (không bao giờ off-heap) **và** reference cached ổn định **và** tiêu thụ đồng bộ. username/accountNo **không** thuộc diện này.

> ⚠️ Kiểm "đã có sẵn" thật chưa: nếu `order.getAccountNo()` trả `substring`/`concat` mới mỗi lần → nó đã allocate ở upstream rồi, chỉ là bạn không thấy. "Sẵn có" = reference bất biến cached.

---

## 6. Phase 1 → Phase 2 migration (logging cụ thể)

Seam là `AuditPort` (`AGENTS.md` §5). Mỗi `record*()` phase 2 co lại còn `tryClaim/encode/commit`; phần format **di chuyển** xuống `AuditPublisher`.

| Bước | Phase 1 (`LoggingAuditPort`) | Phase 2 |
|---|---|---|
| Hot path | `StringBuilder` + `log.*` đồng bộ | `tryClaim(payload.typeId(), len)` → encode SBE → `commit` |
| Format String | tại adapter (cluster thread) | tại `AuditPublisher` (cold path thread, core-pinned) |
| `TextSlot` | `materialize()` → String để log | copy `raw()[0..len]` thẳng vào SBE var-data, **không String** |
| `causalId` chuỗi | render trong adapter | render tại publisher (projection từ accountId+ticker+clusterTime+seq) |
| log level switch | `ErrorCatalog.severity` + `emit()` | **di chuyển nguyên** vào publisher |
| MDC | (không dùng phase 1) | `MDC.put("causalId")` **chỉ** ở publisher (TRC-03) |
| VND `_fmt` | `vnd(long)` trong adapter | `vnd(long)` trong publisher |

Đánh dấu mọi điểm di chuyển bằng comment `// PHASE 2:` trong code. Tìm bằng:

```bash
grep -rn "PHASE 2:" .
```

`causalId` projection (phase 2, cold path):

```java
// ACC{accountId}-{ticker}-{yyyyMMdd}-{HHmmss}-{seq}, dựng từ field đã có trong record
String causalId = CausalId.render(accountId, tickerId, clusterTimeMs, correlationId);
```

---

## 7. Vận hành phase 1

- `StringBuilder` reused trong adapter **không** thread-safe — OK vì cluster thread single-threaded per shard. **Đừng** share instance ra thread khác.
- Lo cluster thread stall khi appender nghẽn (đĩa đầy, queue đầy): dùng **Log4j2 AsyncLogger (disruptor) + bounded queue + discard policy** (enqueue non-blocking, không block khi đầy). Vẫn nằm sau `AuditPort` → phase 2 vẫn là swap. (Đây không phá determinism — logging là side-effect, không mutate replicated state — nhưng tránh được latency stall.)

---

## 8. Checklist khi sửa code logging

- [ ] Field text đã phân loại 1/2/3 đúng; loại 3 dùng `TextSlot` + copy đồng bộ.
- [ ] Không `new String` / `String.format` / `log.*` trên hot path (chỉ trong adapter/publisher).
- [ ] Log structured key=value; tên field ổn định (khớp ELK field phase 2).
- [ ] PASS cũng được record (EXP-01); decision tác động pool có `poolId`+delta+running để reconcile.
- [ ] Log level qua `ErrorCatalog.severity`, không rải `log.info/warn/error`.
- [ ] `getDescription()` có fallback, không null.
- [ ] Điểm sẽ đổi ở phase 2 đã đánh dấu `// PHASE 2:`.
- [ ] Amount có cả raw (long) lẫn `_fmt` (VND) — phase 2.
