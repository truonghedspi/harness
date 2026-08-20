---
name: spike-can-overturn-a-locked-choice
description: a spike that falsifies a premise behind an option the human already picked is new evidence, not a reason to soften the finding to match their prior choice — declare it and ask again
metadata:
  type: lesson
  date: 2026-08-20
---

Observed in the `memory/shared/` tier design session. The human answered Phase 0's elicitation and
picked a curator model ("mechanical script, like `verify-harness --promote`") before Phase 4 ran.
Applying `kac-before-spiking`, the Key Assumptions Check on that already-chosen option surfaced an
unstated premise — that string-normalization matching could detect "the same fact, worded
differently" — and a two-minute spike against the actual matcher already in the codebase
(`memory-consolidate.mjs`'s `normalize()`) falsified it: 0 of 3 realistic paraphrase pairs matched.

The pull at that moment was to keep the design moving inside the human's already-stated choice —
find some way to make the mechanical-curator premise survive, since re-opening a decision the human
just made costs their attention twice. Presenting the falsification plainly instead, as a fresh
`needs-human` fork with both branches sketched, is what the prompt's rule ("a concern changes only
on new evidence... never because they are the one deciding") actually requires — and the human's
second answer changed the design's shape (agent-judged matching instead of pure string matching),
which a softened or buried finding would have prevented.

**Why:** a human's earlier answer in the same session is not evidence that a later-discovered premise
of that answer holds. Treating "they already decided" as a reason to stop checking is the same
failure the Locking section already guards against for `status: approved` — just one phase earlier.

**How to apply:** when a Phase 4 technique (KAC, premortem, devil's advocacy) produces a real finding
against an option already picked earlier in the same session, present it with the same rigor as if
no choice had been made yet — declare it, sketch both branches, and let the human re-decide with the
new evidence in hand, rather than narrowing the finding to fit around their prior answer.
