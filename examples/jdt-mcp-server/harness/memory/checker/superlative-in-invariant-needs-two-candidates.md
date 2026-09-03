---
name: superlative-in-invariant-needs-two-candidates
description: A superlative in an invariant (outermost/nearest/first/last) is unverified unless a fixture offers two candidates on that axis.
metadata:
  type: lessons
  date: 2026-08-21
---

`INV-ROUTE-1` contains two select words: `outermost enclosing ancestor pom.xml that declares <modules>` and
`nearest ancestor pom.xml`. The six-condition oracle kills all mutants that falsifier names, but mutants
change `mavenRoots.findLast(...)` to `mavenRoots.find(...)` — select innermost reactor instead of outer
same — still green 6/6. Root cause: no fixture has a reactor nested in the reactor, so the shaft
`outermost` has only one candidate.

**Why it's hard to see:** This is the second time in a row that the same routing function has slipped through the net in the same way.
The previous time was a fallback (`nearest`) clause with no second candidate; TCON-ROUTE-0006 correctly closes the clause
then stop. A new condition only closes the axis it was ordered on, not the remaining axes
of the same invariant sentence.

**How to apply:** when invariant contains a superlative or selective word (`outermost`, `nearest`, `first`,
`last`, `longest prefix`, `highest priority`), separates sentences into each selection axis. For each axis, ask the tree
fixture has at least two valid candidates. If there is only one, the word is proven by nothing
both — reverse the selection in the scratch copy and run again to confirm. Report in the form `FOLLOW-UP:` attached
The correct decision table row is missing, when the falsifiers that the feature mentioned have all been killed.

## Round three update (2026-08-21) — qualitative clause is also a separate axis

TCON-ROUTE-0007 correctly closes the `outermost` axis and kills M3 cleanly. But the mutant scanning ring was soon revealed
mutant M12 still survives all 7/7: *if the ancestral chain has any reactors, take the outermost pom.xml, even though
The pom itself does not declare `<modules>`*. Root cause: invariant sentences have three axes, not two —
selection order (`outermost`), fallback branch (`nearest`), and **qualifying clause** (`that declares
<modules>`) filters the candidate set before the selection order is applied.

**Better lesson:** a relative clause that modifies a candidate (`that declares X`, `with status Y`) is
an axis independent of the superlative that precedes it. It needs fixture to place a candidate that does NOT satisfy the at clause
right where the select takes precedence — here is a non-reactor pom.xml located ABOVE the reactor root.

**How ​​to do it differently next time:** Don't order each row of decision tables for each mutant you just captured; three
In consecutive rounds, each round only closes one axis and then exposes the next axis. Instead, build a single row of mixed cover
total selection: five-layer ancestral chain including top non-reactor, reactor A, middle layer non-reactor,
reactor B, leaf module — the correct result is A. This row kills all three axes at once. At the same time, run a mutant scan
batch on every function decision (id, error message, loop stop condition, fallback branch) now
in the first verdict, have every surviving mutant revealed at once instead of trickling through each round.

**Navigation constraints:** when gap detected on last attempt (attempts = maxAttempts), `FOLLOW-UP:` must
clearly state that the feature cannot be expanded in place anymore — the maker ends its turn, expanding in place creates a feature
permanent ability that cannot be reevaluated. Route to a new oracle feature or a risky queue
acceptable.