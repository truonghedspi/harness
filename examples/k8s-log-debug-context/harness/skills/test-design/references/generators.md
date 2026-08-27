# Generators — quy tắc viết Arbitrary cho jqwik

Generator kém là lý do số một khiến property "pass mà vô dụng": property đúng
nhưng input space được sinh không bao giờ chạm vùng có bug. Bốn quy tắc dưới đây
là bắt buộc; Reviewer kiểm từng quy tắc theo checklist.

---

## G1 — Collision-prone: input phải VA CHẠM được với nhau

Bug của stateful code nằm ở chỗ các thao tác tương tác: order match nhau, cancel
trúng order đang tồn tại, hai lệnh cùng price level. Generator sinh giá trị trên
miền quá rộng → xác suất va chạm ≈ 0 → property chỉ test đường "không có gì xảy ra".

- Price: miền HẸP có chủ đích (ví dụ 10 tick quanh mức tham chiếu) để buy/sell
  thực sự khớp nhau. KHÔNG dùng `Arbitraries.longs()` toàn miền cho price.
- Cancel/amend: tham chiếu theo **index của lệnh đã sinh trước đó** trong sequence
  (`cancelByLocalIndex`), không sinh orderId ngẫu nhiên — orderId ngẫu nhiên
  gần như luôn miss, sequence chỉ toàn reject.
- ID va chạm có chủ đích: thỉnh thoảng sinh trùng clientOrderId để test đường
  duplicate-detection.

```java
public final class CommandGenerators {

    public static Arbitrary<List<OrderCommand>> collisionProneSequence(int min, int max) {
        Arbitrary<OrderCommand> newOrder = Combinators.combine(
                Arbitraries.of(Side.BUY, Side.SELL),
                Arbitraries.longs().between(10_000, 10_010)    // G1: miền hẹp → match được
                        .map(Price::ofTicks),
                Arbitraries.longs().between(1, 1_000).map(Quantity::of)
        ).as(OrderCommand::newLimitOrder);

        Arbitrary<OrderCommand> cancel = Arbitraries.integers().between(0, 50)
                .map(OrderCommand::cancelByLocalIndex);        // G1: cancel trúng được

        return Arbitraries.frequencyOf(
                Tuple.of(3, newOrder),                          // G3: tỷ trọng 3:1
                Tuple.of(1, cancel)
        ).list().ofMinSize(min).ofMaxSize(max);                 // G4: sequence đủ dài
    }

    private CommandGenerators() {}
}
```

## G2 — Boundary-inclusive: biên phải được sinh ra, không phó mặc ngẫu nhiên

jqwik có edge-case injection cho kiểu số nguyên thủy, nhưng KHÔNG biết biên
nghiệp vụ (giá trần/sàn, lot size, max order value). Trộn biên nghiệp vụ vào
phân phối một cách tường minh:

```java
static Arbitrary<Price> prices() {
    Arbitrary<Price> interior = Arbitraries.longs()
            .between(FLOOR_TICKS + 1, CEILING_TICKS - 1).map(Price::ofTicks);
    Arbitrary<Price> boundary = Arbitraries.of(
            Price.ofTicks(FLOOR_TICKS), Price.ofTicks(FLOOR_TICKS + 1),
            Price.ofTicks(CEILING_TICKS - 1), Price.ofTicks(CEILING_TICKS));
    return Arbitraries.frequencyOf(Tuple.of(9, interior), Tuple.of(1, boundary));
}
```

## G3 — Tỷ trọng valid/invalid có chủ đích

- Property về hành vi nghiệp vụ: sinh chủ yếu input hợp lệ (invalid bị reject
  sớm, không exercise logic sâu). Tỷ lệ tham khảo 90/10.
- Property về validation/parsing: đảo lại — chủ yếu input dị dạng.
- Không bao giờ 100% một loại: 100% valid mù đường reject; 100% invalid mù logic chính.

## G4 — Sequence đủ dài để đi qua nhiều state transition

Bug stateful thường cần 3+ transition để lộ diện (fill một phần → amend → cancel).
`ofMaxSize` tối thiểu 100–300 cho command-sequence property. Shrinking sẽ tự rút
về chuỗi tối giản khi fail, nên độ dài không làm counterexample khó đọc.

---

## Quy tắc riêng cho field-sensitivity (bổ sung R-T1)

- Generator của base object BẮT BUỘC filter `allFieldValuesPairwiseDistinct` —
  hai field trùng giá trị làm phép hoán vô hình.
- Helper `Distinct.*(current)` phải trả về giá trị (a) khác `current`,
  (b) hợp lệ với validation của encoder (đúng format, check digit, độ dài),
  (c) tất định hoặc tái lập được từ seed — không phụ thuộc clock/random ngoài jqwik.

## Tính tái lập (bắt buộc cho CI)

- KHÔNG dùng `System.currentTimeMillis()`, `Instant.now()`, `new Random()` trong
  generator hay code test — mọi ngẫu nhiên đi qua jqwik để seed điều khiển được.
- Khi property fail, jqwik in seed; ghi seed vào failure report để arbitration
  và fix tái lập chính xác.
- Cấu hình `junit-platform.properties` của project:
  `jqwik.failures.after.default = PREVIOUS_SEED` (re-run ưu tiên seed vừa fail).

## Ngân sách tries (khớp tiering của harness)

| Ngữ cảnh chạy | tries |
|---|---|
| PR gate (T0/T1) | 200–500 |
| Nightly full run | 2_000–5_000 |

Đặt qua `@Property(tries = ...)` đọc từ system property của harness nếu có
(`-Djqwik.tries.default`), để cùng một test dùng được cho cả hai ngữ cảnh.
