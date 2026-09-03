# The flaky bug fixed inside oracle could be a product being moved out of view bug

**When to apply:** Maker reported fixing a choppy test case by adding the mechanism to the file
spec — decoy file, wait loop, startup delay, retry — without touching `src/`. Meet at
`feat-file-sync-watcher`, turn 2.

## What looks like a clean oracle fix

Maker measured 2 out of 4 red runs, correctly diagnosing the root cause (libuv starts the FSEvents stream
after `fs.watch()` has returned; writes that fall into that window are never delivered), then close
windows with a primer file written in the spec. He also clearly states the boundary: edit `src/` in one edit
oracle is the fastest way to get rejected. That boundary is correct, and the push really doesn't weaken the oracle
— I tested it with behavior: the three mutants that made the file disappear from the scan set still died, so the kick was no
capable of rescuing a missing message.

## The question that both sides ignored

Does the newly added mechanism have a counterpart in the product? Here it is no: no one records `.fs-watch-probe`
help daemon. That means the jitter isn't a test artifact — it's a real vulnerability
of the deployment, and the recent fix makes it no longer detectable.

Quick way to confirm, without debating the design: look up `harness/docs/assumptions.md` to see if there is a line
Which is asserting the opposite. A-014 reads "A recursive filesystem watcher observes every relevant
change", the status is still `assumed`, the evidence box is blank — while the maker has measurements that refute it.
An assumption refuted by measured evidence that the corresponding current does not change state is a defect
Specific, namable, not feeling.

## What the checker must do

1. Ask if the new mechanism has a counterpart in the product. If not, it's a product defect, not
   test error.
2. Look up `assumptions.md` before concluding. The flow of contradiction turns a doubt into a purposeful matter
   clear ownership.
3. Still respect the maker's scope boundaries. Don't make him edit `src/` during the oracle edit; please
   Name the missing work and assign it to the planner or design layer to create the scope. Do not mention names
   is to accept a silent error.

## Second lesson of the same turn: a multi-field comparison requires a case for each field

The implementation decides "changed" with the triple `(mtimeMs, size, ino)`. Pass 1 detects the `ino` clause
No cases were stapled; maker adds exactly one shift to `ino` and stops. The remaining two sides can still be deleted
The test is not red — in which the `mtime` part is the heaviest part, because the override `writeFileSync` keeps the inode intact
so once fixed in place the same number of bytes only differs in mtime.

Rule of thumb: when seeing an expression `a !== a' || b !== b' || c !== c'`, requires a shift for EACH side
In the SAME turn, each shift pins the remaining sides equally. State the complete list at the first refusal
fairy; Closing a shaft every turn is a way to trickle holes to infinity and burn out `maxAttempts`.