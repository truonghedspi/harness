# The red `feat-001` may be another maker's suite unit, not your feature

**When applicable:** multiple makers run in parallel on the same source tree, and `npm run test:integration`
Red flags in cases named `feat-001: the standard baseline gate ...`. Meet at turn
`feat-tool-diagnostics`, while the other three makers are building `hover`/`definition`/`references`.

## Phenomenon

First run: `# tests 320 / # fail 5`, five red lines all belong to `feat-001` —
`the standard baseline gate executes every required step`,
`a failed install/fixture/test step makes the standard baseline gate red`,
`the maintaining fixture step installs the pinned JDT LS archive`.
None of the lines state the filename of the feature being worked on. Run the same command again a few minutes later:
`# tests 181 / # failures 0`.

## Root cause

The `feat-001` calls the baseline port itself (`init.mjs`) in the child process, and that port runs
`npm test` on the ENTIRE suite unit. So they reflect the instantaneous state of every file
unedited, including files from other makers. During a parallel maker to
`src/tools/hover.ts` is red, all `feat-001` shifts are red.

The number of shifts also jumps (320 → 181) because the TAP output of child processes is included in the external run.
A large difference in `# tests` between two consecutive runs is a telltale sign.

## How to handle

1. Read the NAME of the red case before reading the number. If you don't mention the file name of your feature, don't edit anything.
2. Run the command again and compare `# tests`. The number of shifts between two runs means the source tree is being modified
   time, and the results of the previous run say nothing about my source code.
3. Specific evidence of a feature is always obtained from a narrow command
   (`node --experimental-strip-types --test test/tools/<my>.spec.ts`), not from the pooled suite.
4. Write directly in the evidence that the first merge is red for whatever reason. Ignore the silence for a moment and then point
   Copying the green line is destroying the very thing that evidence is used to prove.

Side note measures the same: `npm test -- test/tools/x.spec.ts` does NOT narrow the scope. Script
`test` already contains a list of globs, so the parameter is just appended — my file runs twice and no
red is duplicated, mixed with other people's red.