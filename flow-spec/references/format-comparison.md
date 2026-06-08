# So sánh 3 format biểu diễn logic — demo trên cùng một flow

## 0. Ground truth (code "hệ cũ" cần tài liệu hóa)

Flow `checkout` (order-svc → payment-svc). Cố ý chứa: một guard `if/return`, **hai bước luôn chạy tuần tự vô điều kiện** (bẫy của bạn), một sync call, một `switch` có default, một state transition, một async publish, một error path.

```kotlin
// order-svc/CheckoutService.kt
fun checkout(req: CheckoutRequest): Response {
  val cart = cartRepo.load(req.cartId)              // L10
  if (cart.items.isEmpty())                          // L11  guard
      return Response(400, "EMPTY_CART")             // L12
  applyTax(cart)                                     // L14  ┐ cả hai LUÔN chạy,
  applyLoyaltyPoints(cart)                           // L15  ┘ tuần tự, vô điều kiện  ← bug-seed
  val charge = paymentClient.charge(cart.total)      // L17  sync call
  when (charge.status) {                             // L18  switch
    OK -> {
        order.status = PAID                          // L20  state transition
        eventBus.publish("order.paid", order.id)     // L21  async publish
    }
    DECLINED ->
        return Response(402, "DECLINED")             // L24
    else ->
        throw PaymentException(charge.status)        // L26  error/default
  }
  return Response(200, order)                        // L29
}
```

---

## Format A — Pseudocode 1:1 (dialect có nhãn + evidence + else/default tường minh)

```
FUNCTION checkout(req) -> Response:
  cart = cartRepo.load(req.cartId)                        // [src: CheckoutService.kt:L10]
  IF cart.items is empty [BR-001]:                         // [src: ...:L11]
    RETURN Response(400, EMPTY_CART) [OUT-1]
  ELSE: (continue)
  SEQUENCE [both always run, unconditional]:               // ← khóa bug-seed
    applyTax(cart)                                         // [src: ...:L14]
    applyLoyaltyPoints(cart)                               // [src: ...:L15]
  charge = CALL payment.charge(cart.total)                 // [src: ...:L17]
  SWITCH charge.status [BR-002]:                           // [src: ...:L18]
    CASE OK:
      order.status = PAID [STATE: *->PAID]                 // [src: ...:L20]
      PUBLISH "order.paid"(order.id) [SIDE-EFFECT: async]  // [mq: ...:L21]
    CASE DECLINED:
      RETURN Response(402, DECLINED) [OUT-2]               // [src: ...:L24]
    DEFAULT:
      RAISE PaymentException(charge.status) [OUT-3: error] // [src: ...:L26]
  RETURN Response(200, order) [OUT-4]                      // [src: ...:L29]
```

`SEQUENCE [both always run]` nói thẳng hai bước không có điều kiện → agent không thể chèn `if/return` mà không mâu thuẫn text. Mỗi nhánh có `[BR-]`, mỗi kết thúc có `[OUT-]`, mỗi dòng có evidence → lint kiểm được.

---

## Format B — BPMN (XML, đã lược, minh họa)

```xml
<process id="checkout">
  <startEvent id="start"/>
  <sequenceFlow sourceRef="start" targetRef="g_empty"/>
  <exclusiveGateway id="g_empty" name="cart empty? [BR-001]"/>
  <sequenceFlow sourceRef="g_empty" targetRef="end_empty">
    <conditionExpression>cart.items.isEmpty()</conditionExpression></sequenceFlow>
  <endEvent id="end_empty" name="400 EMPTY_CART [OUT-1]"/>
  <sequenceFlow sourceRef="g_empty" targetRef="t_tax"/>           <!-- else -->
  <!-- applyTax -> applyLoyalty: sequence THƯỜNG (KHÔNG gateway) = cả hai luôn chạy -->
  <task id="t_tax" name="applyTax"/>
  <sequenceFlow sourceRef="t_tax" targetRef="t_loyalty"/>
  <task id="t_loyalty" name="applyLoyaltyPoints"/>
  <sequenceFlow sourceRef="t_loyalty" targetRef="t_charge"/>
  <serviceTask id="t_charge" name="payment.charge"/>
  <sequenceFlow sourceRef="t_charge" targetRef="g_status"/>
  <exclusiveGateway id="g_status" name="charge.status [BR-002]"/>
  <sequenceFlow sourceRef="g_status" targetRef="t_paid">
    <conditionExpression>OK</conditionExpression></sequenceFlow>
  <task id="t_paid" name="status=PAID; publish order.paid"/>
  <sequenceFlow sourceRef="t_paid" targetRef="end_ok"/>
  <endEvent id="end_ok" name="200 [OUT-4]"/>
  <sequenceFlow sourceRef="g_status" targetRef="end_declined">
    <conditionExpression>DECLINED</conditionExpression></sequenceFlow>
  <endEvent id="end_declined" name="402 [OUT-2]"/>
  <sequenceFlow sourceRef="g_status" targetRef="end_err"/>        <!-- default -->
  <endEvent id="end_err" name="PaymentException [OUT-3]"><errorEventDefinition/></endEvent>
</process>
```

Bẫy bị chặn ở mức ý niệm: muốn "chọn một" phải đặt `exclusiveGateway`; để tuần tự "cả hai chạy" thì chỉ nối `sequenceFlow` — không thể nhầm. NHƯNG: ~25 dòng cho 1 flow nhỏ; `applyTax`/`applyLoyalty` thành task hộp đen (không thấy bên trong có điều kiện hay không); boolean chi tiết tan thành chuỗi `conditionExpression`. Bù lại: render được thành sơ đồ đẹp cho người, validate được bằng XSD/engine.

