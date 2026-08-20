# Loop Goal — JDT MCP Server

The loop reduces to three things (Lesson 13): a **goal**, a **verification method**, and a
**stopping condition** judged independently. Fill each with the project's real values.

## Objective (goal)

Advance `harness/feature_list.json` until every feature is `done` with green evidence.

Concrete end state: all 32 features in `harness/feature_list.json` are `done`, `./harness/init.sh`
is green, and `node harness/skills/feature-planning/scripts/check-plan.mjs --target harness --json`
still reports `green: true` (every one of the 30 `INV-` ids in `harness/docs/design/runtime-model.md`
and `harness/docs/design/tool-surface.md` stays cited by a passing feature's falsifier — a feature
going `done` must never leave an invariant uncovered).

## Verification method

- Per feature: the feature's own `verification` command must pass at the right level
  (`harness/docs/testing-standards.md`).
- Baseline: `./harness/init.sh` green.
- Termination is decided by the **checker**, not the maker (Lesson 9/13).

## Iteration contract (maker)

One iteration = advance exactly ONE feature by one step (implement + verify + record evidence),
or repair a red baseline. Nothing else. The maker may set `readyForCheck: true` but never
`status: done`.

## Gates (checker)

`done` requires checker approval. The checker's job is to falsify, not confirm: re-run the
recorded evidence, exercise the highest test level the change touches, and reject anything that
doesn't reproduce.

## Stop conditions (end the loop, write harness/session-handoff.md, escalate)

- The objective's stopping condition holds (all features `done` + baseline green).
- `./harness/init.sh` is red twice in a row for the same cause.
- A requirement/architecture decision is needed that `harness/docs/` doesn't answer — mark the affected
  feature `blocked`, move to the next eligible feature; stop only if NO feature is eligible.
- Any irreversible or production-touching action would be required.
- The iteration budget (`node harness/loop/run-loop.mjs N`) is exhausted.

## Human checkpoints (never automated)

- Ambiguous requirements / architecture decisions not in `harness/docs/`.
- Anything irreversible (data loss, prod writes, external side effects).
- Any `docs/assumptions.md` row that turns `needs-human` — none currently are; `A-006`–`A-014` are
  `assumed` and settleable by a spike per the exhaustion ladder, not a question for a person.
- Any `docs/cross-cutting.md` row a feature is about to close (mechanism + owner + enforcing rule) —
  all ten (`X-001`..`X-010`) are still open with a recommendation attached; a maker/planner may act on
  the recommendation but closing the row itself is the design-facilitator's call with a human.
- Whether to build the flagged Streamable HTTP front door (`A-003`) before `docs/cross-cutting.md`
  `X-010` (Origin validation / localhost binding / auth) gets an `INV-` id — see `DECISIONS.md`
  2026-08-20, "Streamable HTTP front door deferred out of this cut."
