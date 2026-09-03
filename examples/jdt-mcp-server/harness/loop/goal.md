# Loop Goal — JDT MCP Server

The loop reduces to three things (Lesson 13): a **goal**, a **verification method**, and a
**stopping condition** judged independently. Fill each with the project's real values.

## Objective (goal)

Advance `harness/feature_list.json` until every feature is `done` with green evidence.

Concrete end state: all 36 features in `harness/feature_list.json` are `done`, `./harness/init.sh`
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
- Whether `feat-prove-routing`'s surviving mutant M12 becomes a new oracle feature or an
  accepted-risk row under `A-006`. Its `FOLLOW-UP:` marker has already consumed both of the router's
  `follow-up:feat-prove-routing:*` dispatches, so `loop/route.mjs` will never raise it again — it is
  invisible to the loop from here on and only a person can put it back. The second of the two
  branches (accept the risk) is itself a human call, which is why the 2026-08-22 planner pass did not
  pick one. Detail and the proposed `TCON-ROUTE-0008` fixture are in `progress.md` → Next, item 3.
- Can two concurrently live workspaces ever hold THE SAME canonicalized file URI? No line in
  `docs/assumptions.md` states this premise, yet it determines the level at which `INV-DIAG-3` must
  be proved. If YES (nested roots, shared source directories through symlinks, an outer reactor
  and inner module under `A-006`), the fixture must become two real JDT LS instances publishing on
  one canonical URI. If NEVER, an integration-level `INV-DIAG-3` condition cannot be falsified and
  its substantive content is at unit level — then `TCON-DIAG-0003` must be demoted rather than
  retained as a blind P0. Raised by the `feat-prove-diagnostics` checker (2026-08-25, item 7).
  Whichever branch is chosen, the premise must become a line in `docs/assumptions.md` — that is
  work for the design-facilitator and a person, not the planner.
  It does NOT block `feat-prove-diagnostics-identity`: that feature’s distinguishing axis judges the cache key
  (two `workspaceId` values colliding on one URI), not two JDT LS processes.
- Whether graceful stop (SIGTERM before the SIGKILL escalation) is a required behavior of
  `workspace-pool.terminate()`. Raised by the `feat-workspace-pool` checker on 2026-08-22: a mutant
  removing only `child.kill("SIGTERM")` leaves the whole suite green, because the 5 s SIGKILL
  escalation still reaps the child inside the test's wait budget. No `INV-` id in
  `docs/design/runtime-model.md` states a stop ordering, and `INV-POOL-3` only requires in-flight
  requests to settle — so the planner did not invent a falsifier for it (`DECISIONS.md` 2026-08-22,
  item 3). Pinning it needs a design invariant first, which is a design-facilitator + human call, not
  a decomposition one. Until then, JDT LS may be killed without ever being asked to exit cleanly.
- Whether `harness/init.mjs` should bound each baseline step with a wall clock. Its `run()` calls
  `spawnSync` with no `timeout`, so a hung step hangs `./harness/init.sh` forever rather than
  spending a budget. `docs/constraints.md` puts the per-test timeout MUST at the test level, but
  `node --test` cannot preempt a **synchronous** callback (measured 2026-08-22: a sync case spinning
  4 s under `{ timeout: 500 }` still reported `ok`), so no per-test option covers the seven
  synchronous cases in `test/integration/project-router.integration.spec.ts`. The only bound that
  works there is at the runner or baseline level, which is harness-layer code this project does not
  own — a person decides whether to raise it upstream (`DECISIONS.md` 2026-08-22, first entry).
- Whether to build the flagged Streamable HTTP front door (`A-003`) before `docs/cross-cutting.md`
  `X-010` (Origin validation / localhost binding / auth) gets an `INV-` id — see
  `DECISIONS/2026-08-20.md`, "Streamable HTTP front door deferred out of this cut" (archived on
  2026-08-23).
