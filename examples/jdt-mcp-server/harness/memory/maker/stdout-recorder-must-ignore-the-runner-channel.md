# Recorder on `process.stdout.write` also captures the reporting channel of `node --test`

**When to apply:** the in-process case needs to confirm "nothing is leaking out the process's real stdout",
by temporarily overriding `process.stdout.write`. Meet at `feat-mcp-shim` turn 2 (`INV-SHIM-1`), and will encounter
again in all the features located behind that stdout.

## Problem

Entry `stdout-invariant-needs-the-real-process.md` correctly states that injected `Writable` is not seen
`console.log`, and a cheap solution is to override `process.stdout.write` right in the ca body. The pitfall lies in
next step: `node --test` runs **each spec file in a child process** and reports the results
parent process via **the same `process.stdout`**, serialized using the V8 serializer
(`NODE_TEST_CONTEXT=child-v8`). The naive recorder thus records the `test:start` / `test:pass` frame
of the runner itself, and red shift with a bunch of binary bytes that have nothing to do with the source code under test.

This is false red, not legitimate red: it appears even on the correct implementation.

## Correct way

Measure first, don't speculate. A small probe file gives definitive results:

| Recorded source | Chunk type to `write()` |
|---|---|
| `console.log("...")` | `string` |
| `process.stdout.write("…")` from source code | `string` |
| runner's reporting channel | `Buffer` (preface `0xFF 0x0F`) |

Recorder only accumulates chunks of type `string`. Include two things that make the rule self-protective:

1. **Premise assertion**: `process.env.NODE_TEST_CONTEXT === "child-v8"`. If a future runner
   written report, the assumption "Buffer is the runner's" collapses; This assertion makes big red shift instead
   quietly green forever.
2. **Positive anchor**: immediately after overwriting, broadcast a `console.log` landmark and ask the recorder to catch it,
   then delete the cache. Without this anchor, `recorded() === ""` is empty if the recorder dies.

## Signs that enough has been done

Mutant just **adds** a `console.log` (leaving `stderr.write` intact) which must kill the correct shift through that branch.
Here are three positions on the reconnect/stop path for three separate mutants: the link-closed line and the reconnect branch
failure kills both recorder shifts, the stop-shutdown branch fails only kills shifts passing through `stop()`. If
If any mutant is alive, I haven't touched that branch yet — it's not like the recorder is broken.