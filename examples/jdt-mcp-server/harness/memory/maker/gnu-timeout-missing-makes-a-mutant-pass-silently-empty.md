# `timeout` is not available on macOS: mutant builds are silent and appear to have run

**When to apply:** all mutant build scripts run on this machine (darwin). Found in `feat-tool-definition`,
turn 1.

## Symptoms

The script to build five mutants prints the correct five headers `===== M1 ... =====`, then the line
`OK: source reverted`. Not a single `not ok` line, nor a single `# fail` line. Skim read
is exactly the same as "all mutants survive" — the most costly and wrong conclusion that can be drawn at this step.

## Root cause

The runtime looks like `timeout 120 node --test ... | grep -E "^not ok|^# (tests|pass|fail)"`. macOS
There is no GNU coreutils `timeout`. Shell returns `command not found` to stderr, `node` never
run, `grep` receives empty input and exits silently. Because each run is in a subshell and script
don't enable `set -e` for that branch, a non-zero exit code stops nothing.

What makes this trap hard to see: a previous memory entry (`a-leaked-handle-turns-a-red-mutant-into-a-hang.md`)
It is recommended to attach a separate `timeout` + `killSignal` to each mutant run. That advice is true in content —
mutant deletes the cleanup path and crashes the test process — but the tool it names does not exist here.

## Correct way

Use runner's own budget instead of external command: `node --test --test-timeout=30000 <spec>`. It
present with Node, cutting each shift but not the whole process, and the cut shift still prints a line `not ok`
name. When process-level truncation is required, check `command -v gtimeout || command -v timeout`
before and stop the script if there is none.

Includes a cheap safety net: each mutant run must generate **a stream of `# tests N`**. If not
If that line is present, the run never happens, and the script has to say something instead of letting the reader infer it
"mutant survives" from a blank space.