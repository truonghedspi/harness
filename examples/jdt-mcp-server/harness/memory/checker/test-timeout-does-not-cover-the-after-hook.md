# `{ timeout: N }` declared on the test case does not cover the `t.after` hook

**When applicable:** any feature with resources must be closed in a cleanup hook — server, socket,
child process, watcher — and spec cleanup with `t.after(async () => ...)`. First meeting here
`feat-daemon-supervisor` (2026-08-22).

## It looks like there was a time constraint

All four cases of the spec declare `{ timeout: 15_000 }`. Step 5 of checker-prompt skimming will count as
pass: has a number, has a limit, seems impossible to hang.

Measurements say otherwise. Under the mutant "shutdown does not destroy accepted connections", the runtime is 60
seconds that only indicates the completion of shift 1; Last time I measured it, I let it run for more than 8 minutes and nothing happened. Dear
The function of case 2 has finished running all confirmations; The thing that hangs is `t.after` calling `handle.shutdown()` →
`server.close()`, and `server.close()` never call callbacks while the connection is still open.

Cause: `node --test` applies `timeout` to **test case function body**, not hooks. Structured hook
separate timeout configuration, unlimited by default. An `await` does not block in `t.after` thus hanging indefinitely
and doesn't generate a single error line.

## Why is this a checker's job and not a small matter?

`npm run test:integration` scans the entire spec tree. One degeneration in the shutdown branch will swallow it whole
Baseline budget in silence — exactly what step 5 exists to block. And it only shows up under mutants, so
A test run that only runs the pristine version will never see it.

## Cheap way to check

When constructing a mutant for a lifecycle component, add a mutant **to the correct cleanup path** (remove
`destroy()`, omit `close()`, omit `kill()`), then run with a wall clock and a backup `pkill` command
room. If the run does not end within the shift's declared budget, the cleanup hook is empty
forced — regardless of each shift's timeout.

Requires writing to `checkerNotes`: the cleanup hook must carry its own budget (`Promise.race` with timer
red shift when overdue), or must remove client-side resources before calling shutdown. Evidence needed
there is **a red shift in the budget under mutant**, not a green run.