# The return value of no case is called a no-op mutant waiting to survive

**When applicable:** an API that returns a closure to undo — the unsubscribe function of `onNotification()`,
`stop()` of watcher, `release()` of pool. Encountered in `feat-lsp-notifications`, turn 1 REJECT.

## Symptoms

Nine test cases covered both directions of notification transmission, three mutants created by the maker were all killed,
`tsc` validates the return type matches the consuming port. Yet mutant `return () => {};` — replaces the entire body
deregister function with no-op — still 9/9 green. The reason is simple: no case ever **calls** value
`onNotification()` returns. The only evidence for that mechanism is that `tsc` speaks in compatible fashion, i.e
No acts have been proven yet.

Rule to draw, check visually before handing it to the checker: list all values that the API publishes
declare the return, and for each value ask "which case calls it?". If the answer is none, mutant no-op
live for sure.

## The accompanying trap: green negative case for the wrong reason

The natural case for the deregister function is "call the deregister function, fire the frame, ask the handler not to run". That song is all green
when dispatch is completely broken, when the method name is misspelled, when the handler has never been hooked up — every
The assertion `=== 0` is empty.

Must have a positive anchor **before** the negative: shoot a frame while the registration is valid, positive
`calls === 1`, then remove and fire a second frame to confirm that `calls` is still equal to 1. Then the last 1
The end can only come from a truly effective unsubscribe.

## The second mechanism with them: edit the list while browsing

The comment "capture the list because the handler may unsubscribe during dispatch" describes one scenario
no one can touch it. To build it, you only need a handler to call its own remover function in the body
callback: `splice` on original array as index shifted one step, iterator of `for...of` jumps over elements
next, and the handler sibling is ignored **in silence**. This isn't an internal detail — it's vi
directly violates the declared behavior ("all frames without an id reach the handlers", plural).

Strong enough pinning method: three handlers with the same method, the first handler automatically removes, the first frame requires all three to run, frame
The second requires exactly two remaining handlers. The second step to prevent patching cheats is to completely remove `splice`.