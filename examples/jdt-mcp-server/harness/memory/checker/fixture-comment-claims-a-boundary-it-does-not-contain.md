# The test case annotation asserts that the fixture contains a boundary case — recalculate the arithmetic

**When applicable:** a test case has an annotation that describes the boundary case it constructs ("an identifier
non-ASCII straddling a chunk boundary", "a record exactly equal to the buffer size", "a timestamp
right at the second boundary"). Meet in `feat-mcp-shim` turn 2 (2026-08-23).

## Trap

The framing of `mcp-shim` writes a 200 KB message consisting entirely of a two-byte `ü` character, cut into chunks
30,000 bytes, and the annotation clearly states the purpose: a chunk-by-chunk decoding will result in the character being cut in half
to replace character. Persuasive captions, big data, green shifts. But prefix
`{"jsonrpc":"2.0","id":1,"result":{"text":"` is exactly **42 bytes** — an even number — so all boundaries are multiples
The number 30,000 falls exactly in the **first byte** of a character. No characters are cut in half. Mutant instead
`StringDecoder` equals `chunk.toString("utf8")` live 11/11.

The reverse direction is even more closed: `Buffer.from(big.slice(offset, offset + size), "utf8")` cuts according to
The **string** index is then encoded, so each buffer is always fully UTF-8 by structure. That song is not included
now has the ability to differentiate, no matter how many times it is run.

The catch is cheaper than constructing a mutant: get the correct fixture expression, calculate the prefix length and jump
with `Buffer.byteLength`, then check for `(buf[boundary] & 0xc0) === 0x80` at each boundary. Three lines
Node is enough. The derivation rule: **each annotation stating "this fixture contains a boundary case X" is one
an assertion that needs to be measured, not a fact that needs to be read.** Large data sizes do not replace arithmetic.

How to claim determinism: choose the cutoff point and then **affirm the boundary condition as the main premise
it** (`assert.ok((buf[cut] & 0xc0) === 0x80)`), instead of hoping for a regular boundary to hit.

## Mutant survival ≠ mutant equivalent: measured up to the previous branch

In the same turn, the mutant adds `console.log` to `socket.on("error")` on 11/11, and the mutant **deletes**
listener also lives on 11/11. These two results can only be read after a third measurement: stem replacement
handler with an `appendFileSync` command to `/tmp` and then run the whole suite again. No files created —
The branch did not run at all. Thanks to that "mutant survives" changes from "possibly equivalent" to "branch
"This has never been touched by any case", which is a specific request, not a doubt.

And before asking for a new shift, measure how to build it. Here `socket.resetAndDestroy()` — the obvious way to
force ECONNRESET — **throws** `ERR_INVALID_HANDLE_TYPE` on Unix domain socket, only available for TCP.
The way to do it is to destroy the socket on the daemon side and immediately write a large message from the client side before proceeding
The `close` event arrives: probe correctly outputs an `error` event with code `EPIPE`. Please include measurements
maker does not take a turn to detect a dead end.