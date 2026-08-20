# Cucumber profile for business journeys

Use Cucumber for a small set of journeys that product, operations, compliance or QA must review.
Keep protocol and deployment details behind a business driver; step definitions should say
`placeOrder`, `awaitTrade`, and `position`, never `kubectl`, SQL, Aeron recording ID or Kafka offset.

One scenario expresses one business rule. Prefer concrete examples and invariant assertions over a
long UI script. Tag consequence and lifecycle, for example `@critical @continuous-trading
@requires-matching`. Run IDs must flow into accounts, correlation IDs and consumer groups through
the driver, not appear as literals in feature files.

Good:

```gherkin
Scenario: A resting sell is partially filled by an incoming buy
  Given SELLER has a sell order for 100 contracts at 1250
  When BUYER places a buy order for 40 contracts at 1250
  Then exactly one trade for 40 contracts at 1250 is published
  And the resting sell has 60 contracts remaining
```

Keep combinatorial price-time cases and matching-engine properties in unit/property tests. Cucumber
is executable business specification, not the whole coverage pyramid.
