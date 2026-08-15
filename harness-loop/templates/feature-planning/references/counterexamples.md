# Planner counterexamples

## Build with no independent proof

Bad:

```json
{"id":"feat-ledger","kind":"build","verification":"npm test"}
```

The implementation and its only proof can be wrong together. Add a prove feature derived from the
requirement, depending on `feat-ledger`, with a discriminating falsifier.

## Invented traceability

Bad: `"falsifier": "returns stale state [INV-CACHE-9]"` when no design states that ID.

Do not attach a plausible citation after drafting. Emit `NEEDS DESIGN:` and let the design owner
state the missing invariant or explain why the feature is not required.

## Command-shaped prose

Bad: `"verification": "manually inspect the response"` or `"REPLACE with npm test"`.

A command must be copy-pasteable on the current stack. If the repository cannot supply it yet,
create prerequisite test infrastructure or leave the feature unready rather than manufacturing a
green-looking string.

## Horizontal slicing

Bad: `parse request`, `validate request`, and `store request` as three features when none produces
observable behavior alone.

Prefer a vertical behavior that can be demonstrated, then a prove feature that exercises it. Split
only when an intermediate output has its own stable seam and proof.

## Overloaded behavior

Bad: “The worker validates input and persists it and publishes an event and retries failures.”

Those clauses have different failure modes and often different boundaries. Split them and encode
the real dependency order.

## Re-plan that erases history

Bad: replacing a partially completed feature array from `feature_list.digest.md` and resetting all
attempts/evidence.

Read the full source file. Preserve state by ID, and record any deliberate supersession in
`DECISIONS.md`.
