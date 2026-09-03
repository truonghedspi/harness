# The FSEvents startup window swallows the first write — and shows up as silent, not false

**When applicable:** All test cases that control a temporary directory pass
`fs.watch(dir, { recursive: true })` on macOS. Found in `feat-file-sync-watcher`, turn 2, when added
The four new cases revealed errors that were already present in the eight old cases.

## What looks like a source code error is actually an environmental problem

libuv starts the FSEvents stream on another thread, **after** after `fs.watch()` has returned. Recorded times
falling between those two marks is not delivered late — it is never delivered. Because
The watcher only flushes when there is a wakeup event, resulting not in a false positive but in silence
Absolutely: the case of hanging up all the waiting budget and then reporting a timeout, exactly the type of failure that is easy for readers to read
attributed to the implementation.

Specific measurements before editing: 2 out of 4 runs of `npm run test:integration` red. Run a file separately
spec is 12 out of 12 times green — the window is only wide enough when the machine is loading, but `--test` runs every
spec file. The victim is **whichever case is listed first**, not fixed, so it is added twice in a row
two different cases. That's the identifying sign: if every time it turns red, it's a different case and always in the first wait
First of that case, test the boot window before testing the diff.

## How to fix it, it's all in the spec file

1. Write a decoy file that the watcher ignores **in structure** — here `.fs-watch-probe`, not
   `*.java`, not `pom.xml` — so it cannot appear in any notifications. It just
   used to wake up the event stream.
2. Only kicks when `watcher.lastChangeAt` is `undefined`, i.e. only inside the startup window. When one
   Any event has been delivered, the stream is live, and the push just disturbs the timing.
3. A nudge cannot cover a missing message: waking up the watcher causes it to rescan and compare the entire tree
   is tracked, so changes that are not reported in the implementation are still not reported. Here's why
   This fix does not weaken the oracle — verified by rebuilding all nine mutants after correction,
   all are still dead.
4. If you need an accurate background image, put all the preparation **before** `start()`, so that the scan starts
   dynamically latch the background image, instead of having a flush race through the prepare operation.

## Boundaries need to be kept

If you want the deployment itself to close this window (a short rescan after `start()`) then that's fine
change `src/`, must go as separate feature. During an oracle edit, the checker confirmed the version
Correct implementation, fixing `src/` is the fastest way to get rejected again.