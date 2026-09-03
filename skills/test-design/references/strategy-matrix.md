# Strategy Matrix — choose techniques by logic shape

Choose techniques by the shape of behavior, not preference. Each shape has characteristic failures; applying the wrong technique can produce green but blind tests. Classify behavior, not classes, and split mixed behavior until each part has one shape.

| Shape | Characteristic failures | Primary strategy | Supporting strategy |
|---|---|---|---|
| `mapping` | field swaps, omissions, offsets, encoding | field-sensitivity plus round-trip properties | recursive comparison with distinct fixtures |
| `stateful` | corruption after rare sequences, precedence defects | model-based and invariant properties | FSM transition table |
| `computational` | rounding, units, overflow, signs at boundaries | algebraic/differential properties | numeric boundary values |
| `decision` | missing branches, wrong combined conditions | complete decision table | MC/DC for three-plus terms |
| `parsing` | crash, hang, invalid acceptance | round-trip and controlled-rejection properties | nightly fuzzing |
| `concurrent` | race, visibility, reordering | jcstress or deterministic replay | invariant after each replay |
| `integration` | contract or orchestration order | contract and end-to-end business scenario | business state transitions |
| `fixed_rule` | wrong specified value | one example per fixed value | — |

## Recognition

- `mapping`: mostly field copies or encoders/decoders with no business branch. Conditional fields are a separate `decision` behavior.
- `stateful`: identical input can yield different output because state accumulated from earlier operations.
- `computational`: output follows a formula involving precision, rounding, units, or numeric boundaries.
- `decision`: N input conditions determine M outcomes.
- `parsing`: input crosses a trust boundary and can be malformed; valid input decodes correctly and malformed input rejects safely.
- `concurrent`: use only when design specifies multithreading or memory ordering. Single-threaded event-loop code is `stateful`.
- `integration`: behavior requires two or more real components communicating.
- `fixed_rule`: the specification names a concrete value with no general law to test as a property.

## Example and transition templates

For fixed rules, derive expected values by hand from the specification, document the calculation, and include the `requirement_id` in the test name. For every specified boundary, cover at the boundary, just below it, and just above it.

For a specified FSM table, test every valid transition and every absent `(state, event)` pair. An invalid event must reject and preserve the original state.
