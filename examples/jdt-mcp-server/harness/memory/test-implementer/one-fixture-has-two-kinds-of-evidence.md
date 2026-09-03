# One fixture has two kinds of evidence: measure the mutant ON the fixed version

## Observe

`feat-prove-diagnostics-identity` mixes the two quest types that the previous two notes separated: an assertion
attempt to kill the living mutant (the code is correct, must be GREEN now) and an assertion exposing the actual error (must be RED
immediately). The two assertions use the SAME JDT LS fixture. The first round of mutant measurements thus gives results
mixed: both conditions are red under m1 and under m2, but one of them is red because of an uncorrected error, not
because mutants.

## Evidence

| Hit | m1 | m2 | What can you read |
|---|---|---|---|
| Above unedited code | 0005 red, 0006 red | 0005 red, 0006 red | Cannot distinguish the cause of 0006 |
| Above corrected code | 0005 red, 0006 blue | 0005 red, 0006 blue | Each mutant touches exactly one axis |

Only the second turn proves what needs to be proven: asserting that the cache key catches the cache key mutant,
and confirm that the identity URI is not corrupted. The first turn must still be recorded in evidence because it is equal
behavioral evidence of the actual error, but it is not discriminatory evidence.

## Rules for next time

When a `prove` feature both kills the mutant and exposes the actual error in the same fixture, measure the mutant TWO
times: once before correction (take red behavior), once after correction (take discrimination). Degree
Valid mutant evidence is evidence measured on the correct ciphertext to be submitted. Keep pristine copies out
source tree: `src/` in this repo is not tracked by git so `git checkout` cannot be reverted.

Attached: when running in parallel with another test-implementer, compare the mtime of the src file before attributing errors
for my change — the three red astral-plane shifts in the last `npm test` came from `tool-layer.ts` which agent
That's just written, not from the two edited lines in `projectUris()`.