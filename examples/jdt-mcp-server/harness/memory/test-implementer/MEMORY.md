# Test implementer memory — JDT MCP Server

Index of what the test-implementer agent has learned across runs (`harness/docs/reference/agent-memory.md`
documents the schema and why). One line per entry, always loaded — keep it short; the reasoning
lives in the linked file, read that only when the line looks relevant.

Write a new entry when a test could not be made to fail red for a non-obvious reason, when a
generator produces useless inputs until it was fixed, or when a mutant survived a test that looked
sufficient. Don't write one for a routine red-green cycle.

Write entries and hooks **in English**, whatever language the rest of the project uses: memory is
addressed to whichever agent reads it next, not to this project's readers. Entries already written
in another language stay as they are — this governs what gets written from now on.

<!-- - [Title](slug.md) — one-line hook -->
- [Behavioral red requires a callable seam](behavioral-red-requires-callable-seam.md) — Do not scaffold an integration oracle before its dependency interfaces exist; missing-module red is not behavioral evidence.
- [Mutant-kill oracle inverts red-first](mutant-kill-oracle-inverts-red-first.md) — A `prove` feature naming a surviving mutant must be green on clean source; the red run comes from temporarily applying that named mutant, then reverting.
- [One mutant per condition](mutant-per-condition-proves-discrimination.md) — The `prove` feature with completed dependencies is green; We must manually construct each failure mode of the falsifier into a mutant to demonstrate that each condition captures the correct mode.
- [The stop is in the mutation region](chot-chan-nam-trong-vung-dot-bien.md) — With mutants that reverse the order, deferred is placed in one of two statements issued at two different times; The fixture after the stop must be valid in both orders, only the positive is distinguished.
- [One Fixture Two Types of Evidence](mot-fixture-two-types-of-general.md) — When a fixture both kills the mutant and exposes the true error, measure the mutant again ON the corrected version; only that turn distinguishes each condition.
- [Fixture recording parallel fragment self-accusing subject](fixture-recording-fragment-parallel-song-tu-buoc-toi-subject.md) — Fixture constructing hazard framing that must be serialized for each message; Mixing the bytes of two messages is a fixture error, not a subject violation.
- [Difference must exceed token width](do-lech-phai-vuot-be-rong-token.md) — Fix false count only when deviation is larger than asked token width; The deviation in the token is attracted by the subject to the correct symbol and the mutant survives.
- [Hook after runs in order of registration](hook-after-run-in-order-of-registration.md) — `t.after` of node:test is FIFO, so `rmSync` registers before `pool.close` deletes the directory while the child process is alive and suspends the test process.