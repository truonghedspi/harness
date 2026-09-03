# A `CODE-IDENTICAL` claim proven by filtering `//` lines has a hole

**When applicable:** every time the planner grants *limited edit permission* to a `prove` feature —
"after green change, rewrite ONLY the comment block on line N". Found in `feat-prove-evict-succession`
(2026-08-25), comment block in `#evict` of `src/workspace/workspace-pool.ts`.

## The evidence Maker offers, and why it's not enough

Maker confirms CODE-IDENTICAL by filtering out all lines starting with `//` from the two copies and then diffing,
get empty result. That filter misses three classes of change:

1. Block comment `/** ... */` — no line begins with `//`, so a sentence is corrupted in the Javadoc
   still gets through *and* a line of code that's been edited right next to it also gets through if it's in the wrong filtered area.
2. Line comment (`await x(); //comment`) — the line doesn't start with `//`, so it stays in both
   side; Conversely, if maker filters by `contains("//")`, the entire statement disappears from the comparison.
3. Command order when a block is *moved*: filter then diff still catches, but only if diff holds
   order — if someone `sort` before diff then mutant N1 (reversing the two statements) becomes invisible.

This time the filter accidentally gave the correct result. That's luck, not proof.

## How to measure correctly, and where to find a comparison copy

Don't filter anything — run the full `diff -u` with the **pristine copy of the previous approval**, then read each
hunk. The pristine version usually remains on disk: agents in the same session share the same scratchpad directory
`/private/tmp/claude-501/<slug>/<session-id>/scratchpad/`, and every maker leaves a
`*.pristine.ts` or a directory `pristine/`. Compare the sha256 with the maker number listed in `evidence`
to make sure it's correct.

This turn it turns a believable assertion into a readable assertion: diff gives EXACTLY ONE hunk
at line 325, replace the old comment block with the new block, no statements are changed — and prove it
always ask for the second request of the prompt ("`diagnosticsAttachment` comments lines 101-110 are untouched")
without the need for a separate measurement.

`git diff` does NOT change this when the previous feature has not been committed: `HEAD` here is even before
`feat-tool-layer-core`, so `git diff` returns all the work of the two features combined and hunk needed
immersed in it.

## Rule of thumb

Every time you see the word CODE-IDENTICAL, ask "compared to which version, with which command" before asking anything
other. An assertion that *nothing has changed* can only be verified with a comparison; if not found
In that version, please state directly in `checkerNotes` that the conclusion is only at the structural level, not the text
CODE-IDENTICAL continues as if it had been measured.