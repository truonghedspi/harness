# Definition of Done — {{PROJECT_NAME}}

Most agent failures are harness-induced, not model-induced (Lesson 1). The highest-ROI fix is a
concrete, verifiable definition of done — so "done" is a machine-checkable fact, not the agent's
feeling (Lesson 9).

## A feature is done only when ALL hold

1. **Behavior implemented** — the feature's stated `behavior` in `feature_list.json` works.
2. **Verification ran and passed** — the feature's `verification` command was actually executed,
   at the correct level (`docs/testing-standards.md`). Not "should pass" — *did* pass.
3. **Evidence recorded** — command, one-line summary, and date written into the feature's
   `evidence` field.
4. **Clean and restartable** — `./init.sh` is green from a clean checkout; no stale artifacts.
5. **Independently approved** — the checker (a different agent/prompt, sometimes a different
   model) re-ran the evidence, tried to falsify it, and set `status: done`. The worker never sets
   its own `done`.

## Diagnostic loop when a task fails

Don't blame the model. Attribute the failure to a harness layer and fix *that*:

1. Vague requirements → sharpen the feature's `behavior`.
2. Unwritten conventions → add to `docs/constraints.md`.
3. Incomplete environment → fix `init.sh`.
4. No verification → add a real `verification` command.
5. Lost cross-session state → update `progress.md` / `DECISIONS.md`.

Then re-run. Keep a short failure note in `progress.md` so the same layer isn't rediscovered next
session.
