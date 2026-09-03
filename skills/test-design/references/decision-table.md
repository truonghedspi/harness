# Decision Tables

Use this reference for `technique: decision_table`. The goal is to test every meaningful column and prove that the table is complete and non-conflicting.

## Process

1. Extract conditions as rows, meaningful combinations as columns, and outcomes at column bottoms. A cell the specification cannot populate is a `spec_gaps` entry, not an assumption.
2. Use “—” (don’t care) only when the specification explicitly says a condition does not affect that column.
3. Validate the table before generating tests: every possible combination reaches at least one column, and no combination reaches columns with different outcomes. A precedence rule must be specified and tested for every overlap.
4. Implement one test case per column and name it after the column and outcome.

## Example

| Condition | C1 | C2 | C3 | C4 | C5 |
|---|---|---|---|---|---|
| Trading phase allows the order | Y | N | Y | Y | Y |
| Price is inside limits | Y | — | N | — | Y |
| Quantity is a lot-size multiple | Y | — | — | N | Y |
| Buying power is sufficient | Y | — | — | — | N |
| Outcome | accept | reject phase | reject price | reject lot | reject funds |

The specification must define precedence, such as phase > price > lot > buying power. If it does not, return `ESCALATE_SPEC`.

Fixtures violate exactly the intended column condition while all other conditions remain valid. Otherwise a result cannot be attributed to one rule.

## When to use MC/DC

If a decision-table condition is itself a boolean expression with three or more terms, add MC/DC for that expression. Each term needs a pair of tests differing only in that term and changing the outcome.
