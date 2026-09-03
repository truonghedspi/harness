# Generates a real `error` event on the socket, and why deleting the listener **doesn't** kill the process

**When to apply:** requires a case that hits the `socket.on("error", …)` branch with a real error, not a mock.
Encountered in `feat-mcp-shim`, mutant `CE1`/`CE1del` survives two turns.

## The order of operations determines whether to `EPIPE` or not

Measure with probe 5 times for each combination, on Unix socket:

| Script | Results |
|---|---|
| Destroy the socket on the daemon side, then **in the same synchronization block** write a 1 MB call from the client side | 5/5 has `error: write EPIPE` |
| Break first, immediately record a 64 byte call | 5/5 has `EPIPE` |
| Write first (64 bytes) then destroy | 0/5 — no events |
| Record first (4 MB) then destroy | 5/5 has `EPIPE` |

Mechanism: error only occurs when there is a write command **in progress** when the peer disappears. Remember the big hold for the command
unfinished recording through many event loops; After the peer disappeared, I immediately encountered a broken pipe. How safe
The best way is to combine both: break first, score big later.

`resetAndDestroy()` fails: it **throws** `ERR_INVALID_HANDLE_TYPE` on Unix sockets.

This window is real in operation — an MCP client does not wait for the shim to recognize that the daemon is dead before calling
continued — so the song is not a staged situation.

## Removing the `error` listener completely does not kill the process

The comment in `src` says "a socket with no `error` listener throws", and that's the general rule of thumb
Node. But on the `delegated` line, `daemon-supervisor.probeDaemon` leaves one
`socket.once("error", …)` **settled** on the connection given to the shim. That listener is still there
attached throughout the socket lifecycle, swallowing the first `error` event and then `returning` silently because `settled === true`.

Implications for oracle writers: **don't expect the `CE1del` mutant to crash the process**. Ca must have
an active positive anchor — waits for `stderr` to match `/daemon link error: \S/` — to detect
listener disappears; If we only confirm that "the process is alive", then the mutant is alive.

Consequence for design: a missing listener probe is a silent error swallower. Recorded to `checkerNotes`
Let the checker/planner decide, do not edit during the maker turn.

## Signs that you've done enough

Ca must kill **both** variants: add `console.log` to handler (kill at recorder
`process.stdout`) and delete the handler completely (dead at anchor `stderr`). Only one of the two has not yet closed its branches.