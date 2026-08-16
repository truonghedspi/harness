# Question design

Use the smallest question that preserves the decision.

## Classification

| Kind | Evidence before asking | Useful answer contract |
|---|---|---|
| Human-owned fact | show why no authoritative machine source exists | concrete value + effective scope/date |
| Preference | show a runnable example or meaningful alternatives | selected option + exception |
| Risk appetite | show consequence, likelihood evidence and reversibility | accept/mitigate/avoid + owner |
| Authorization | show exact mutation, target and rollback | approve/deny + scope |
| Priority | show competing outcomes and capacity constraint | ordered set or explicit cutoff |

Reject questions that ask for implementation facts available in the repo, bundle independent
decisions into one answer, hide the cost of the recommended option, or invite an untyped “looks
good”.

## Dependency frontier

Two questions belong in one round only when neither answer can change the other question's options
or recommendation. When uncertain, ask the upstream decision first. Recompute after every round.

For a contested answer, reflect the conflict once: “You chose X; source Y currently requires Z.
Should X override Z, or is the scope different?” This verifies meaning without turning the
interview into persuasion.
