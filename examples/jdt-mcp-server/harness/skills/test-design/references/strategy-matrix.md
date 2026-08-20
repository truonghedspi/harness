# Strategy Matrix — chọn kỹ thuật test theo hình dạng logic

Nguyên lý: kỹ thuật test không chọn theo sở thích mà theo **hình dạng của logic**
(shape of logic). Mỗi shape có một lớp bug đặc trưng, và mỗi kỹ thuật được thiết kế
để bắt đúng một lớp bug. Áp kỹ thuật sai shape → test xanh nhưng mù.

Phân loại ở mức **behavior**, không phải mức class. Một class thực tế thường chứa
2–3 shape (một mapper có thể chứa cả decision logic cho conditional field) —
tách behavior nhỏ đến khi mỗi behavior một shape.

---

## Bảng ma trận đầy đủ

| Shape | Lớp bug đặc trưng | Chiến lược chủ lực | Chiến lược bổ trợ | Gate liên quan |
|---|---|---|---|---|
| `mapping` | hoán field, bỏ quên field, sai offset/encoding | field-sensitivity property + round-trip property | recursive comparison với distinct-valued fixture | PIT `EXPERIMENTAL_MEMBER_VARIABLE` |
| `stateful` | state corruption sau chuỗi thao tác hiếm, sai thứ tự ưu tiên | model-based property (reference model) + invariant trên command sequence | state-transition table cho FSM có spec rõ | jqwik shrinking → regression |
| `computational` | sai làm tròn, sai đơn vị, overflow, sai dấu ở biên | property đại số (đơn điệu, cộng tính, chặn) + differential với reference implementation | boundary value trên miền số (0, ±1 tick, MAX) | PIT math/conditional mutators |
| `decision` | thiếu nhánh, sai điều kiện kết hợp, rule che khuất rule | decision table, cover đủ mọi cột | MC/DC cho biểu thức boolean ≥ 3 điều kiện | PIT conditional boundary |
| `parsing` | crash/hang trên input dị dạng, chấp nhận input phải reject | round-trip property + property "không crash, chỉ reject có kiểm soát" | fuzzing (jazzer) chạy nightly | — |
| `concurrent` | race, visibility, reordering | jcstress cho memory-model concern; deterministic replay cho cluster/single-writer logic | invariant check sau mỗi replay | jcstress trong nightly |
| `integration` | sai contract giữa component, sai thứ tự orchestration | contract test + E2E theo kịch bản nghiệp vụ end-to-end | state-transition ở mức business process | — |
| `fixed_rule` | sai giá trị chốt (phí, ngưỡng pháp lý) | example test truyền thống, một case một giá trị chốt | — | — |

---

## Tiêu chí nhận diện chi tiết từng shape

### `mapping`
- Code chủ yếu là chuỗi `target.setX(source.getX())` hoặc encoder/decoder calls.
- Không có branch nghiệp vụ (branch kỹ thuật như null-check không tính).
- Ví dụ: `OrderRequest → NewOrderEncoder` (SBE), entity ↔ DTO, message version upcast.
- Cảnh giác: mapper có `if (order.type() == STOP) encoder.stopPrice(...)` chứa
  một behavior shape `decision` — tách riêng behavior đó.

### `stateful`
- Cùng một input cho kết quả khác nhau tùy trạng thái tích lũy.
- Ví dụ: order book (kết quả match phụ thuộc resting orders), session manager,
  rate limiter, idempotency cache.
- Câu hỏi kiểm chứng: "gọi hàm này hai lần với cùng tham số có thể ra kết quả
  khác nhau không?" — Có → stateful.

### `computational`
- Output là số được tính từ công thức; đúng đắn xoay quanh precision, rounding
  mode, đơn vị (tick vs đồng), và biên miền số.
- Ví dụ: tính phí giao dịch, lãi margin, VaR, chuyển đổi price ↔ tick.

### `decision`
- Có thể vẽ thành bảng: N điều kiện đầu vào → M outcome.
- Ví dụ: order validation (side, price band, lot size, trading phase → accept/reject
  + reject reason), routing lệnh theo loại tài khoản.

### `parsing`
- Input đến từ ranh giới tin cậy (network, file, user) và có thể dị dạng tùy ý.
- Yêu cầu kép: input hợp lệ → decode đúng; input dị dạng → reject có kiểm soát,
  không bao giờ crash/hang/đọc lệch bộ nhớ.

### `concurrent`
- Chỉ gán shape này khi spec/thiết kế nói rõ code chạy đa luồng hoặc dựa vào
  memory ordering (ring buffer, single-writer principle, lock-free structure).
- Code chạy trong single-threaded event loop (Aeron Cluster logic) KHÔNG phải
  concurrent shape — test nó bằng deterministic replay như `stateful`.

### `integration`
- Behavior chỉ quan sát được khi ≥ 2 component thật nói chuyện với nhau.
- Đừng lạm dụng: nếu behavior kiểm chứng được ở mức unit với contract giả lập,
  nó thuộc shape khác và integration chỉ là bổ trợ.

### `fixed_rule`
- Spec cho giá trị cụ thể: "phí giao dịch cổ phiếu lô chẵn là 0.15%",
  "ngưỡng cảnh báo margin là 87%". Không có quy luật tổng quát để property hóa —
  chốt cứng bằng example test, mỗi giá trị một case, trích requirement_id
  trong tên test.

---

## Template example-based (dùng cho `fixed_rule`, `boundary_value`, regression)

```java
class TransactionFeeTest {
    // Conditions: TCON-FEE-0003 | Requirements: REQ-FEE-001

    private final FeeCalculator calculator = FeeCalculator.standard();

    @Test
    void equityRoundLotFeeIsFifteenBasisPoints_REQ_FEE_001() {
        Money fee = calculator.fee(TradeFixtures.equityRoundLot(
                Price.ofTicks(25_500), Quantity.of(1_000)));
        // Expected tính TAY từ spec, ghi rõ phép tính — không gọi lại calculator
        // 25_500 ticks * 100đ/tick * 1_000 * 0.15% = 3_825_000đ
        assertThat(fee).isEqualTo(Money.vnd(3_825_000));
    }
}
```

Quy tắc cứng của template:
- Expected value tính tay từ spec, kèm comment phép tính (chống tautology, R-T3).
- Tên test = behavior + requirement_id.
- Boundary value: với mỗi biên trong spec, tối thiểu 3 case — tại biên,
  ngay dưới biên, ngay trên biên.

## Template state-transition (bổ trợ cho `stateful` có FSM spec rõ)

Với FSM có spec dạng bảng transition, cover: (1) mọi transition hợp lệ,
(2) mọi cặp (state, event) KHÔNG có trong bảng → phải reject và giữ nguyên state.
Vế (2) là nơi bug tập trung — đừng chỉ test đường hợp lệ.

```java
@ParameterizedTest
@MethodSource("invalidTransitions")   // sinh từ phần bù của bảng transition trong spec
void invalidEventIsRejectedAndStateIsUnchanged(OrderState from, OrderEvent event) {
    OrderStateMachine fsm = OrderStateMachine.startingAt(from);
    TransitionResult result = fsm.onEvent(event);
    assertThat(result.rejected()).isTrue();
    assertThat(fsm.currentState()).isEqualTo(from);
}
```
