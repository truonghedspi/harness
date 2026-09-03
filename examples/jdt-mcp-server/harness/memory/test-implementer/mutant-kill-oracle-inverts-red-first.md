# The red evidence of the oracle killing mutants comes from mutants, not from missing features

## Observe

`feat-prove-workspace-identity` is a quest to kill living mutants, not a new behavior.
`project-router.ts:47` and `workspace-pool.ts:171` have already agreed, so oracle requires GREEN in
first run on unedited source code. The default red-first rule ("test must be red first") is reversed:
One red here can only mean that the oracle is wrong, or that the two components are really out of sync.

## Evidence

The correct cycle for this type of task consists of four steps, and all four must be recorded in `evidence`:

1. Run on clean source code, must be green.
2. Apply the temporary mutant at the correct line that the mutant report names, run again, it turns red because of an assertion error.
3. Revert mutant, check `git diff src/` is empty.
4. Run again one last time, must be green again.

On this feature, changing the digest encoding (`hex` -> `base64url`) at the router side only makes red
Cross seam comparison conditions. Mutant changes input hash (`canonicalRoot` -> `basename(canonicalRoot)`)
At the pool side, we add a condition to prevent merging two projects. Applying mutant on one side is enough as required,
but running both lines shows that oracle catches both types of mutations, not just one.

## Rules for next time

When a feature has `kind: prove` and `context.note` describes a living mutant, the run is not considered
The first green sign is "useless test" and then discarded. On the contrary, do not end the task when it is new
There is green evidence: without the mutant step, there is no proof that the oracle saw that line of code.
Always revert the mutant and check that the working tree is clean before handing over.

The constraint that comes when the spec leaves the algorithm open (here is X-005): only compare two sides to EACH OTHER, not to
literal. The consequence must be clearly stated in `evidence` so that the checker does not have false expectations - mutants apply exactly the same
Both sides will survive, and it's not the oracle's fault.