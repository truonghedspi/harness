# A sister oracle written first can be red without anyone running to it

Context: feat-workspace-pool (build) builds `src/workspace/workspace-pool.ts`. Verification command of
The feature only runs its two test files and both are green.

## Problem

The test-design layer has prewritten `test/integration/pool-lifecycle.integration.spec.ts` for a feature
`prove` else (feat-prove-pool-lifecycle, then `not-started`). This file is aimed right at the module
The build feature has just been created, and it loads the module with `await import(...)`. Before there was a deployment, it was red
Because it lacks a module — it is outside the baseline gate. After deployment, it works really well, and
one of the three red conditions.

Nothing in the process touches it: the build feature's verification command doesn't call it,
`npm test` does not capture the `test/integration` directory, nor does baseline gate.

## How to detect

List the entire test tree (`find test -type f`) instead of just reading the feature files declared in
`touches`. Any existing test files that mention the newly deployed module name must be run
turn, even if it belongs to another feature.

## Conclusion drawn

When a `build` feature creates a module for the first time, look for any prewritten oracles targeting that module and
run them. Results fall into one of three groups, and should be clearly classified in `checkerNotes`:

| Results | Meaning | Processing |
|---|---|---|
| Green | The next prove feature has proof available | Noted, not hindered |
| Red due to deployment error | Falsifier of the build feature is not broad enough | REJECT |
| Red due to oracle's own error | The next prove feature will encounter | APPROVE with `FOLLOW-UP:` clearly states that the assertion line is wrong |

This time the results are in group three: oracle confirms that all workspaces that have been evicted must be permanently absent
permanent in `pool.status()`, but its fixture itself acquires that workspace, so workspace
duly reappeared. Misclassifying this group as an implementation error will cause the maker to fix it
code is correct.