# Constraints — {{PROJECT_NAME}}

Hard rules the agent must not violate (Lesson 3/4). Keep these few, absolute, and — where
possible — mechanically enforceable (a lint rule or a check in `init.sh` beats a sentence here).

## MUST

- MUST run `./init.sh` to green before claiming any feature done.
- MUST keep one feature `active` at a time (WIP = 1).
- MUST record verification evidence in `feature_list.json` before a feature becomes `passing`.
- MUST stop and set `status: blocked` (with a reason in `checkerNotes`) once a feature's
  `attempts` reaches its `maxAttempts` — a timebox, not a suggestion. A hard problem retried
  forever with no budget is how a loop silently burns unbounded time/compute on one feature.
- MUST give every long-running or integration-level test a bounded, stack-appropriate per-test
  timeout mechanism (e.g. JUnit `@Timeout`/`@InterruptAfter`, pytest-timeout, `go test -timeout`,
  a `[Timeout]` attribute in .NET) — a single hung test must not be able to consume the whole
  `./init.sh` baseline timeout budget, and must fail loud and fast instead of hanging silently.
- [Project-specific MUST rules — e.g. respect module dependency direction, use fixed-point money]

## MUST NOT

- MUST NOT let the worker set `status: done` — only the checker or a verification script does.
- MUST NOT modify files outside the active feature's scope.
- MUST NOT weaken a test or a vector to make it pass.
- MUST NOT set `status: blocked` without a concrete reason in `checkerNotes` (or a matching
  `DECISIONS.md` entry) — an unexplained `blocked` is indistinguishable from an agent quietly
  giving up, and the checker/loop cannot judge whether it's legitimate.
- [Project-specific MUST NOT rules — e.g. no network calls in unit tests, no writes to prod]

## Enforcement

For each rule above, note how it is checked (Lesson 10 — turn rules into executable checks):

| Rule | Enforced by |
|---|---|
| Baseline green | `./init.sh` |
| WIP = 1 | review / `feature_list.json` state |
| Attempts timebox respected | `verify-harness.mjs` (flags `attempts >= maxAttempts` with `status` still not `blocked`) |
| Long-running tests have a bounded timeout | code review / checker spot-check |
| `blocked` has a real reason | `verify-harness.mjs` (flags empty `checkerNotes` with no matching `DECISIONS.md` mention) |
| [rule] | [lint rule / script / check] |
