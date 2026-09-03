# The green shift ends but the process never exits

**When applicable:** Every feature owns an OS-level resource that keeps the event loop alive —
server is listening, socket, watcher, child process — and has a `shutdown()`/`close()` function that returns
promise. promise. Found in `feat-daemon-supervisor` (2026-08-23), right now the maker has just finished patching another crash.

## Why old notes are not enough

Note `test-timeout-does-not-cover-the-after-hook.md` talks about an `await` NOT settled in the hook
`t.after`. Maker has patched that layer right: every shutdown call goes through a `withBudget` function there
`Promise.race` with timer, so overdue becomes a named red shift.

The other layer is on the opposite side and `withBudget` is not visible: **shutdown settle EARLY then leave
Resources are alive.** There's nothing to wait for, so there's nothing to budget for. All affirmations are green,
The runtime prints `ok 1..9`, then freezes because handle listening still keeps the event loop. There is no summary line,
no exit code, no red shift.

## Cheapest Mutant discovered it

Exact test that checker-prompt requires: flip a comparison. In the server close function there is an exit
early form `if (!server.listening) { resolve(); return; }`. Change to `if (server.listening)`. Conclusion
Result: 9/9 green, process must SIGKILL at 40 s.

Inference trap to avoid: all indirect assertions are still true under this mutant. The socket file is still unlinked,
The lock is still released, all child processes are still stopped, the next launcher is still bindable. Only
handle listening alone is alive, and none of the component's public APIs expose it.

## How to measure safety for the agent itself

Never run a test command while mutating this class. macOS doesn't have `timeout`, so use it
a scripted executable: `spawn(cmd, { detached: true })` then `process.kill(-pid, "SIGKILL")` when
limit — kill the entire process group, because the child process spawned by spec will survive if only the process is killed
father. A previous checker session stuck its agent exactly in this place.

## Condition required in `checkerNotes`

Requires a case that proves **the process exited**, not a case that proves the shutdown function returns:
spawn the child process running the component and then call shutdown, asserting that it exits with code 0 in a bank
The book is clear, if it is overdue, it will be killed and the red flag will have a name. The evidence needed is a red shift in the lower budget
mutant flips the analogy, not a green run.