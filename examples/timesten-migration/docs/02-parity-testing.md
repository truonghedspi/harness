# Parity Testing — golden-master rules

## Principle

The old system's **observable behavior** is the spec — not its source code, and not anyone's
memory of it. For each unit we capture behavior vectors from a real TimesTen instance, then
require the new implementation to reproduce them field-by-field.

## Vector capture

Two capture modes; use both where possible:

1. **Replay capture** — instrument call sites or mine production logs to collect real
   invocations with real data distributions.
2. **Synthesized capture** — construct inputs (especially edge cases) and execute them
   against the reference TimesTen instance, recording what it *actually does* — not what the
   source appears to say.

Capture runs through the TimesTen MCP server (see `inventory/sources.yaml`), so agents can
capture vectors themselves without a human in the loop. Scope discipline: the MCP server is
for **capture and inventory only** — the parity runner replays stored vectors offline and
must never call TimesTen. That separation is what keeps the inner test loop in milliseconds.
Synthesized captures that require seeded `preState` need a scratch schema on the reference
instance a human has designated for this purpose; never mutate shared reference data.

Each vector is a line in `vectors/<unit-id>/NNN.jsonl`:

```json
{
  "vectorId": "APP.PKG_SETTLEMENT.CALC_FEE/017",
  "unitId": "APP.PKG_SETTLEMENT.CALC_FEE",
  "clock": "2026-03-14T09:30:00.000Z",
  "preState": { "FEE_SCHEDULE": [ { "...": "relevant rows only" } ] },
  "inputs": { "account_id": 1234, "gross_amount": "1500000.00", "asset_class": "EQ" },
  "expected": {
    "returnValue": "2250.00",
    "outParams": {},
    "rowDeltas": [ { "table": "FEE_LEDGER", "op": "insert", "row": { "...": "..." } } ],
    "error": null
  }
}
```

**Clock injection is mandatory**: run captures with a known/recorded SYSDATE so the new
system can be driven with the same cluster timestamp. A vector whose expected output depends
on an uncontrolled wall clock is a capture bug.

## Capture boundary for two-layer units (Java → TimesTen)

For `java-service` units the capture boundary is the **service method / API boundary**, not
the proc: inputs = the request/DTO, expected = response + row deltas + emitted events,
because Java-side validation/branching/orchestration is part of the behavior under
migration. Capture modes: replay production API logs, or drive the running Spring Boot app
(pointed at reference TimesTen) from integration tests with an injected clock
(fix the JVM clock — `Clock` bean override — so SYSDATE and Java time agree). Per-proc
vectors captured via MCP remain useful wherever the proc has branching of its own; both
levels attach to the same feature.

## Minimum vector set per unit

- ≥ 1 happy-path vector per branch of the unit's control flow
- NULL in every nullable input (one vector each)
- Boundary values for every numeric input: 0, negative, max precision/scale
- Every error path raised deliberately (constraint violation, no-data-found, business errors)
- Empty result sets and zero-row updates
- For anything you could not capture, list it in the unit's spec under **Uncaptured
  behavior** — the checker reviews that list before approving `done`.

## Comparison rules (the parity runner implements these)

- **Numbers**: compare at the documented fixed-point scale; rounding mode per the docs/04
  decision for that unit. A mismatch in the last digit is a failure, not noise.
- **NULL**: TimesTen NULL maps to explicit null. Never conflated with 0 or empty string.
- **Row sets**: where the old SQL guaranteed no order, compare order-insensitively — and
  record a docs/04 decision if any downstream consumer relied on incidental order.
- **Timestamps**: derived from the injected clock only; wall-clock leakage = test bug.
- **Errors**: match error class/code, not message text.
- A failing vector may only be waived via a docs/04 decision id recorded on the vector
  (`"waived": "D-012"`). Never deleted.

## Integration scenarios (Phase 3)

`scenarios/<name>.jsonl` — command sequences replayed through cluster ingress. Assert:
1. the egress event stream matches expectations,
2. final state hash matches the expected value,
3. the scenario run twice from clean state yields identical state hashes (determinism),
4. snapshot mid-scenario → restore → continue produces the same final hash as an
   uninterrupted run.

## Evidence format

Recorded on the feature in `feature_list.json`:

```json
"evidence": {
  "command": "./gradlew -q parityTest --tests '*CalcFee*'",
  "summary": "42/42 vectors passed",
  "outputDigest": "sha256:…",
  "date": "2026-07-19"
}
```

The checker re-runs the command; results must reproduce. Evidence that cannot be reproduced
is treated as absent.
