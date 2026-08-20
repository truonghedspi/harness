# Session Handoff — JDT MCP Server

The crash-handling oracle is blocked until the lsp-client and workspace-pool expose callable interfaces.

## Current Objective

- Goal: Implement TP-POOL-0002 conditions TCON-POOL-0004 through TCON-POOL-0006 as the red-first oracle for `feat-prove-pool-crash-handling`.
- Current status: Stopped without test changes because a behavioral red run is impossible before both build dependencies exist.
- Branch / commit: current branch / HEAD `45cc0fa`
- Revalidated: 2026-08-20 iteration 3; both dependencies remain `not-started`, no callable `src/` interface exists, and `./harness/init.sh` is green.

## Completed This Session

- [x] Confirmed the router selected `test-implementer` for `feat-prove-pool-crash-handling`.
- [x] Ran `./harness/init.sh` green.
- [x] Re-read TP-POOL-0002 and its three validated condition shards; their required seams remain unavailable.
- [x] Read the required integration template and anti-pattern rules.
- [x] Inspected only permitted interface/signature surfaces; did not read implementation bodies.
- [x] Reproduced the same dependency blocker after the prior handoff commit; the router still selects this oracle despite both build dependencies being ineligible.

## Verification Evidence

| Check | Command | Result | Notes |
|---|---|---|---|
| Baseline | `./harness/init.sh` | PASS | `=== Baseline green ===` |
| Router | `node harness/loop/route.mjs` | PASS | Selected `test-implementer` for `feat-prove-pool-crash-handling`. |
| Dependency readiness | `node harness/tools/feature.mjs --deps feat-prove-pool-crash-handling` | BLOCKED | `feat-lsp-client` and `feat-workspace-pool` are both `not-started`; no callable production interfaces exist. |
| Revalidation baseline | `./harness/init.sh` | PASS | Iteration 3 again ended with `=== Baseline green ===`. |

## Files Changed

- `harness/session-handoff.md`

## Decisions Made

- Did not create a test whose first failure would be `ERR_MODULE_NOT_FOUND`, a compile error, or a missing fixture. The role contract requires a wrong behavioral assertion for valid red evidence.
- Did not invent lsp-client request, workspace acquisition, child-process observation, or kill signatures. That would decide production interfaces rather than implement validated conditions against documented ones.
- Did not mark the feature `blocked`: its `attempts` remain `0/3`, and the dependency DAG already records the concrete prerequisite state.

## Blocker

TP-POOL-0002 requires a real child process with one or more in-flight LSP requests, a parameterized per-call deadline, and the ability to kill that child after either no response or a partial Content-Length frame. Neither dependency currently supplies an interface through which the test can establish or observe those states.

The router is repeatedly dispatching this proof before its build dependencies are eligible. Treat that ordering as a harness-routing defect; rerunning the same test-implementer iteration cannot create behavioral red evidence.

## Recommended Next Step

Implement the public/test interfaces for `feat-lsp-client` and `feat-workspace-pool`, then reroute this oracle. Add `test/integration/pool-crash-handling.integration.spec.ts`, run its feature verification, and record red only when imports and fixtures succeed but an INV-POOL-3 behavioral assertion fails.
