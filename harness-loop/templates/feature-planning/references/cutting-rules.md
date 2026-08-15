# Cutting rules

## Two axes

- Named component or responsibility → `kind: build`.
- Acceptance scenario or boundary-crossing claim → `kind: prove`.
- Cross-cutting policy → `docs/constraints.md`, not a one-off feature.

When scenarios are absent, ask what smallest observable behavior would be false without the
capability. If that cannot be stated in one sentence, return to design rather than manufacturing a
feature.

## Size

A feature is one sitting and one verifiable claim:

| Check | Pass condition | Failure response |
|---|---|---|
| Behavior | one subject and one claim | split unrelated clauses |
| Verification | one runnable command | create a separate proof claim |
| Touched files | 1–3 nameable paths | resolve the requirement first |
| Existing context | at most 3–5 deep dependencies | document architecture or split discovery |
| Direct dependencies | at most three normally | find the hidden intermediate feature |

The lower bound matters too. Merge siblings when neither is independently demonstrable, when they
share the same proof, or when one is merely an edit step the other agent already holds in context.
The build/prove pair is the deliberate exception: keep evaluator independence, and let one prove
feature cover several related builds when one acceptance scenario genuinely judges them together.

## DAG

1. Foundation features have no dependencies.
2. Build features depend on foundations or earlier builds.
3. Prove features depend on the build features whose claims they judge.
4. Every dependency names an earlier feature in the emitted array.
5. Refuse cycles; ordering is executable control state, not documentation.

## Definition of ready

Every non-baseline feature has:

- stable `id`, `name`, and one-sentence `behavior`;
- `kind: build|prove`;
- one real `verification` command;
- a falsifier naming the wrong implementation caught, with invariant citation where available;
- `context.touches` (1–3 paths) and `context.note`;
- complete dependencies and state fields;
- `attempts: 0` and a deliberate positive `maxAttempts` for new work.

During a re-plan, preserve completed work, evidence, attempts, and checker history unless a recorded
decision explicitly supersedes them. Reordering is not permission to reset state.
