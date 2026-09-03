# Count child processes: each child must be recorded in a separate log file, not in the same file

**When to apply:** oracle Level 3 needs to count the number of real processes spawned (INV-POOL-5, INV-SHIM-2,
INV-SHIM-4 — all invariants "N parallel calls create only one process").

## Symptoms

Fixture `java` writes its pid and argv to **a** shared file using `{ ... } >> log`. When
Two children run in parallel, test confirms to see 2 records but can only read 1, with notification
`1 !== 2`. At first glance, it looks like the spawned pool is missing a process — meaning the code is mistakenly to blame
Source is being checked.

## Root cause

`{ printf; printf; printf; } >> file` in sh is not an atomic write: each `printf` is one
private syscall. The two children write alternately as `PID a / ARG… / PID b / ARG… / END / END`. Division
Analyzing the status of reading `PID b` while building record a will overwrite record a and lose it. Number of copies
write read becomes a function of the scheduling moment, not of the behavior to be demonstrated.

## Correct way

Each child writes to a separate file named after its own pid: `} > "$LOGDIR"/"$$".txt`. Oracle reads it all
directory and ignore files that do not have an `END` line (record in progress). No more interlacing, and file numbers
is the actual process number.

Attached: after `acquire` returns, the child has just finished `exec`, so it is not necessarily logged. Have to wait one
settling period (about 400 ms) then confirm "exactly one process", otherwise counting only proves
Prove that the redundant process has not appeared yet.

See `test/integration/workspace-pool-spawn.integration.spec.ts` (feat-workspace-pool, attempt 1).