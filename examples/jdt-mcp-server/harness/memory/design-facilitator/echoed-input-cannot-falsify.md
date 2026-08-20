---
name: echoed-input-cannot-falsify
description: A result field that echoes the caller's own input back is a falsifier that cannot fail — the coordinate converter's likeliest bug is self-inverse, so the round trip cancels it exactly
metadata:
  type: lesson
  date: 2026-08-20
---

`feat-prove-navigation-tools` asked whether `java_hover`'s result carries a position at all. JDT LS's
hover never sets one (`HoverHandler.java:50-52` — `new Hover(); setContents(...); return`), and raw
LSP marks `Hover.range` optional, so the tool table had named no position and `INV-TOOL-1`'s *"every
position in every tool result"* was **vacuously true for hover**: no position, nothing to falsify.

The obvious cheap fix — echo the requested `line`/`column` back into the result — is worthless, and
the reason generalizes. This project's position conversion is 1-based line/col (X-007) ↔ 0-based
UTF-16 code units. Its most likely bug is counting **codepoints where UTF-16 code units are meant**,
which is *self-inverse*: `toLsp` under-counts past a surrogate pair and `fromLsp` over-counts by the
same amount, so `fromLsp(toLsp(p)) == p` holds **exactly**. The echoed field then equals the caller's
input by construction, the non-ASCII/astral-plane fixture passes green, and the tool is meanwhile
hovering the token next door. The test would be testing itself.

**The general shape:** a reported quantity can only falsify a transform if it is compared against an
expectation derived *independently* of that transform. Echoing an input compares the transform's
output to its own inverse — always consistent, regardless of correctness. Reporting the **resolved
token's range** breaks the symmetry, because a mis-converted position lands on a *different token*,
and the fixture's intended token has known byte offsets that the wrong token's do not match.

**How to apply:** when a tool in this project gains a position field, ask which of two things it is —
a restatement of what the caller already said, or something the daemon *discovered*. Only the second
can fail a test. The same question applies to any echo-shaped field (`path`, `newName`, requested
`kinds`): they document the call, they do not verify it, and an invariant must not lean on them.

**Also worth carrying:** spike A ran hover successfully in an earlier session but printed only
`hover.result.contents`, discarding the rest of the object — so `evidence.md` could not answer a
question the spike had physically had the answer to in memory. Spikes here should dump the whole
response object, not the field the current question happens to be about; re-running needs a JDT LS
install this environment does not have, and upstream source had to stand in.
