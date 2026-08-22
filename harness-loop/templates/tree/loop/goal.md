# Loop Goal — {{PROJECT_NAME}}

The loop reduces to three things (Lesson 13): a **goal**, a **verification method**, and a
**stopping condition** judged independently. Fill each with the project's real values.

## Objective (goal)

Advance `feature_list.json` until every feature is `done` with green evidence.

> REPLACE with the concrete end state, e.g. "All features `done`, `./init.sh` green, and
> `node check-coverage.mjs` reports 13/13."

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

`done` requires checker approval. `run-loop.mjs` dispatches the checker only when at least one
complete feature-level claim has `readyForCheck: true`; maker checkpoints do not spend a checker
session. The checker falsifies rather than confirms: re-run the recorded evidence, exercise the
highest test level the change touches, and reject anything that doesn't reproduce. Each rejection,
not each maker checkpoint, consumes one `attempts` review-cycle budget.

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
- [Project-specific approvals]
