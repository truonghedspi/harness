# Decision Table — kỹ thuật cho shape `decision`

Dùng khi behavior là tổ hợp N điều kiện → M outcome (order validation, routing,
phân loại). Mục tiêu: mọi cột của bảng có test, và bảng chứng minh được là
**đầy đủ** và **không mâu thuẫn**.

## Quy trình

1. **Trích bảng từ spec** — điều kiện làm hàng, mỗi tổ hợp có ý nghĩa làm cột,
   outcome ở đáy cột. Nếu spec không cho đủ để điền một ô → đó là spec gap,
   ghi vào `spec_gaps` của test plan, không tự suy diễn.
2. **Rút gọn bằng "—" (don't care)** chỉ khi spec nói rõ điều kiện đó không
   ảnh hưởng trong ngữ cảnh cột. "—" vì tiện là nguồn bug che khuất rule.
3. **Kiểm tính chất bảng trước khi sinh test:**
   - Đầy đủ: mọi tổ hợp khả dĩ rơi vào đúng ít nhất một cột.
   - Không mâu thuẫn: không tổ hợp nào rơi vào hai cột có outcome khác nhau.
     Nếu spec dùng thứ tự ưu tiên rule để phá mâu thuẫn → thứ tự đó phải có
     trong spec và có test riêng cho từng cặp rule chồng lấn.
4. **Một cột = một test case**, tên test nêu cột và outcome.

## Ví dụ — validation lệnh mới (rút gọn)

| Điều kiện | C1 | C2 | C3 | C4 | C5 |
|---|---|---|---|---|---|
| Trading phase = CONTINUOUS | Y | Y | Y | N | Y |
| Price trong biên trần/sàn | Y | Y | N | — | Y |
| Quantity là bội lot size | Y | N | — | — | Y |
| Buying power đủ | Y | — | — | — | N |
| **Outcome** | ACCEPT | REJ_LOT_SIZE | REJ_PRICE_BAND | REJ_PHASE | REJ_BUYING_POWER |

Thứ tự ưu tiên reject (phase > price > lot > buying power) phải lấy từ spec —
đây chính là loại chi tiết mà hai implementation "đều hợp lý" sẽ lệch nhau,
và là ứng viên `ESCALATE_SPEC` nếu spec im lặng.

```java
class NewOrderValidationDecisionTableTest {
    // Conditions: TCON-VAL-0001 | Requirements: REQ-VAL-001..005

    @ParameterizedTest(name = "{0}")
    @MethodSource("decisionTableColumns")
    void everyDecisionTableColumnProducesItsSpecifiedOutcome(
            String column, OrderRequest request, ValidationOutcome expected) {
        assertThat(validator.validate(request, MarketContextFixtures.forColumn(column)))
                .isEqualTo(expected);
    }

    static Stream<Arguments> decisionTableColumns() {
        return Stream.of(
            arguments("C1_all_valid",       Requests.column1(), ValidationOutcome.ACCEPT),
            arguments("C2_odd_lot",         Requests.column2(), ValidationOutcome.rejected(RejectReason.LOT_SIZE)),
            arguments("C3_outside_band",    Requests.column3(), ValidationOutcome.rejected(RejectReason.PRICE_BAND)),
            arguments("C4_wrong_phase",     Requests.column4(), ValidationOutcome.rejected(RejectReason.TRADING_PHASE)),
            arguments("C5_no_buying_power", Requests.column5(), ValidationOutcome.rejected(RejectReason.BUYING_POWER))
        );
    }
}
```

Quy tắc fixture: mỗi cột chỉ vi phạm ĐÚNG điều kiện của cột đó, mọi điều kiện
khác giữ hợp lệ — nếu fixture C2 vừa lệch lot vừa lệch price, test không phân
biệt được outcome đến từ rule nào.

## Nâng lên MC/DC khi nào

Khi một điều kiện của bảng bản thân nó là biểu thức boolean ≥ 3 toán hạng
(`phase == CONTINUOUS || (phase == ATO && type == LO) || override`), decision
table coi nó là một ô Y/N là chưa đủ. Áp MC/DC cho riêng biểu thức đó: mỗi
toán hạng phải có một cặp test chỉ khác nhau ở toán hạng đó và outcome đổi —
chứng minh từng toán hạng độc lập ảnh hưởng kết quả. Ghi condition riêng với
`technique: mcdc`.
