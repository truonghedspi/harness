# Pin "peer dies in the middle of a message" with a single socket write

**When to apply:** The test case must create a scenario where the peer is killed when a message is halfway through
approximately — not enough of a line ending in newline. Found in `feat-mcp-shim` turn 2 (`INV-SHIM-3`).

## Problem

Killing the peer *between two complete messages* is an easy case and doesn't prove what the comment states
next statement ("a reboot may lose calls in flight but never damage frames").
The difficult case requires a timing condition: the truncated fragment must **already** be in the component's frame buffer
testing, **before** peer died. The reflective way is to write the truncated fragment and then `setTimeout` an interval
It's short and then SIGKILL. That waiting period is not proof: if it's shorter than it actually is, it's green for a reason
Others and mutants survived without anyone knowing.

## Correct way

Have the peer write the truncated fragment in **the same `socket.write()`** as the previous message's response
there:

```
payload = JSON.stringify(response) + "\n" + trailingFragment
socket.write(payload)
```

Ca wait for that answer to appear on stdout. Since the two parts go together in one recording, the answer is present
on stdout is mechanical proof that the truncated piece is in the framer. There's no more waiting
guess. (There is still a short pause afterward, in case the kernel splits the write into two reads
— but that's the seat belt, not the main mechanism.)

## Why is it worth it?

Two redundant mechanisms in `mcp-shim.ts` execute the same statement: `LineFramer` is newly created at
each `attach()`, and `framer.flush()` runs on the `close` handler. Break each one and the remaining one will be fine.
Only with the above well-timed pinning operation did the double mutant reveal his true form: the answer to the call
after reboot **disappeared completely**, stdout is empty, client hangs forever. The old ca killed the peer between the two
The complete message is still there under that mutant.

You should also insist that the truncated line be **recorded exactly once** (`divertedLines === 1`) and appear on
stderr, not just "don't leak stdout". If missing, an implementation silently swallows the missing piece as well
blue, but keeping silent is the most difficult mistake to trace later.