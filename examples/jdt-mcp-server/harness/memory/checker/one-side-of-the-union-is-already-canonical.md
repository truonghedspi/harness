# One side of a union is already canonical, so only half of the change is measurable

**Context.** `feat-prove-diagnostics-identity` (2026-08-26). Real error: `projectUris()` matches
`facade.projectFiles()` with `reader.list()` equals a `Set`, the two sides have two different spellings for
same file, so ONE physical file for TWO items. The symmetrical correction part reads very convincingly:

```ts
const uris = new Set(facade.projectFiles(workspaceId).map(canonicalFileUri));
for (const report of reader.list(workspaceId)) uris.add(canonicalFileUri(report.uri));
```

The comment block right above states: *both sides must pass through the CORRECT normal function — otherwise, ONE
physical file for TWO items*.

## What the mutant said was the opposite

I split the fix into two halves instead of just reverting the whole package:

| Mutants | Content | Results |
|---|---|---|
| m3 | revert both sides | identity condition RED |
| m3a | Remove `.map(canonicalFileUri)` from `projectFiles()` | identity condition RED |
| m3b | remove `canonicalFileUri(...)` from `reader.list()` | GREEN all over — oracle integration 3/3, oracle unit 19/19 |

Cause: The cache's `absorb()` called `canonicalFileUri` BEFORE saving, so `report.uri` is always in
canonical form and the second call never changes value. The second half of the edit is the redundancy
defense at the gate boundary, not a load-bearing mechanism. The caption claims to be half correct.

## How to check, apply to all corrections of the form "bring both sides to the same space"

All unions, merges, and comparisons are corrected by wrapping the normalization function `F` on multiple sides
One step before believing: **retrieve the value of each side and ask if `F` has been applied there.**
Whichever has passed through `F` on the write path, the call to `F` on the read path is idempotent, and no mutant
kill it. Same family as `mot-nguyen-tac-ap-hai-phan-ba.md`, just different direction: there are two support mechanisms for
each other, so single mutants survive; Here a mechanism was running earlier at another layer.

Operational consequence: **don't just revert the maker edit package.** Split it into the correct halves
it has, each half a mutant. Restore the whole package to a beautiful red color and hide the work only half of it
measure. The number to count is the number of clauses the edit touches, not the number of lines it changes.

Correct conclusion: mutant survival here is NOT a defect (the `DiagnosticsReader` port is
structure, a different cache implementation that has the right to return the raw URI), so it does not block approval. Something that has to be fixed
is a comment: downgrade from "both sides" to "defensive surplus, no cases measured" — or
Another case of cheap unit injection fake reader returns non-canonical URI. This is FOLLOW-UP, not REJECT.