# Generators — jqwik `Arbitrary` rules

A weak generator produces passing but useless properties because it never reaches buggy inputs. Review every generator against G1–G4.

## G1 — Collision-prone inputs

Stateful bugs occur when operations interact: orders match, cancellation hits an existing order, or two commands use one price level. Use deliberately narrow domains and references to earlier generated commands; do not generate random IDs that almost always miss.

## G2 — Boundary-inclusive inputs

jqwik injects primitive edge cases but does not know business boundaries. Explicitly mix in price limits, lot sizes, maximum order value, empty/nonempty values, and protocol length boundaries.

## G3 — Intentional valid/invalid weighting

Business-behavior properties should mostly generate valid inputs (for example 90/10) so they reach deep logic. Validation/parsing properties should mostly generate malformed inputs. Never use a 100% mix: it blinds either rejection paths or core behavior.

## G4 — Sequences long enough for state transitions

Stateful defects often require three or more transitions. Use command-sequence maxima of at least 100–300; shrinking returns a readable minimal counterexample.

## Field-sensitivity additions

- The base-object generator must filter `allFieldValuesPairwiseDistinct`.
- `Distinct.*(current)` must return a different, encoder-valid value reproducible from jqwik’s seed.

## Reproducibility

- Do not use `System.currentTimeMillis()`, `Instant.now()`, or `new Random()` in generator/test code. Route randomness through jqwik.
- Record jqwik’s failure seed in the structured report.
- Configure `jqwik.failures.after.default = PREVIOUS_SEED` so reruns favor the last failed seed.

## Try budgets

| Run context | `tries` |
|---|---|
| PR gate (T0/T1) | 200–500 |
| Nightly full run | 2_000–5_000 |

Use `@Property(tries = ...)`, reading `-Djqwik.tries.default` when the harness provides it.
