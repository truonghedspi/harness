# Mutant survival that maker claims is "equivalent"

**When applicable:** Maker reports a SURVIVOR mutant but argues it is an equivalent mutant
(equivalent mutant), usually on defense code: backup timer, fallback branch, insurance layer.
Encountered in `feat-daemon-supervisor` turn 3 (2026-08-23), mutant "emptied force-close timer body".

## Why this is a real decision, not a trivial matter

Both shortcuts are wrong. If you force the maker to create a song to kill, then that song can only be a mock — yes
staging a state that correct code would never produce, i.e. mutant-led testing.
On the contrary, if you immediately believe the "equivalent" testimony, every surviving mutant will have a ready defense.

## Three checks before acceptance

1. **Rebuild the mutant.** It must survive as reported, on the current copy of the code.
2. **Read the synchronous window.** The equivalent argument almost always takes the form "state X is always empty when
   go there". Visual verification on code: list every statement between empty point X and use point X,
   and find an `await` in between. No await means no callbacks can interfere. In this case,
   The sequence is `destroy all` -> `connections.clear()` -> `server.close()` in exactly one go
   event loop, and `close()` closes the listening handle immediately so there are no more connection events.
3. **Own Probe, not maker's measurements.** Write stderr at entry point and in branch trunk
   I doubt I can come. In this case: 8/8 times entering with an empty set, the timer body does not run once.

If all three spells are enough, mutant equivalent is a valid conclusion, and the correct way to handle it is **downgrade note**:
The comment block must not declare that branch to be an invariant guarantee mechanism, but must clearly state that it is
unproven backup, with measurements. Keeping the code still makes sense if there is another degenerate mutant
(here DM10) that branch turns a hang into a budget red shift.

## Something easy to miss

A behaviorally harmless surviving mutant should still be measured, not speculated. Example of the same turn: quit
The `process.removeListener` of signals in `shutdown()` also survives. The real question is the listener
Does the signal keep the event loop alive — measure one line
(`node -e 'process.once("SIGTERM", () => {}); console.log("x")'` exits at 32 ms) definitive answer is
no, so it's harmless. Without measuring, this looks like a loophole worth blocking.