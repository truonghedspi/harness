# checkerNotes on a feature can carry a literal implementation-code fragment

Seen designing TCON-ROUTE-0007 for `feat-prove-routing`. `feature_list.json` is an allowed read,
but this feature's `checkerNotes` field (written by the checker/feature-planner across three
widenings) quotes an actual line of implementation syntax verbatim: mutant M3 is described as
"replacing `mavenRoots.findLast(({ isReactor }) => isReactor)` with `mavenRoots.find(...)`".
That is a source-code fragment (variable/function names), not spec prose, and it reached my
context through a file the boundary table says I may read.

Handling: don't silently use the code fragment even when it happens to make the design task
easier (here, it would have "confirmed" an array-ordering assumption). Re-derive the condition
from the invariant's own prose instead — INV-ROUTE-1 already says "outermost enclosing ancestor
pom.xml that declares `<modules>`" and the feature's own `falsifier` field already restates the
wrong-vs-right outcome in plain language ("resolves to the inner nested reactor instead of the
outermost enclosing reactor"). Both are sufficient to write behavior/rationale with zero
reference to code shape. Check the authored condition afterward for leaked identifiers before
treating it as clean, and say explicitly (to whoever reads the report) that the fragment was
seen and not relied on — the instruction is to flag it, not to pretend it wasn't there.

General lesson: a `checkerNotes` string is checker-authored and the checker is allowed to read
implementation, so expect these strings to sometimes contain code fragments the checker used as
evidence. Read the invariant/assumption doc and the feature's `behavior`/`falsifier` fields as
the actual source of truth for condition content; treat any verbatim code syntax in `checkerNotes`
as contamination to notice and route around, not as a shortcut.
