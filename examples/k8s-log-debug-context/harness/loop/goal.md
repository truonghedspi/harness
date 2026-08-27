# Loop Goal — Kubernetes Log Debug Context

The loop reduces to three things (Lesson 13): a **goal**, a **verification method**, and a
**stopping condition** judged independently. Fill each with the project's real values.

## Objective (goal)

Deliver the approved Kubernetes Log Debug Context MVP: all 11 features are independently `done`,
`./harness/init.sh` is green, and the namespace-isolated journey proves emitted opted-in pod log →
collector → sanitized OpenSearch record → authenticated bounded MCP diagnostic context.

## Verification method

- Per feature: the feature's own `verification` command must pass at the right level
  (`harness/docs/testing-standards.md`).
- Baseline: `./harness/init.sh` green.
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
- Deploying or testing against any shared or production Kubernetes cluster.
- A-006 preflight proves node logs inaccessible and enabling the per-workload sidecar fallback
  would change the approved default for that workload class.
