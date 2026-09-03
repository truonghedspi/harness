# Anti-Patterns — rules R-T1…R-T10

Every rule has a code for reviewer rejection. Implementers self-check before output.

| Rule | Requirement |
|---|---|
| R-T1 | Mapping fixtures and generators use pairwise-distinct values, so field swaps remain observable. |
| R-T2 | Round-trip assertions compare the complete object, not a hand-picked subset of fields. |
| R-T3 | Expected values and reference models are independently derived from the specification, never from the implementation under test. |
| R-T4 | Properties quantify over a meaningful domain, including business boundaries and collision-prone state interactions. |
| R-T5 | A property must assert an oracle, invariant, or relation; “does not throw” alone is insufficient except for a specified parser guarantee. |
| R-T6 | State-machine tests cover invalid `(state, event)` pairs and prove state remains unchanged after rejection. |
| R-T7 | Concurrent tests use deterministic scheduling/replay or a dedicated memory-model tool; timing sleeps are not an oracle. |
| R-T8 | Integration tests assert public contracts and outcomes, not private implementation calls. |
| R-T9 | Surviving-mutant tests assert required behavior, not the current implementation merely to kill a mutant. |
| R-T10 | Test-plan artifacts are one-schema-valid shard per ID. Mutate through harness operations or atomic whole-shard replacement, never text edits inside JSON. |

## Quick detection

- Equal values in two mapper fields hide a swap: reject under R-T1.
- A round-trip assertion listing only selected fields misses omissions: reject under R-T2.
- A test calls the production calculator to compute its expected answer: reject under R-T3.
- Random IDs never cancel existing orders or sequences are too short to expose state interactions: reject under R-T4.
- A property has no meaningful assertion: reject under R-T5.
- Invalid transitions are untested or mutate state: reject under R-T6.
- `Thread.sleep` is used to “prove” concurrency: reject under R-T7.
- An end-to-end test mocks the boundary it claims to verify: reject under R-T8.
- A mutant-killing test encodes a current bug: reject under R-T9.
- A plan bundles conditions or string-replaces JSON: reject under R-T10.
