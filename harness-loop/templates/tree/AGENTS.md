# {{PROJECT_NAME}}

{{PROJECT_PURPOSE}}

> This is the **router** for agents working in this repo (Lesson 4): overview, invariants, and
> links. Project detail lives in `docs/*.md`, revealed on demand. Keep this file short.

## Map (read these when relevant)

> Don't know which document you need? Start at [`docs/INDEX.md`](docs/INDEX.md) — it lists every
> document with a "read it when" line, so you can decide what *not* to open.

- `docs/INDEX.md` — the map of all documents
- `docs/assumptions.md` — load-bearing design assumptions; a `needs-human` row stops the loop
- `docs/cross-cutting.md` — policies with an owner and an enforcing rule (retry, identity, timeouts)
- `docs/architecture.md` — what this is, how it's organized, how to run/verify, where we are
- `docs/constraints.md` — hard MUST / MUST NOT rules
- `docs/testing-standards.md` — the three verification levels (unit / in-service integration / cross-service microservice integration)
- `docs/definition-of-done.md` — what "done" means, concretely
- `feature_list.json` — the feature state (single source of truth for scope)
- `progress.md` / `DECISIONS.md` — where we left off, and why decisions were made
- `loop/goal.md` — the autonomous loop's objective and stopping condition

## Agents — who does what, and who decides who runs next

**Don't choose by hand.** `node loop/route.mjs` reads the state and names the next node, the layer
it belongs to, and why. `loop/run-loop.sh` dispatches on it. Routing markers live in
`feature_list.json`'s `checkerNotes` and in `docs/assumptions.md`; the full graph — nodes, edges,
state ownership — is `docs/reference/graph.md`.

| Agent | Runs when | Layer it owns |
|---|---|---|
| `context-interviewer` | a `needs-human` row sits in `docs/assumptions.md` | spec — facts the repo cannot contain |
| `designer` → `design-reviewer` | `checkerNotes` starts `NEEDS DESIGN:` | design — components, cited claims, assumptions |
| `feature-planner` | `checkerNotes` starts `NEEDS RE-PLAN:` | decomposition — re-cutting `feature_list.json` |
| `test-designer` → `test-implementer` | a feature has no `falsifier`, or its oracle is unwritten | the oracle — **neither reads the implementation** (`docs/reference/test-authoring.md`) |
| `maker` | a feature is eligible | implementation. **Cannot set `status: done`** |
| `checker` | a feature is `readyForCheck` | judgement — the only agent that may set `done` |
| `k8s-integration-tester` | the verification deploys to a real cluster | **integration** — Level 3 proof across a real service boundary. A test-layer node: same authoring rules, but it *does* read the code, so its independence is the boundary, not blindness |
| `harness-setup` | the environment is not ready | toolchain and baseline |

`harness-onboarder` is not here: it runs once, before this scaffold existed, to adopt an existing
repo (`docs/reference/adopting-an-existing-project.md`). Its output is everything you are reading.

Two nodes are plain code, not agents: `tools/verify-harness.mjs --promote` (replays evidence) and
`loop/approval-gate.mjs` (stops for a human before `done` becomes terminal).

## Startup Readiness

Before any work, these four must hold (Lesson 6). If any fails, fixing it is the whole task:

1. **Can start** — `./init.sh` runs to green from a clean checkout.
2. **Can test** — at least one verification command runs and reports pass/fail.
3. **Can see progress** — `feature_list.json` + `progress.md` are current.
4. **Can pick up next** — the next action is written down (progress.md / session-handoff.md).

## Startup Workflow (start of session — clock in)

1. Confirm working directory with `pwd`.
2. Read this file, then `docs/architecture.md`.
3. Run `./init.sh` to verify the environment is healthy.
4. Read `feature_list.json` for the current feature state, and `progress.md` for context.
5. Review recent commits: `git log --oneline -5`.

If the baseline is red, repair it before adding any new scope.

## Working Rules

- **Files you write:** every knowledge document stays **≤300 lines** and is listed in
  `docs/INDEX.md` with a "read it when" line. Over budget → split it the way it grew (topic doc by
  section, keeping the original filename as a map; append-only log by rotating a frozen dated
  archive). Method: `docs/reference/knowledge-layout.md`; the binding rules are in
  `docs/constraints.md`, already loaded for you.

- **WIP = 1 (one feature at a time):** exactly one feature is `active`. Finish and verify it
  before activating another. No "while I'm here, also refactor B" (Lesson 7).
- **Verification required:** never claim done without running the feature's `verification`
  command. "Looks fine" is not done (Lesson 9).
- **Stay in scope:** don't modify files unrelated to the active feature.
- **Externalize memory:** record state in `progress.md` / `feature_list.json`, not just in chat.
- **The worker does not grade itself:** `status: done` is set only by the checker or a
  verification script, never by the agent that wrote the code (Lesson 9/13).
- **Leave clean state:** the next session must be able to run `./init.sh` immediately.

## Definition of Done

A feature is done only when ALL hold (full detail in `docs/definition-of-done.md`, Lesson 1):

- [ ] Target behavior implemented.
- [ ] The feature's `verification` command actually ran and passed (all three levels required
      for cross-service change, incl. the microservice-integration/contract level — see
      `docs/testing-standards.md`, Lesson 10).
- [ ] Evidence (command + summary + date) recorded in `feature_list.json`.
- [ ] Repository remains restartable from the standard startup path.
- [ ] An independent checker approved the transition to `done` (Lesson 9/13).

## Verification Commands

```bash
{{PRIMARY_VERIFICATION_COMMAND}}
```

The full baseline gate is `./init.sh`. Required per-feature checks live in each feature's
`verification` field in `feature_list.json`.

## End of Session (clock out — leave clean state)

Clean state = these five conditions (Lesson 12). Check them before ending any session:

1. Build passes (`./init.sh` green).
2. All tests pass.
3. `progress.md` and `feature_list.json` are updated.
4. No stale artifacts left behind (no stray debug logs, `TODO(me)`, temp files, dead branches).
5. The standard startup path (`./init.sh`) works from a clean checkout.

Then commit with a descriptive message, and update `session-handoff.md` if work is mid-feature.

## Escalation (human checkpoints — never automated)

Stop and hand off (write `session-handoff.md`) when you hit:

- An architecture or requirements decision not answered by `docs/`.
- The same `./init.sh` failure twice in a row for the same cause.
- Any irreversible or production-touching action.
- Scope ambiguity — re-read `feature_list.json`; if still unclear, escalate.
