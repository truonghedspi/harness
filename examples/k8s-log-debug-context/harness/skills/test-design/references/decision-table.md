# Decision Table — technique for the `decision` shape

Use when behavior combines N conditions into M outcomes (order validation, routing, or
classification). The goal is a test for every table column and a table that is **complete** and
**non-contradictory**.

## Workflow

1. **Extract the table from the specification**: conditions are rows, meaningful combinations are
   columns, and outcomes sit at the bottom of each column. If the specification cannot fill a cell,
   it is a specification gap: record it in the test plan's `spec_gaps`; do not infer it.
2. **Reduce with "—" (don't care)** only when the specification explicitly says the condition
   does not matter in that column's context. A convenient "—" hides rules and creates bugs.
3. **Check table properties before producing tests:**
   - Complete: every possible combination falls in at least one column.
   - Non-contradictory: no combination falls in two columns with different outcomes. If the
     specification resolves conflict with rule precedence, that order must be in the specification
     and each pair of overlapping rules needs a dedicated test.
4. **One column = one test case**, named for its column and outcome.

## Example — new-order validation (reduced)

| Condition | C1 | C2 | C3 | C4 | C5 |
|---|---|---|---|---|---|
| Trading phase = CONTINUOUS | Y | Y | Y | N | Y |
| Price within ceiling/floor band | Y | Y | N | — | Y |
| Quantity is a multiple of lot size | Y | N | — | — | Y |
| Buying power sufficient | Y | — | — | — | N |
| **Outcome** | ACCEPT | REJ_LOT_SIZE | REJ_PRICE_BAND | REJ_PHASE | REJ_BUYING_POWER |

Reject precedence (phase > price > lot > buying power) must come from the specification. This is
exactly the kind of detail where two "reasonable" implementations diverge, and it warrants
`ESCALATE_SPEC` when the specification is silent.

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

Fixture rule: each column violates ONLY its own condition; every other condition remains valid.
If fixture C2 violates both lot size and price, the test cannot tell which rule caused the outcome.

## When to elevate to MC/DC

When a table condition is itself a Boolean expression with three or more operands
(`phase == CONTINUOUS || (phase == ATO && type == LO) || override`), treating it as one Y/N cell
is insufficient. Apply MC/DC to that expression: every operand needs a test pair differing only in
that operand and with a changed outcome, proving that each independently affects the result.
Record a separate condition with `technique: mcdc`.
