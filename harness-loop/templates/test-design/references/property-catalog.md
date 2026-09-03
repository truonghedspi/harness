# Property Catalog — five property kinds and jqwik templates

Read this file when implementing a condition with `technique: property`. The condition’s
`property_kind` field specifies the kind. ALWAYS read it with `references/generators.md` —
a correct property with a weak generator is still blind.

Property-generation process from the specification (for a Designer choosing `property_kind`):
go through each specification sentence and apply four questions:
1. Which quantity is **preserved**? → `invariant`
2. What **must never happen**? → `invariant`
3. Which operation has an **inverse** or encode/decode symmetry? → `round_trip`
4. If input changes in way X, how **must** the output change? → `metamorphic`
   (an important special case: `field_sensitivity`)

Is a feasible reference implementation available (≤ ~150 lines and obviously correct)? → `model_based`,
the most valuable kind for stateful code.

---

## 1. `invariant` — invariant after every operation sequence

Something that is always true regardless of history. Assert it after applying the whole command sequence
(and, for an inexpensive invariant, after every command).

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
        long accounted = trades.totalMatchedQuantity() * 2   // each trade matches two sides
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
            // Inexpensive invariant → assert after EVERY command so shrinking identifies the command that broke it
            assertThat(engine.book().isSortedByPriceTimePriority()).isTrue();
            engine.book().bestBid().ifPresent(bid ->
                engine.book().bestAsk().ifPresent(ask ->
                    assertThat(bid.price().ticks()).isLessThan(ask.price().ticks())));
        }
    }

    @Provide
    Arbitrary<List<OrderCommand>> commandSequences() {
        return CommandGenerators.collisionProneSequence(1, 200); // see generators.md
    }
}
```

## 2. `round_trip` — decode(encode(x)) == x

Required for every SBE message type and every serialize/deserialize pair.
Catches omitted fields, wrong lengths/offsets, lost precision, and wrong charsets.

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
                .usingRecursiveComparison()   // R-T2: the complete object, not selected fields
                .isEqualTo(original);
    }

    @Provide
    Arbitrary<OrderRequest> orderRequests() {
        return OrderRequestGenerators.fullDomain(); // covers the full domain, including boundaries
    }
}
```

Note: if encoding performs specification-valid normalization (trim padding, uppercase symbols),
the correct property is `decode(encode(x)) == normalize(x)`, with `normalize` written independently
from the specification — state this clearly in the condition rationale.

## 3. `model_based` — differential testing with a reference model

The most valuable strategy for `stateful` behavior. Compare an optimized implementation
(Agrona, primitive collections, zero allocation) with a simple, slow,
obviously correct reference model.

**Independence rule — a vital condition:** the reference model is written by a person, or by
another agent in a separate specification-only task. The same agent writing both engine and
model in the same context can make the same mistaken interpretation, turning the property into a tautology (R-T3).
Optimize the model for obvious correctness: `TreeMap`, immutable data, no performance optimization, ≤ ~150 lines.

```java
class MatchingEngineModelBasedTest {
    // Conditions: TCON-OB-0005 | Requirements: REQ-OB-001, REQ-OB-002

    @Property(tries = 1_000, shrinking = ShrinkingMode.FULL)
    void optimizedEngineAgreesWithReferenceModelOnAnySequence(
            @ForAll("commandSequences") List<OrderCommand> commands) {

        MatchingEngine real = MatchingEngine.forInstrument(InstrumentId.of("VNM"));
        ReferenceOrderBook model = new ReferenceOrderBook();   // TreeMap-based, ~120 lines

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

Compare **after every command**, not only at the end of the sequence — divergence is caught at the
command that caused it, and shrinking yields a minimal counterexample.

## 4. `metamorphic` — relation between two related runs

Use when no absolute oracle exists: verify a **relation** between outputs for two related
inputs. Examples: “add a buy order priced below the best bid → the best bid is unchanged”;
“increase the quantity of the last queued order → already-produced trades are unchanged”; monotonicity:
“quantity increases → fees do not decrease”.

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

### 4b. `field_sensitivity` — metamorphic testing specialized for the `mapping` shape

Check a mapper’s **wiring** with controlled perturbation:
change exactly one input field → exactly the corresponding output field changes, while every other field
remains unchanged. One property covers N fields and every pairwise swap in N×N. It catches all three variants:
swapping X↔Y, one-way assignment X→Y, and omitting X.

```java
class NewOrderMapperFieldSensitivityTest {
    // Conditions: TCON-MAP-0002 | Requirements: REQ-MSG-010

    /** Lists EVERY message field. Each field knows how to mutate itself
     *  to a DIFFERENT-AND-VALID value and read the corresponding output field. */
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
        // ... no field may be omitted — an omitted field is exactly the resulting coverage gap

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

        // Target side: the corresponding field MUST change
        assertThat(field.read(outVariant))
                .as("output %s must change when input %s changes", field, field)
                .isNotEqualTo(field.read(outBase));

        // Frame side: every other field MUST remain unchanged
        for (Field other : Field.values()) {
            if (other == field) continue;
            assertThat(other.read(outVariant))
                    .as("output %s must not change when only input %s changes", other, field)
                    .isEqualTo(other.read(outBase));
        }
    }

    @Provide
    Arbitrary<OrderRequest> distinctValuedRequests() {
        return OrderRequestGenerators.fullDomain()
                .filter(OrderRequest::allFieldValuesPairwiseDistinct); // R-T1, vital
    }
}
```

Two prerequisites — violating either makes the property blind:
1. **Pairwise distinct (R-T1):** every `base` field has a different value.
   This is especially dangerous for nested fields by value (a symbol is a substring
   of an ISIN) — if values collide, a swap creates no observable difference.
2. **Mutate to a different AND valid value:** the new value must pass encoder validation;
   if it is rejected or normalized back to its old value, the target side fails spuriously.

## 5. `algebraic` — algebraic properties of operations

Idempotence, commutativity (when the specification permits it), associativity, and identity elements.

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

## Property-failure lifecycle

1. jqwik shrinks the counterexample to its minimal form (keep `ShrinkingMode.FULL`).
2. Record the counterexample in a structured report for arbitration.
3. After arbitration concludes and the defect is fixed, create a fixed example test from
   the shrunken counterexample with `technique: regression_from_property`, and commit it
   permanently. The property finds the bug; the regression test prevents its return.
