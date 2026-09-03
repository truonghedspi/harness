# The prove feature's oracle has done dependencies: each condition needs its own mutant

## Observe

`feat-prove-pool-crash-handling` does not name either mutant, but both are dependent
(`feat-lsp-client`, `feat-workspace-pool`) is `done`. The INV-POOL-3 behavior thus exists correctly, and
Green oracle on first run. This is not a sign that the oracle is useless, nor is it the case
"named living mutant" recorded in `mutant-kill-oracle-inverts-red-first.md`: here the proof
red must be created by the test-implementer itself.

## Evidence

The three plan conditions describe three different failure modes of the same invariant. A single mutant
only one mode can be proven. Four self-constructed mutants gave clearly distinguishable results:

| Mutants | Failure mode | Red conditions |
|---|---|---|
| Remove the reject loop in the `exit` | handler overdue deadline | all three |
| `break` after first reject | only settle one entry | only TCON-POOL-0005 |
| Returns results from frames with insufficient bytes | unfinished answer | only TCON-POOL-0006 |
| Resolve all pending results with the old result | old answer | all three |

The two middle mutants are valuable evidence: they show that each condition captures the correct failure mode
its own, not all three together for a common cause.

## Rules for next time

When the `prove` feature has all dependencies `done` and does not name the mutant, it builds a failure mode
falsifier lists it as a temporary mutant, and records in `evidence` all conditions that are NOT under the mutant
same reason. A mutant that reddened all three conditions did not distinguish between redundant and unconditioned conditions
need. Always revert with `git checkout` and check for `git status --porcelain src/` to be empty before
hand over.