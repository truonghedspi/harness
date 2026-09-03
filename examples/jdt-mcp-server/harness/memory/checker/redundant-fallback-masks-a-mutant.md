# Redundant redundancy mechanism obscures mutants

Context: verify feat-workspace-pool. The process stop function has two levels:

```ts
child.kill("SIGTERM");
const escalation = setTimeout(() => child.kill("SIGKILL"), graceMs);
```

## Problem

Mutant deleting the line `child.kill("SIGTERM")` still gives green results on both integration tests, even though the test
clearly states "closing the pool must terminate the real process it started". Root cause: floor
SIGKILL after 5 seconds still revokes the child process, while the test's waiting budget is 10 seconds. Attendance floor
The room absorbs the exact defect that the mutant created.

If we stop here and conclude "testing does not prove stopping the process", the verdict will be wrong.
The substitution mutant deletes the entire function body (`return` right at the beginning of the function) making both tests red after about 10.8
seconds per test. Stopping the process is proven; only the order SIGTERM before SIGKILL is
not yet fixed.

## Conclusion drawn

Before designing a mutant, read through the function body and count the number of mechanisms working towards the same result. When available
two or more mechanisms:

1. Delete the whole function to check whether the overall result is proven or not.
2. Delete each individual mechanism just to answer a narrower question: is the mechanism individually fixed
   no.

A mutant that survives step 2 is not vulnerable if the corresponding behavior is outside of the falsifier
feature. This time, "pause gently before killing" belongs to feat-prove-pool-crash-handling, so just
Note, do not REJECT.