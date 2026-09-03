# Property Catalog — jqwik templates

Read this for `technique: property`, together with `references/generators.md`. A correct property with a weak generator is still blind.

Choose `property_kind` by asking: what quantity is conserved or can never occur (`invariant`); what operation is inverse/symmetric (`round_trip`); how must an output change when an input changes (`metamorphic`, including `field_sensitivity`); and whether a clearly correct small reference implementation is feasible (`model_based`).

## `invariant`

Assert facts that remain true after every command sequence, and after each command when the invariant is inexpensive. For an order book, quantity submitted equals matched quantity on both sides plus resting, cancelled, and rejected quantity.

## `round_trip`

For every SBE message and serialize/deserialize pair, assert `decode(encode(x)) == x` with recursive comparison across the entire object. If normalization is specified, assert `decode(encode(x)) == normalize(x)` where `normalize` is independently derived from the specification.

## `model_based`

Compare optimized stateful code with a simple, obviously correct reference model after every command. The reference model must be independently authored or written in a separate specification-only task; use clarity-first structures such as `TreeMap`, immutability, and at most about 150 lines.

## `metamorphic`

When no absolute oracle exists, assert a relation between related inputs: increasing quantity cannot decrease a nonnegative fee, or adding a lower bid cannot change the best bid.

### `field_sensitivity`

Enumerate every message field. Mutate exactly one input field to a distinct valid value, then assert that exactly its corresponding output field changes and every other output field remains unchanged. Pairwise-distinct base values and valid distinct mutations are mandatory; otherwise swaps and omissions are invisible.

## `algebraic`

Assert specification-approved algebraic properties such as idempotence, commutativity, associativity, and identity. For example, cancelling an already-cancelled order must not change the book.

## Property-failure lifecycle

1. Keep `ShrinkingMode.FULL` and let jqwik minimize the counterexample.
2. Record it in a structured arbitration report.
3. After arbitration and repair, add a permanent fixed example with `technique: regression_from_property`.
