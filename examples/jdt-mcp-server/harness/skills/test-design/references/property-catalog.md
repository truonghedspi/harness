# Property Catalog — 5 loại property và template jqwik

Đọc file này khi hiện thực hóa condition có `technique: property`. Field
`property_kind` của condition chỉ định loại. LUÔN đọc kèm `references/generators.md` —
property đúng với generator kém vẫn là property mù.

Quy trình sinh property từ spec (dành cho Designer chọn `property_kind`):
đi qua từng câu spec, áp 4 câu hỏi:
1. Đại lượng nào được **bảo toàn**? → `invariant`
2. Điều gì **không bao giờ được xảy ra**? → `invariant`
3. Thao tác nào có **nghịch đảo** hoặc đối xứng encode/decode? → `round_trip`
4. Đổi input theo cách X thì output **phải** đổi theo cách nào? → `metamorphic`
   (trường hợp đặc biệt quan trọng: `field_sensitivity`)

Có reference implementation khả thi (≤ ~150 dòng, hiển nhiên đúng)? → `model_based`,
loại giá trị nhất cho stateful code.

---

## 1. `invariant` — bất biến sau mọi chuỗi thao tác

Điều luôn đúng bất kể lịch sử. Assert sau khi áp toàn bộ command sequence
(và với invariant rẻ, sau từng command).

```java
class OrderBookInvariantsTest {
    // Conditions: TCON-OB-0001 | Requirements: REQ-OB-003

    @Property(tries = 2_000, shrinking = ShrinkingMode.FULL)
    void quantityIsConservedAcrossAnyCommandSequence(
            @ForAll("commandSequences") List<OrderCommand> commands) {

        MatchingEngine engine = MatchingEngine.forInstrument(InstrumentId.of("VNM"));
        TradeRecorder trades = new TradeRecorder();
        commands.forEach(cmd -> engine.apply(cmd, trades));

        long submitted = commands.stream()
                .filter(c -> c.type() == CommandType.NEW)
                .mapToLong(OrderCommand::quantity).sum();
        long accounted = trades.totalMatchedQuantity() * 2   // mỗi trade khớp 2 phía
                + engine.book().totalRestingQuantity()
                + engine.totalCancelledQuantity()
                + engine.totalRejectedQuantity();

        assertThat(accounted).isEqualTo(submitted);
    }

    @Property(tries = 2_000)
    void bookOrderingInvariantHoldsAfterEveryCommand(
            @ForAll("commandSequences") List<OrderCommand> commands) {

        MatchingEngine engine = MatchingEngine.forInstrument(InstrumentId.of("VNM"));
        for (OrderCommand cmd : commands) {
            engine.apply(cmd, TradeRecorder.discarding());
            // Invariant rẻ → assert sau TỪNG command để shrink chỉ đúng command gây vỡ
            assertThat(engine.book().isSortedByPriceTimePriority()).isTrue();
            engine.book().bestBid().ifPresent(bid ->
                engine.book().bestAsk().ifPresent(ask ->
                    assertThat(bid.price().ticks()).isLessThan(ask.price().ticks())));
        }
    }

    @Provide
    Arbitrary<List<OrderCommand>> commandSequences() {
        return CommandGenerators.collisionProneSequence(1, 200); // xem generators.md
    }
}
```

## 2. `round_trip` — decode(encode(x)) == x

Bắt buộc cho mọi SBE message type và mọi cặp serialize/deserialize.
Bắt: field bị bỏ quên, sai length/offset, mất precision, sai charset.

```java
class NewOrderSbeRoundTripTest {
    // Conditions: TCON-MAP-0001 | Requirements: REQ-MSG-010

    @Property(tries = 1_000, shrinking = ShrinkingMode.FULL)
    void encodeThenDecodeReturnsEqualObject(
            @ForAll("orderRequests") OrderRequest original) {

        UnsafeBuffer buffer = new UnsafeBuffer(new byte[512]);
        int encodedLength = SbeCodec.encode(original, buffer, 0);
        OrderRequest decoded = SbeCodec.decode(buffer, 0, encodedLength);

        assertThat(decoded)
                .usingRecursiveComparison()   // R-T2: toàn bộ object, không field lẻ
                .isEqualTo(original);
    }

    @Provide
    Arbitrary<OrderRequest> orderRequests() {
        return OrderRequestGenerators.fullDomain(); // phủ toàn miền, gồm biên
    }
}
```

