# The invariant → falsifier contract

The design step states what must always be true. The decomposition step turns each of those into a
`falsifier` — the wrong implementation a feature's verification would catch. Everything downstream
depends on that handoff being real.

Until this contract existed it was not checkable. `design-untestable` only confirmed that the
*words* "seam" and "invariant" appeared somewhere in a design document. The planner was **instructed**
to derive each `falsifier` from a stated invariant, and nothing verified that it had. It could
invent all sixty and every gate stayed green.

This file makes the handoff a contract with two mechanical checks, in both directions.

## The two directions, and why both

Requirements-engineering practice (ISO/IEC/IEEE 29148) is explicit that one direction is not
enough. Forward traceability shows whether coverage exists; backward traceability surfaces
artifacts that no longer justify themselves. Teams auditing a suite for the first time typically
find **10–20% of it is orphaned** — tests validating nothing current.

Applied here:

| Direction | Question | Gate | Catches |
|---|---|---|---|
| **Forward** — invariant → falsifier | is every stated invariant something a feature would catch a violation of? | `invariant-uncovered` | a design that states a rule nobody proves |
| **Backward** — falsifier → invariant | does every falsifier cite a rule that actually exists? | `falsifier-orphan` | **an invented falsifier** — the hole this contract was written to close |

The backward check is the important one. A forward-only contract lets the planner cite nothing, or
cite an id it made up, and still pass.

## The id

```
INV-<AREA>-<N>
```

`<AREA>` is uppercase letters (the component or subsystem), `<N>` is a positive integer, unique per
area. `INV-BOD-1`, `INV-LEDGER-3`, `INV-TRACER-2`.

This follows the id family this harness already uses — `A-NNN` for assumptions, `X-NNN` for
cross-cutting rows, `REQ-<AREA>-<NNN>` and `TCON-<AREA>-<NNNN>` in the test-design skill. Do not
invent a different shape; consistency is what lets one regex find them all.

**An id is permanent.** Never renumber, never reuse. If an invariant is withdrawn, mark the row
withdrawn and leave the id dead — a `falsifier` in git history that cites it must stay resolvable.

## Where invariants live

In the design document, in a table. One row per invariant, **not** one row per component: a
component with three invariants gets three rows and three ids.

```markdown
| Id | Component | Invariant — must hold for EVERY input | Observable seam |
|---|---|---|---|
| `INV-BOD-1` | `applyBod` | A rejected BOD leaves state exactly as it was — validate before mutate, never clear-then-fail | return value + full state comparison before/after |
| `INV-BOD-2` | `applyBod` | After a successful BOD the total equals exactly the sum of seeded balances, discarding whatever total existed before | sum over `snapshot()` |
| `INV-BOD-3` | `LedgerCore` | A correlationId reused after an intervening BOD is applied again, not replayed from cache | response bytes of the second application |
```

Markdown, not JSON, deliberately: it is the format the design-facilitator already produces unprompted, it
stays readable in the document it belongs to, and it matches how `docs/assumptions.md` and
`docs/cross-cutting.md` are already parsed. The id column is the machine-readable part.

## What counts as an invariant

**It holds for every input.** "Returns 100 for this input" is an example wearing an invariant's
name. Write *always* or *never*, and mean it.

Good shapes, from the property catalogue: conservation, idempotency, monotonicity, round-trip,
ordering, exactly-once, all-or-nothing.

**It is falsifiable by a wrong implementation you can describe.** If you cannot finish the sentence
*"an implementation that … would violate this"*, it is a wish, not an invariant.

**It is not a restatement of the code.** An invariant derived from reading the implementation says
whatever the implementation does, including its bugs. Invariants come from the requirement.

## Citing an invariant from a falsifier

A `falsifier` in `feature_list.json` names the wrong implementation the verification catches, and
cites the invariant that wrong implementation would violate:

```json
"falsifier": "An applyBod that clears state before validating, so a payload with a duplicate
              accountId leaves the ledger empty and then rejects [INV-BOD-1]"
```

The citation is `[INV-BOD-1]` in square brackets, anywhere in the string. More than one is fine
when a single wrong implementation breaks several rules.

**Cite the id you actually derived from.** A citation added afterwards to satisfy the gate is worse
than no citation: it converts an honest gap into a false claim of coverage, and the gate then
reports green on a feature nobody checked. If a feature's verification genuinely proves something
no invariant states, that is a design gap — write `NEEDS DESIGN: no invariant covers <what>` and
let the design-facilitator answer it.

## When there is nothing to derive from

Do not invent one. The planner's rule is unchanged and this contract makes it enforceable: a
`falsifier` with no invariant behind it is a guess wearing the costume of a requirement.

Write `NEEDS DESIGN: no invariants stated for <component>` into the feature's `checkerNotes`. The
router sends it to the design-facilitator, which is the role that owns the answer.

## The gates

Both are **opt-in on the first id**: a project whose designs state no `INV-` ids sees neither, so
adopting an existing repo does not produce a wall of findings on day one
(`adopting-an-existing-project.md`). The moment one design adopts ids, both start measuring.

```
invariant-uncovered   warn   an INV- id stated in a design that no feature's falsifier cites
falsifier-orphan      warn   a falsifier citing an INV- id that exists in no design document
```

`falsifier-orphan` is deliberately *not* a blocker even though it catches invention: on a real
project the first run of a new traceability check surfaces a backlog, and a wall of blockers is how
a gate teaches people to ignore it. It is a warning that the adoption ratchet then locks — the count
may not grow.

**What neither gate can check:** whether the citation is *apt*. A falsifier can cite a real
invariant it has nothing to do with, and both gates pass. That is the reviewer's job — the checker
asks whether the wrong implementation named would actually violate the rule cited. Machines catch
the missing and the fabricated; judgement catches the mismatched.

## Worked example

Design states:

```markdown
| `INV-BOD-1` | `applyBod` | A rejected BOD leaves state exactly as it was | return value + before/after state |
```

Planner writes:

```json
{
  "id": "feat-bod-validation",
  "kind": "prove",
  "verification": "./mvnw -q test -Dtest=LedgerCoreInvariantTest",
  "falsifier": "An applyBod that clears accounts before validating the payload, so a duplicate
                accountId leaves the ledger empty and then rejects [INV-BOD-1]"
}
```

Test-implementer writes a property asserting state is byte-identical after a rejected BOD, with a
traceability header naming `INV-BOD-1`.

Forward: `INV-BOD-1` is cited — covered. Backward: `INV-BOD-1` exists — not an orphan. The chain
from requirement sentence to failing assertion is now walkable in both directions, by a machine.
