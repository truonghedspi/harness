# Stdout invariance can only be measured in real processes

**When applicable:** Which feature possesses an invariant "nothing but X is written
stdout". Found in `feat-mcp-shim` (`INV-SHIM-1`), and all later tool layer features are located after right
that stdout.

## Problem

The way to write oracle reflexively is to inject a `Writable` collector into the `stdout` option and then assert
every line in it is parsable. This method measures the wrong object. `console.log`, `process.stdout.write`
and any library that calls those two functions writes to the process's `process.stdout`, not to the stream
injection. A forgotten debug line thus goes straight to the client's analyzer without Oracle seeing anything.

Measured, not inferred: mutant M1 inserts exactly one `console.log("shim linked: role=...")` into
`establish()`. Six shifts still in progress; just run the shim like a real child process and
Reading bytes on the stdout pipe actually shows red:
`INV-SHIM-1 violated: real stdout line 1 is not a valid MCP message: "shim linked: role=daemon"`.

## Correct way

Write a `.mjs` script to tmpdir at test run, `import` the module under test using the absolute path
For, `spawn` with `--experimental-strip-types` and `stdio: ["pipe","pipe","pipe"]`, then assert
on the byte string collected from `child.stdout`. The same script should receive an additional mode parameter to cover the entire branch
broken — here "auto-spawn failed": assert `stdout === ""` absolute, because a startup error is
when stdout is most likely to leak.

Keep the entire shift in progress: it confirms the exact things that define the process
don't give (number of redirected lines, order, internal state). The two levels complement each other, not replace each other
replace each other.

## Signs that enough has been done

A mutant that only inserts `console.log` must kill **exactly** cases at the process boundary and not kill any cases
other. If it kills the whole shift in the process, oracle is measuring in the wrong place; If it doesn't kill any cases, it hasn't
Which shift actually watches stdout.