Lưu ý: nếu encode có normalize hợp lệ theo spec (trim padding, upper-case symbol),
property đúng là `decode(encode(x)) == normalize(x)` với `normalize` viết độc lập
từ spec — ghi rõ trong rationale của condition.

## 3. `model_based` — differential với reference model

Chiến lược giá trị nhất cho `stateful`. So sánh implementation tối ưu
(Agrona, primitive collections, zero-alloc) với reference model đơn giản,
chậm, hiển nhiên đúng.

**Quy tắc độc lập — điều kiện sống còn:** reference model do người viết, hoặc do
agent khác viết trong task riêng chỉ đọc spec. Cùng một agent viết cả engine lẫn
model trong cùng context → cùng cách hiểu sai → property thành tautology (R-T3).
Model tối ưu cho tính dễ-đúng: `TreeMap`, immutable, không tối ưu hiệu năng, ≤ ~150 dòng.

```java
class MatchingEngineModelBasedTest {
    // Conditions: TCON-OB-0005 | Requirements: REQ-OB-001, REQ-OB-002

    @Property(tries = 1_000, shrinking = ShrinkingMode.FULL)
    void optimizedEngineAgreesWithReferenceModelOnAnySequence(
            @ForAll("commandSequences") List<OrderCommand> commands) {

        MatchingEngine real = MatchingEngine.forInstrument(InstrumentId.of("VNM"));
        ReferenceOrderBook model = new ReferenceOrderBook();   // TreeMap-based, ~120 dòng

        for (OrderCommand cmd : commands) {
            List<Trade> realTrades  = real.applyAndCollect(cmd);
            List<Trade> modelTrades = model.applyAndCollect(cmd);

            assertThat(realTrades).containsExactlyElementsOf(modelTrades);
            assertThat(real.book().snapshot())
                    .usingRecursiveComparison()
                    .isEqualTo(model.snapshot());
        }
    }

    @Provide
    Arbitrary<List<OrderCommand>> commandSequences() {
        return CommandGenerators.collisionProneSequence(1, 300);
    }
}
```

So sánh **sau từng command**, không chỉ cuối chuỗi — divergence bị bắt tại đúng
command gây ra, shrinking cho counterexample tối giản.

## 4. `metamorphic` — quan hệ giữa hai lần chạy liên quan

Dùng khi không có oracle tuyệt đối: kiểm tra **quan hệ** giữa output của hai input
liên quan. Mẫu: "thêm buy order giá thấp hơn best bid → best bid không đổi";
"tăng qty của order cuối queue → trades đã sinh không đổi"; đơn điệu:
"qty tăng → phí không giảm".

```java
class FeeMonotonicityTest {
    // Conditions: TCON-FEE-0007 | Requirements: REQ-FEE-002

    @Property(tries = 1_000)
    void feeIsMonotonicallyNonDecreasingInQuantity(
            @ForAll("trades") Trade base,
            @ForAll @LongRange(min = 1, max = 1_000_000) long additionalQty) {

        Trade larger = base.withQuantity(base.quantity().plus(additionalQty));

        Money feeBase   = calculator.fee(base);
        Money feeLarger = calculator.fee(larger);

        assertThat(feeLarger).isGreaterThanOrEqualTo(feeBase);
    }
}
```

### 4b. `field_sensitivity` — metamorphic chuyên cho shape `mapping`

Kiểm tra **sơ đồ đấu nối (wiring)** của mapper bằng nhiễu loạn có kiểm soát:
đổi đúng một input field → đúng một output field tương ứng đổi, mọi field khác
bất động. Một property phủ N field và mọi cặp hoán trong N×N. Bắt cả ba biến thể:
hoán chéo X↔Y, ghi một chiều X→Y, bỏ quên X.

