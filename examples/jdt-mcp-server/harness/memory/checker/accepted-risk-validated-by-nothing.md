---
name: accepted-risk-validated-by-nothing
description: "Validated only against the current fixture tree" can mean validated by no condition at all.
metadata:
  type: lesson
  date: 2026-08-21
---

A human-approved design accepted a bounded risk worded as "`<modules>` tag detection is validated
only against the current fixture tree, not an independent Maven-model parser". That sentence reads
as narrow residual risk. A discriminator mutant showed the fixture tree validated the detection by
nothing: deleting the `<modules>` check outright and always taking the outermost ancestor `pom.xml`
kept all five conditions green, because no fixture ever nests a project pom under a NON-reactor
ancestor pom.

**Why:** mutants aimed at the falsifier's own cited defects all died, so the suite looked strong.
The surviving branch was one the falsifier never named and the fixture never built — a whole
predicate that is load-bearing in the code and inert in the oracle.

**How to apply:** when a doc or approval says a rule is "validated against the current fixtures",
delete the rule in a scratch copy and re-run. If the suite stays green, the fixture set validates
nothing, and the accepted risk is wider than its wording. Report it as a missing decision-table row
for the oracle layer (`FOLLOW-UP:`), not as a rejection, when the feature's own cited falsifiers
are genuinely killed — a human owns the risk call, but they should own it with the real number.
