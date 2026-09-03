# A prewritten oracle cannot return to the oracle class after obtaining evidence

**Context.** 2026-08-22, handle FOLLOW-UP of `feat-workspace-pool`. Checker detected
`TCON-POOL-0003` in `test/integration/pool-lifecycle.integration.spec.ts` is red because of main error
oracle, not the implementation's. The first reflex is by the book: one's oracle error
The `prove` feature belongs to test-designer/test-implementer, not the planner.

**What makes that reflection wrong in this project.** The test-implementer rule in `loop/route.mjs` only matches
when `evidence` is empty — that's how it distinguishes "unwritten oracles" from "written oracles". But project
This oracle writes BEFORE there is a deployment, and each time it is written, a red run is recorded
`evidence`. From that moment on, that `prove` feature never returned to the oracle layer: it just
also matches maker rules. At the same time, maker-prompt prohibits maker from rewriting tests created by the oracle class. Results
is a silent trap — no node in the graph is allowed to edit that file.

**Workaround used.** Do not remove `evidence` to force the router to change direction (wrong history). Instead,
Allows exactly one limited edit in advance, recorded in `checkerNotes` and in the context package, with justification
just the qualified text of the condition itself — editing the oracle to match its condition does not
must design new conditions, so there is no need for a test-designer. At the same time, clearly state the NO part
impact (affirmation carries the power of falsifier), so that the right to correct does not turn into the right to weaken the test.

**Tell you later.** Whenever a `prove` feature has `evidence` that is not empty but
Its oracle needs fixing, don't wait for the router to return it to the oracle layer — the router won't. Or write
Limited editing rights to the feature entry itself, or completely cut a new oracle feature from the file
private.