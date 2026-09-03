# A leaked handle turns the red mutant into a hang, and deletes the red line

**When to apply:** maker turn builds mutant for a *cleanup* invariant — "detach must run at
evict", "watcher must be closed", "socket must be destroyed". Found in `feat-tool-layer-core`, mutant `M6`.

## The truth is easy to misunderstand

Mutant removing the cleanup path **also** removes the thing that keeps the test process from exiting. The test case remains
red in the right place — its assertion did fail — but `node --test` never prints TAP, because of a
handle `fs.watch` (`persistent: true`) keeps the event loop alive. The expression is the mutant build run
overdue and get `SIGKILL`, there is no `not ok`, and we cannot distinguish between "toothless case" and
"I have teeth but I can't speak yet."

Same mechanism as these two items already in memory (`bounding-a-hang-at-the-test-layer-is-not-enough`,
`inner-layer-shows-up-at-the-injectable-seam`), but in reverse: here is what needs budgeting
not a promise but **ownership of the handle**, and the sole owner in the code again
is the line that the mutant just deleted.

## Correct way

The case must have a cleanup path **independent of the path being tested**. Not only
`t.after(() => pool.close())` — `close()` is the evict path, which is what the mutant breaks. Yes
Keep references to all resources that the attachment creates and close them directly in cleanup:

```ts
t.after(async () => {
  await pool.close();                                   // real sugar
  for (const entry of starting) await entry.watcher.close(); // safety net, doesn't go through evict
});
```

After adding, `M6` changes from `KILLED after timeout (SIGKILL)` to 2 named red shifts in 4 seconds.

## Two consequences follow

1. **Register cleanup as soon as the resource is created, do not put `close()` in the middle of the case.** Initial version of
   I call `pool.close()` in the middle of the shift; a red assertion before that line ignores it completely, so mutant
   `M4` (nothing to do with cleanup) also hangs the spec file.
2. **Give each mutant run a `timeout` + `killSignal` in the mutant build script itself.** If
   no, one hanging mutant consumes the whole turn's budget and no mutant after it can run —
   It took me 600 seconds before I knew what happened.