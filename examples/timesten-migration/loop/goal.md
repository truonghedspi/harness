# Loop Goal — TimesTen → Aeron migration

## Objective

Advance `feature_list.json` until `node tools/coverage-check.mjs` reports 100% of inventory
units `done` or human-approved-excluded, with every evidence gate green.

## Iteration contract (maker)

One iteration = advance exactly ONE unit by exactly ONE pipeline state
(`inventoried → specced → golden-mastered → implemented → parity-verified → done`),
or repair a red baseline. Nothing else.

## Gates (checker)

`done` requires checker approval. The checker's job is to falsify, not confirm:
re-run evidence commands, compare digests, audit vector minimums, audit the spec's
"uncaptured behavior" list, run the determinism scan and replay test.

## Stop conditions (end the loop, write session-handoff.md, escalate)

- `./init.sh` red twice in a row for the same cause.
- A docs/04 decision required with status `needs-human` and no sign-off — mark the affected
  feature `blocked`, move to the next eligible feature; stop only if NO feature is eligible.
- The pre-cutover re-extraction flags drift on any covered unit (the frozen-logic assumption
  broke — human decision needed before continuing).
- Any action that would touch a production TimesTen instance, or any write through the
  TimesTen MCP server outside the designated scratch schema.

## Human checkpoints (never automated)

- Exclusion approvals (`inventory/exclusions.json` approvedBy)
- docs/04 decisions marked needs-human
- Phase 3 → Phase 4 transition (shadow run / cutover)
