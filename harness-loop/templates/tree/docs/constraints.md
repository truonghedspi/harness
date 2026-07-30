# Constraints — {{PROJECT_NAME}}

Hard rules the agent must not violate (Lesson 3/4). Keep these few, absolute, and — where
possible — mechanically enforceable (a lint rule or a check in `init.sh` beats a sentence here).

## MUST

- MUST run `./init.sh` to green before claiming any feature done.
- MUST keep one feature `active` at a time (WIP = 1).
- MUST record verification evidence in `feature_list.json` before a feature becomes `passing`.
- [Project-specific MUST rules — e.g. respect module dependency direction, use fixed-point money]

## MUST NOT

- MUST NOT let the worker set `status: done` — only the checker or a verification script does.
- MUST NOT modify files outside the active feature's scope.
- MUST NOT weaken a test or a vector to make it pass.
- [Project-specific MUST NOT rules — e.g. no network calls in unit tests, no writes to prod]

## Enforcement

For each rule above, note how it is checked (Lesson 10 — turn rules into executable checks):

| Rule | Enforced by |
|---|---|
| Baseline green | `./init.sh` |
| WIP = 1 | review / `feature_list.json` state |
| [rule] | [lint rule / script / check] |
