# Loop Goal — Harness

The loop reduces to three things (Lesson 13): a **goal**, a **verification method**, and a
**stopping condition** judged independently. Fill each with the project's real values.

## Objective (goal)

Keep this repository a working consumer of its own harness: every feature is independently checked,
`./init.sh` is green, coverage reports 13/13, and verifier reports zero blockers.

## Verification method

- Per feature: the feature's own `verification` command must pass at the right level
  (`docs/testing-standards.md`).
- Baseline: `./init.sh` green.
- Termination is decided by the **checker**, not the maker (Lesson 9/13).

## Iteration contract (maker)

One iteration = advance exactly ONE feature by one bounded step (implement + verify + record
evidence), or repair a red baseline. Nothing else. Partial progress is a checkpoint:
`readyForCheck` stays false and the router returns the same active feature to the maker. The maker
sets `readyForCheck: true` only when the complete feature behavior is green, but never sets
`status: done`.

## Gates (checker)

`done` requires checker approval. `readyForCheck: true` means the feature has been handed off and
may unblock dependent implementation, but is not accepted. `run-loop.mjs` dispatches the checker
only after every non-blocked open feature has a complete handoff. The checker then judges the
integrated delivery as one final batch. A rejection clears that feature's handoff and returns it to
the maker; another checker session is allowed only after every remaining feature is handed off
again. Each rejected final-review cycle, not each maker checkpoint, consumes `attempts`.

## Stop conditions (end the loop, write session-handoff.md, escalate)

- The objective's stopping condition holds (all features `done` + baseline green).
- `./init.sh` is red twice in a row for the same cause.
- A requirement/architecture decision is needed that `docs/` doesn't answer — mark the affected
  feature `blocked`, move to the next eligible feature; stop only if NO feature is eligible.
- Any irreversible or production-touching action would be required.
- The iteration budget (`node loop/run-loop.mjs N`) is exhausted.

## Human checkpoints (never automated)

- Ambiguous requirements / architecture decisions not in `docs/`.
- Anything irreversible (data loss, prod writes, external side effects).
- Any change to what scaffolded targets receive by default.
- Any proposal to weaken a gate or reclassify a finding's ownership layer.