---

## Format C — srcML / AST-XML (đã lược, minh họa)

```xml
<function><name>checkout</name><block>
  <decl><name>cart</name><init>cartRepo.load(req.cartId)</init></decl>
  <if_stmt><if><condition>cart.items.isEmpty()</condition>
    <block><return>Response(400,"EMPTY_CART")</return></block></if></if_stmt>
  <expr_stmt><call>applyTax(cart)</call></expr_stmt>
  <expr_stmt><call>applyLoyaltyPoints(cart)</call></expr_stmt>
  <decl><name>charge</name><init>payment.charge(cart.total)</init></decl>
  <switch><condition>charge.status</condition>
    <case><expr>OK</expr><block>
      <expr_stmt>order.status=PAID</expr_stmt>
      <expr_stmt><call>eventBus.publish("order.paid",order.id)</call></expr_stmt></block></case>
    <case><expr>DECLINED</expr><block><return>Response(402,"DECLINED")</return></block></case>
    <default><block><throw>PaymentException(charge.status)</throw></block></default>
  </switch>
  <return>Response(200,order)</return>
</block></function>
```

Chính xác tuyệt đối, cấu trúc AST không mất gì, schema cực chặt. Nhưng người gần như không đọc nổi; verbose nhất; nhãn nghiệp vụ/evidence phải gắn gượng vào attribute; thực chất là *sản phẩm máy sinh*, không phải thứ người (hay Claude) ngồi viết tay đáng tin.

---

## Chấm điểm (1–5, càng cao càng tốt; trọng số nghiêng về ưu tiên của bạn)

| Tiêu chí | Trọng số | A. Pseudocode 1:1 + lint | B. BPMN (XML) | C. srcML/AST-XML |
|---|---|---|---|---|
| Chống sót nhánh (agent) | ×3 | 5 | 4 | 5 |
| Phân biệt tuần-tự vs loại-trừ (bug của bạn) | ×3 | 5 | 5 | 5 |
| Replicate sát code (logic chi tiết) | ×3 | 5 | 2 | 5 |
| Hợp sinh test (map ra branch/path) | ×2 | 4 | 3 | 3 |
| Người đọc hiểu nghiệp vụ | ×2 | 5 | 5 (bản render) | 1 |
| Độ tin khi agent **viết ra** format | ×3 | 5 | 2 | 2 |
| Validate bằng máy (schema/lint) | ×2 | 4 (nhờ lint) | 5 | 5 |
| Chi phí token / verbosity | ×1 | 5 | 2 | 1 |
| Tooling / render cho người | ×1 | 2 | 5 | 3 |
| **Tổng có trọng số (max 100)** | | **93** | **70** | **78** |

Cách tính: tổng (điểm × trọng số). A=93, C=78, B=70.

### Vì sao A thắng dù C "chính xác" hơn về AST
- Bug của bạn là **viết logic dưới dạng rule-list**, không phải thiếu độ chính xác AST. A đã chặn bug bằng cấu trúc tuần tự tường minh + nhãn `SEQUENCE`, nên không cần xuống tận AST.
- Khâu yếu nhất trong migration **không phải agent *đọc* format, mà là tác giả spec (Claude chạy skill) *viết* format đúng**. XML lồng sâu (B, C) dễ malformed, tốn token; pseudocode thì LLM viết sạch và in-distribution → A ăn đậm ở "độ tin khi viết ra".
- C chính xác nhưng người không đọc được (mục tiêu thứ 3 của bạn) và rất khó dùng để sinh test ở mức ý nghĩa.

### Vai trò còn lại của B (BPMN)
B kém ở *logic chi tiết trong service* nhưng **vô địch ở tầng orchestration xuyên service**: gateway ép bạn chọn XOR/parallel/sequence → bug tuần-tự-thành-loại-trừ bất khả thi, lại render sơ đồ cho người. → Dùng B làm *companion* cho bức tranh cross-service, không làm canonical của logic chi tiết.

### C (srcML/AST-XML)
Không khuyến nghị làm canonical: nó là *intermediate máy sinh*, không phải spec người/agent bảo trì.

---

## Kết luận
**Canonical = Format A (pseudocode 1:1 + lint cưỡng chế).** **Companion = BPMN** (render) chỉ cho sơ đồ orchestration xuyên service. Bỏ C.

## Lint cưỡng chế (chặn output nếu fail) — các luật
1. Mỗi `IF` phải có `ELSE` tường minh (kể cả `ELSE: (continue)`).
2. Mỗi `SWITCH/WHEN` phải có `DEFAULT`.
3. Mỗi điểm rẽ nhánh phải có nhãn `[BR-xxx]`; mỗi điểm kết thúc phải có `[OUT-x]`.
4. Nhóm bước chạy không điều kiện phải bọc `SEQUENCE [...]` hoặc `PARALLEL [...]` — cấm để trần dễ bị suy diễn thành điều kiện.
5. Mỗi dòng phi-điều-khiển phải có evidence tag, hoặc bị đẩy sang §15.
6. Mỗi `CALL ... -> r` phải có nhánh tiêu thụ `r` (hoặc `IGNORE r` tường minh) — chống bỏ quên nhánh lỗi của call.
7. Branch reconciliation: số `[BR-]` phải khớp số điều kiện đếm được ở Phase trích cơ học; lệch → fail.