```java
class NewOrderMapperFieldSensitivityTest {
    // Conditions: TCON-MAP-0002 | Requirements: REQ-MSG-010

    /** Liệt kê ĐỦ mọi field của message. Mỗi field biết cách tự mutate
     *  thành giá trị KHÁC-và-HỢP-LỆ, và cách đọc field tương ứng từ output. */
    enum Field {
        ISIN_CODE {
            OrderRequest mutate(OrderRequest r) { return r.withIsinCode(Distinct.isin(r.isinCode())); }
            Object read(DecodedOrder d)         { return d.isinCode(); }
        },
        SYMBOL {
            OrderRequest mutate(OrderRequest r) { return r.withSymbol(Distinct.symbol(r.symbol())); }
            Object read(DecodedOrder d)         { return d.symbol(); }
        },
        PRICE {
            OrderRequest mutate(OrderRequest r) { return r.withPrice(r.price().plusTicks(100)); }
            Object read(DecodedOrder d)         { return d.price(); }
        },
        STOP_PRICE {
            OrderRequest mutate(OrderRequest r) { return r.withStopPrice(r.stopPrice().plusTicks(100)); }
            Object read(DecodedOrder d)         { return d.stopPrice(); }
        };
        // ... KHÔNG được bỏ sót field nào — thiếu field là lỗ hổng đúng bằng field đó

        abstract OrderRequest mutate(OrderRequest base);
        abstract Object read(DecodedOrder decoded);
    }

    @Property(tries = 1_000, shrinking = ShrinkingMode.FULL)
    void mutatingOneInputFieldChangesExactlyItsOutputField(
            @ForAll("distinctValuedRequests") OrderRequest base,
            @ForAll Field field) {

        OrderRequest variant = field.mutate(base);
        DecodedOrder outBase    = roundTrip(base);
        DecodedOrder outVariant = roundTrip(variant);

        // Vế target: field tương ứng PHẢI đổi
        assertThat(field.read(outVariant))
                .as("output %s phải đổi khi input %s đổi", field, field)
                .isNotEqualTo(field.read(outBase));

        // Vế frame: mọi field còn lại PHẢI bất động
        for (Field other : Field.values()) {
            if (other == field) continue;
            assertThat(other.read(outVariant))
                    .as("output %s không được đổi khi chỉ input %s đổi", other, field)
                    .isEqualTo(other.read(outBase));
        }
    }

    @Provide
    Arbitrary<OrderRequest> distinctValuedRequests() {
        return OrderRequestGenerators.fullDomain()
                .filter(OrderRequest::allFieldValuesPairwiseDistinct); // R-T1, sống còn
    }
}
```

Hai điều kiện tiên quyết — vi phạm là property mù:
1. **Pairwise distinct (R-T1):** mọi field của `base` đôi một khác giá trị.
   Đặc biệt nguy hiểm với field lồng nhau về mặt giá trị (symbol là substring
   của ISIN) — nếu trùng, phép hoán không tạo khác biệt quan sát được.
2. **Mutate ra giá trị khác VÀ hợp lệ:** giá trị mới phải qua được validation
   của encoder; nếu bị reject hoặc normalize về giá trị cũ → fail giả ở vế target.

## 5. `algebraic` — tính chất đại số của thao tác

Idempotence, giao hoán (khi spec cho phép), kết hợp, phần tử trung hòa.

```java
@Property(tries = 500)
void cancellingAnAlreadyCancelledOrderIsIdempotent(
        @ForAll("bookStates") MatchingEngine engine,
        @ForAll("restingOrderIdOf") OrderId id) {

    engine.apply(OrderCommand.cancel(id), TradeRecorder.discarding());
    BookSnapshot afterFirst = engine.book().snapshot();

    CommandResult second = engine.applyAndReport(OrderCommand.cancel(id));

    assertThat(second.outcome()).isEqualTo(Outcome.REJECTED_UNKNOWN_ORDER);
    assertThat(engine.book().snapshot()).usingRecursiveComparison().isEqualTo(afterFirst);
}
```

---

## Vòng đời khi property fail

1. jqwik shrink counterexample về dạng tối giản (giữ `ShrinkingMode.FULL`).
2. Ghi counterexample vào report có cấu trúc cho arbitration.
3. Sau khi arbitration kết luận và fix xong: tạo example test cố định từ
   counterexample đã shrink, `technique: regression_from_property`, commit
   vĩnh viễn. Property tìm bug; regression test giữ bug không quay lại.
