# An incorrectly counted fixture has teeth only when the offset exceeds token width

## Observe

`feat-prove-navigation-tools` needs to prove hover/definition/references column count using UTF-16 code
unit. unit. Fixture constructs an astral line containing `𝄞𝒜` — two surrogate pairs before the symbol `counter` — with a latch
block confidently:

```
assert.equal(astralPrefix.length - [...astralPrefix].length, 2,
  "the beginning of the astral line must contain exactly two surrogate pairs so that the codepoint counting error goes outside the token");
```

All ten conditions are green. Mutant "understand column as codepoint index" is still **ALIVE**.

## Root cause

Counting by codepoint pushes the asked position to the right exactly equal to **the number of surrogate pairs preceding it**, here
is 2. The `counter` token is 7 characters long. The offset call 2 thus falls from `c` to `u` — still IN the token.
JDT LS decodes the correct symbol, returns the correct range of the entire token, and all assertions are still correct. Blocking pin
declares a boundary that fixture does not contain: it measures whether there are two pairs of surrogates, but not
What really matters is whether the deviation is out of the token or not.

The BMP line is coincidentally correct: its byte↔code unit offset is 13, greater than 7, so the mutant "counts with
byte" died immediately. That coincidence obscured the defect of the astral flow during the first measurement.

## Rules for next time

A "hard counting" fixture can only differentiate between true/false if **the deviation caused by incorrect counting is large
than the width of the token in question**. Measure that quantity directly in the stop, do not measure the substitution quantity:

```
assert.ok(astralPrefix.length - [...astralPrefix].length > SYMBOL.length, ...);
assert.ok(Buffer.byteLength(bmpPrefix, "utf8") - bmpPrefix.length > SYMBOL.length, ...);
```

The same error pattern applies to all location oracles: ask for a location then assert the range returned, with one
subject has the ability to "attract" the position to the nearest token. Deviations in tokens are invisible deviations. Fix it right
Measure **all** mutants on the new fixture, because the old number refers to a different fixture.

Early recognition sign: which block is stated by the number of characters (`exactly two surrogate pairs`) instead
because by relation to the quantity it must win (`> SYMBOL.length`) are all suspicious.