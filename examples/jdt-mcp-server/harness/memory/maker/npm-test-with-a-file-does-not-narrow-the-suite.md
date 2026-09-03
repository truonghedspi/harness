# `npm test -- <file>` appends to the glob, does not collapse it

**When applicable:** every build on this repo, because `verification` of most features is possible
written as `npm test -- test/<region>/<name>.spec.ts`. Found in `feat-tool-references`.

## What really happened

The `test` script in `package.json` already contains three globs:

```
node --experimental-strip-types --test test/lsp/*.spec.ts test/workspace/*.spec.ts test/tools/*.spec.ts
```

`npm test -- X` **append** `X` to the end of that command line. As a result, all three globs still run, but the file remains
named run one more time. The command looks like "just runs my correct oracle" but in reality it is
"run all".

## Why does that corrupt judgment

This run runs in parallel with three other makers, each in the middle of writing a file in `test/tools/`. Times
running `npm test -- test/tools/references.spec.ts` first reported **9 failures / 100**, while oracle's
The main feature is completely green. If you read that total number as "my red proof", all red times
and the green times recorded in `evidence` both talk about other people's work.

The correct way to do it, in order:

1. Measure your performance with truly narrow commands:
   `node --experimental-strip-types --test test/tools/<name>.spec.ts`.
2. Only then run the full `npm test`, and if there are errors, **attribute file responsibility** before
   Conclusion, with a loop for each spec:
   `for f in test/tools/*.spec.ts; do node --experimental-strip-types --test "$f"; done`.
   The file-by-file pass/fail table turns "8 errors somewhere" into "8 errors in two unrelated files
   this turn range" — a verifiable assertion, not an excuse.
3. Write both numbers into `evidence`: the narrow command number is the evidence, the `npm test` number is the context.

## Consequences for checkers

The `verification` recorded in `feature_list.json` is still a broad command. The reviewer will run that command correctly
see errors in features running in parallel and may be mistakenly attributed to the feature in question. Should state
directly allocate errors by file in `checkerNotes` or `progress.md`.