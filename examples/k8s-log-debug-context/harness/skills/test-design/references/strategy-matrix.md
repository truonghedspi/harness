# Strategy Matrix — choose test techniques by logic shape

Principle: choose test techniques by the **shape of the logic**, not preference. Every shape has a
characteristic bug class, and every technique is designed to catch one. Apply the wrong technique
to a shape and tests stay green but blind.

Classify at the **behavior** level, not the class level. A real class often contains two or three
shapes (a mapper may contain conditional-field decision logic); split behavior until each has one shape.

---

## Complete matrix

| Shape | Characteristic bug class | Primary strategy | Supporting strategy | Related gate |
|---|---|---|---|---|
| `mapping` | Field swap/omission; bad offset/encoding | Field-sensitivity + round-trip properties | Recursive comparison with distinct-value fixtures | PIT `EXPERIMENTAL_MEMBER_VARIABLE` |
| `stateful` | State corruption after rare sequences; incorrect precedence | Model-based property (reference model) + command-sequence invariant | State-transition table for a clearly specified FSM | jqwik shrinking → regression |
| `computational` | Incorrect rounding/unit/sign/boundary overflow | Algebraic property (monotonicity, additivity, bounds) + differential reference implementation | Numeric boundary values (0, ±1 tick, MAX) | PIT math/conditional mutators |
| `decision` | Missing branch; wrong condition combination; shadowed rule | Decision table covering every column | MC/DC for Boolean expressions with 3+ conditions | PIT conditional boundary |
| `parsing` | Crash/hang on malformed input; accepting input that must be rejected | Round-trip + "does not crash; controlled rejection only" property | Nightly fuzzing (jazzer) | — |
| `concurrent` | Race, visibility, reordering | jcstress for memory-model concerns; deterministic replay for cluster/single-writer logic | Invariant after every replay | Nightly jcstress |
| `integration` | Broken component contract; wrong orchestration order | Contract test + end-to-end business scenario | Business-process state transitions | — |
| `fixed_rule` | Incorrect fixed value (fee, statutory threshold) | Traditional example test, one case per fixed value | — | — |

---

## Detailed recognition criteria

### `mapping`
- Code is primarily `target.setX(source.getX())` chains or encoder/decoder calls.
- It has no business branch (technical branches such as null checks do not count).
- Examples: `OrderRequest → NewOrderEncoder` (SBE), entity ↔ DTO, message-version upcast.
- Caution: a mapper with `if (order.type() == STOP) encoder.stopPrice(...)` has a `decision`
  behavior that must be split out.

### `stateful`
- The same input can produce a different result depending on accumulated state.
- Examples: order book (matching depends on resting orders), session manager, rate limiter,
  idempotency cache.
- Recognition question: "can calling this function twice with the same arguments produce different
  results?" If yes, it is stateful.

### `computational`
- Output is a number calculated from a formula; correctness concerns precision, rounding mode,
  units (tick vs. VND), and numeric-domain boundaries.
- Examples: trading fees, margin interest, VaR, price ↔ tick conversion.

### `decision`
- It can be drawn as a table: N input conditions → M outcomes.
- Examples: order validation (side, price band, lot size, trading phase → accept/reject plus
  rejection reason), routing orders by account type.

### `parsing`
- Input crosses a trust boundary (network, file, user) and may be arbitrarily malformed.
- Dual requirement: valid input decodes correctly; malformed input rejects in a controlled way and
  never crashes, hangs, or reads memory incorrectly.

### `concurrent`
- Assign this shape only when the specification/design explicitly says the code is multithreaded or
  relies on memory ordering (ring buffer, single-writer principle, lock-free structure).
- Code in a single-threaded event loop (Aeron Cluster logic) is NOT `concurrent`; test it as
  `stateful` with deterministic replay.

### `integration`
- The behavior is observable only when two or more real components communicate.
- Do not overuse it: behavior verifiable at unit level with a contract double belongs to another
  shape; integration is supporting evidence.

### `fixed_rule`
- The specification gives a specific value: "round-lot equity trading fee is 0.15%" or "margin
  warning threshold is 87%." There is no general rule to property-test—fix it with one example
  test per value and cite the requirement_id in the test name.

---

## Example-based template (for `fixed_rule`, `boundary_value`, regression)

```java
class TransactionFeeTest {
    // Conditions: TCON-FEE-0003 | Requirements: REQ-FEE-001

    private final FeeCalculator calculator = FeeCalculator.standard();

    @Test
    void equityRoundLotFeeIsFifteenBasisPoints_REQ_FEE_001() {
        Money fee = calculator.fee(TradeFixtures.equityRoundLot(
                Price.ofTicks(25_500), Quantity.of(1_000)));
        // Expected is calculated BY HAND from the specification; state the calculation—do not call calculator again.
        // 25_500 ticks * 100 VND/tick * 1_000 * 0.15% = 3_825_000 VND
        assertThat(fee).isEqualTo(Money.vnd(3_825_000));
    }
}
```

Hard template rules:
- Calculate expected values manually from the specification and include the calculation comment
  (prevents tautology, R-T3).
- Test name = behavior + requirement_id.
- For every boundary in the specification, test at least three cases: at, just below, and just above.

## State-transition template (supports `stateful` with a clear FSM specification)

For an FSM with a transition-table specification, cover: (1) every valid transition, and (2) every
`(state, event)` pair NOT in the table, which must reject and preserve state. The second case is
where bugs concentrate; do not test only the valid path.

```java
@ParameterizedTest
@MethodSource("invalidTransitions")   // produced from the complement of the specification transition table
void invalidEventIsRejectedAndStateIsUnchanged(OrderState from, OrderEvent event) {
    OrderStateMachine fsm = OrderStateMachine.startingAt(from);
    TransitionResult result = fsm.onEvent(event);
    assertThat(result.rejected()).isTrue();
    assertThat(fsm.currentState()).isEqualTo(from);
}
```
