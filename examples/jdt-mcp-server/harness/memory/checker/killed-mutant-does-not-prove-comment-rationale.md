# A killed mutant proves a useful branch, not the rationale written in its comment

**When applicable:** a defense branch comes with a comment stating the consequences of its absence ("missing listener
then the socket will throw and kill the process", "without this latch the queue will be infinite"). You build mutants
delete branch, mutant dies, you approve. Meet in `feat-mcp-shim` turn 3 (2026-08-23).

## Trap

`mcp-shim.ts` has `socket.on("error", ...)` with the comment "A socket with no `error` listener throws".
Mutant completely deleted the listener, causing case 12 to die as expected. Natural conclusion: correct annotation, branch
Proven, done.

But case 12 died because **timed out waiting for stderr stream**, not because the process crashed. These two reasons give
same red color. Measuring again with a separate probe showed a completely different mechanism: `probeDaemon` in
`daemon-supervisor.ts` wraps `connect()` into a promise with `socket.once("error", reject)` and **does not remove
listener after the promise settled via `connect`**. Socket assigned to shim so come here
`listenerCount("error") === 1`. That extra listener exits right at `if (settled) return`, so it swallows it
Silences the first error event and prevents Node from throwing. Without the shim listener, the error **disappears
no trace**, but does not kill the process.

The branch still took the real force, the mutant still died — but for a different reason than what was written.

## How to catch

When mutant deletes a dead defense branch, read the shift's **error message**, not just the color. If annotated
claiming "without it, the process dies" but the shift is red because the timer has expired waiting for a log line, those two things are not the case
right one. About three probe lines are enough to resolve:

```js
console.log(conn.listenerCount("error"));      // 1 = someone else is there to help
conn.emit("error", Object.assign(new Error("x"), { code: "EPIPE" }));
```

## Rule of thumb

Every helper wraps `connect()`/`listen()` into a promise with `once("connect", resolve)` + `once("error",
reject)` leaves **one** extra listener settled on the object it returns, because only the listener matches
The event has already occurred and is removed by `once`. That extra listener turns "immediate collapse" into "silent swallowing" for real
event. In this repo that pattern appears twice: `probeDaemon` and `connectOnce`. When browsing any
Which feature returns a connected socket, count listeners before trusting Node's default semantics.

And in terms of judgment: incorrectly stating the reason while the correct behavior is **not** a reason to block approval —
which is `FOLLOW-UP:` send planner. What needs to be blocked is bad behavior, not bad prose.