# This machine has no `timeout`, and a mutant turn without it is completely silent

**When to apply:** All mutant build scripts run on the current development machine (macOS, do not install
GNU coreutils). Found in `feat-tool-references`.

Memory entry `a-leaked-handle-turns-a-red-mutant-into-a-hang.md` advises that each mutant run must have
private `timeout` + `killSignal`. Good advice, but the reflexive approach breaks down here:

```
command -v timeout gtimeout # → nothing, exit 1
```

Neither `timeout` nor `gtimeout` exists. If the script writes
`timeout -s KILL 120 node --test ... 2>&1 | grep -E "^(not ok|# tests)"`, line
`command not found` goes into stderr, gets piped by `2>&1`, and then gets filtered out by `grep` itself. Output is:

```
=== M1 completely eliminates cutting ===
=== M2 total reported in numbers after cutting ===
```

Four mutant headers, not a single result line. This state is **indistinguishable** from "every
mutants all survive" at a glance, and a maker in a hurry will read it favorably
for yourself.

## Correct way

Get the deadline from `node --test` itself, which is always present:

```
node --experimental-strip-types --test --test-timeout=30000 test/<region>/<name>.spec.ts
```

plus `{ timeout: N }` declared in each shift. A suspended mutant still ends up with a line
`not ok` has a song name, not with silence.

## Two cheap safety nets for mutant scripts

- Always put `# tests` / `# pass` / `# fail` in the `grep` pattern. Absence of those three lines means the command is absent
  run, not mutants survive.
- Assert that the string to be replaced appears **exactly once** before being replaced (a three-line `python3` is
  enough). A mutant that cannot build but still runs the test will give a meaningless green turn.