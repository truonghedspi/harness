# The cleanup function returns as a second API surface, normally untouched by any shift

**When applicable:** a method returns a function to unsubscribe/stop/cancel — `onNotification()` returns the unsubscribe function,
`attach()` returns the detach function, `createWatcher()` returns the close function. Seen in `feat-lsp-notifications` (2026-08-23);
This codebase has at least three places of the same shape.

## Why did it leak?

Test cases are naturally written in the *flow direction*: register handler, fire event, confirm handler runs. Value
return is omitted in all cases, because it is not necessary to construct the scenario. Result: replace the entire return function body
returning with `return () => {};` but 9/9 cases are still green. The only remaining evidence is that "tsc says the return type is equivalent
like" — that's a signature, not a behavior.

One additional catch: the unwind function and dispatch loop are **a coupling mechanism**. Here `onNotification` is removed
with `splice`, while dispatch iterates over `[...handlers]`. Abandoned snapshots also survived, because of the unique situation
distinguish it — the handler removes itself *during* dispatch — it can only be built if the test case is called
function returns. An untouchable axis kills two mutants at the same time.

## Two mutants need to be built, every time they see this form

1. **`return () => {};`** — function body cleaned up to empty. If the suite is still green, the entire path has not been removed
   prove.
2. **Remove immediately during dispatch** — remove the list snapshot (`[...handlers]` → `handlers`), then edit the case with
   The handler calls its own remover function mid-loop. `splice` translates the array and the next sibling is ignored im
   quiet. This is a real error, not a mutant equivalent — always run the probe on the pristine version first
   demonstrate real behavioral differences.

## How to read quickly

Read the return type of every public method in diff. For each method that returns `() => void`, find
in the spec the string calls that return value. Not found once ⇒ was there a mutant survivor, no
Even if you need to run, you know. This is the fourth axis, in addition to the three axes above
`maker-authored-mutants-cover-only-branches-he-wrote.md`.