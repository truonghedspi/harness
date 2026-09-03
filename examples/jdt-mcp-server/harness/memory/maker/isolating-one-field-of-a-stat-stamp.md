# Isolate each field of the triple `(mtimeMs, size, ino)`: write in place, not temp+rename

**When to apply:** The oracle must prove that a multiple comparison actually requires each side. Meet at
`feat-file-sync-watcher`, turn 3, after checker indicates that twelve shifts only pin one out of three
side of the decision `Changed`.

## Why can temp-write-then-rename never pin mtime or size

The write path `writeFileSync(temp) → renameSync(temp, destination)` changes the inode in **all** cases. I use that way
There is always at least one sufficient clause to make the union correct, so remove the `mtimeMs` clause or the `size` clause from the source code.
Don't do any red shifts. If you want to isolate a field, you must completely abandon the rename method.

The leverage is on the behavior of `writeFileSync` to an **already existing** path: on macOS it opens the file with
`O_TRUNC` and not `unlink`, so the inode remains the same. Measured:

| Operation | ino | size | mtimeMs |
|---|---|---|---|
| `writeFileSync(p, content same number of bytes)` | keep | keep | change |
| `writeFileSync(p, content different number of bytes)` then `utimesSync(p, old mark, old mark)` | keep | change | keep |

Those two lines are two shifts, each killing exactly one mutant. This is also the most common recording method in practice.
not a borderline case: an in-place editor, and `cp -p` / `rsync --times` / `git checkout` both
restore old mtime.

## Two details make the case determined instead of chance

1. **Freeze the baseline into the past, before enabling the observable component.** If the baseline is "now" then
   ca is only true when the filesystem has a fine enough mtime resolution. Set `utimesSync(p, new Date(1_700_000_000_000), ...)`
   **before** `start()` causes the new mtime (current year) to be years off from the baseline, true for all degrees
   resolution, and let the initial scan latch the background image instead of racing to a flush.
2. **`writeFileSync` then `utimesSync` must be in the same sync block.** No `await` in between
   then no `setTimeout` callback can intervene, so the watcher can only scan for completed status
   all — mtime has been returned. If an `await` gets caught in the middle, an intervening flush will see mtime
   In the intermediate case, the case is still green, while the "ignoring size" mutant is alive.

Always confirm directly with `statSync` before/after that exactly one field is distinct. There is no confirmation
That being said, I'm talking about a different mechanism than the one I thought.

## Measurement trap: case duration is not evidence of the case

A run under mutant reported 209 s for the red case, far exceeding `{ timeout: 30000 }`. Measure again four times
The machine is idle for exactly 15.14 s. The reason is that the load average is above 5 due to other agents running the parallel suite
song. Before looking for crashes in the spec file, run it again when the computer is idle and look at the `uptime`.