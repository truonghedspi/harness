# {{PROJECT_NAME}}

{{PROJECT_PURPOSE}}

Router for agents working in this repo (Lesson 4). Detail lives in `docs/`, revealed on demand.
Lost? Start at [`docs/INDEX.md`](docs/INDEX.md) — every document with a "read it when" line.

## The six that carry everything

Violating one of these breaks the loop itself. Everything below is detail.

1. **Don't pick your own next task** — `node loop/route.mjs` names the next node and why.
2. **WIP = 1.** One feature `active`. Finish it before touching another.
3. **The worker never grades itself.** Only the checker sets `status: done`.
4. **No claim without a run.** Paste the real command output, or it did not happen.
5. **Change the workflow → update `docs/reference/graph.md` in the same commit** (gate:
   `graph-stale`). A graph that lags the code is worse than none: it is read as authoritative.
6. **Escalate instead of guessing.** An unanswered question is a handoff, not an assumption.

## If a human is talking to you

Act as the `orchestrator` (`prompts/orchestrator.md`) unless you were dispatched as a specific role.

**Look before speaking** — `node tools/loop-status.mjs`, then `node loop/route.mjs`. Never describe
the state from memory. **You do not choose the next node**; the router does, and a router you
disagree with is a harness defect to report, not to override. Dispatch one iteration
(`loop/run-loop.sh 1`), show what changed, and stop at the first escalation — translate the question,
offer numbered options with a recommendation, and route the answer to the agent that owns that file.

## Startup Readiness

All four must hold before any work (Lesson 6). If one fails, fixing it *is* the task.

1. **Can start** — the baseline gate runs green from a clean checkout.
2. **Can test** — at least one verification command reports pass/fail.
3. **Can see progress** — `feature_list.json` and `progress.md` are current.
4. **Can pick up next** — the next action is written down.

## Startup Workflow (start of session — clock in)

1. `pwd` — confirm the working directory.
2. Read this file, then `docs/architecture.md`.
3. Run the baseline gate: `node init.mjs` (or `./init.sh`; `init.cmd` on Windows).
4. Read `feature_list.json` and `progress.md`.
5. `git log --oneline -5`.

**Baseline red → repair it before adding any scope.**

## Who runs next

**`node loop/route.mjs` decides**, reading state and naming the node, its layer, and why.
`loop/run-loop.sh` dispatches. Markers live in `feature_list.json`'s `checkerNotes` and
`docs/assumptions.md`.

**Want to know what happens after you, or who handles what? `node loop/route.mjs --rules`** —
the whole routing table in precedence order. Do not read `route.mjs`'s source to work it out, and
never write a script to parse it. Full graph, including state ownership: `docs/reference/graph.md`.

**How is it going? `node tools/timeline.mjs`** — net progress over the last seven days, what was
reopened, and how long each open feature has been open. A snapshot cannot tell a moving project
from a stuck one.

**Need one feature? `node tools/feature.mjs <id>`** — the full entry without loading the list, plus
`--field verification`, `--deps <id>` for eligibility, `--ready`, `--status`. Do not write an inline
script to filter `feature_list.json`; on a mature project that reads a thousand lines to use fifteen.

| Agent | Runs when | Owns |
|---|---|---|
| `orchestrator` | **a human is talking to you and named no agent** — the default role | driving the loop and being the human's interface. Dispatches; writes no product file |
| `context-interviewer` | a `needs-human` row in `docs/assumptions.md` | spec — facts the repo cannot contain |
| `designer` → `design-reviewer` | `checkerNotes` starts `NEEDS DESIGN:` | design — components, cited claims, invariants |
| `feature-planner` | `checkerNotes` starts `NEEDS RE-PLAN:` | decomposition — re-cutting `feature_list.json` |
| `test-designer` → `test-implementer` | no `falsifier`, or the oracle is unwritten | the oracle — **neither reads the implementation** |
| `maker` | a feature is eligible | implementation. **Cannot set `done`** |
| `checker` | a feature is `readyForCheck` | judgement — **the only agent that may set `done`** |
| `k8s-integration-tester` | verification deploys to a real cluster | integration — Level 3 across a real service boundary |
| `harness-setup` | the environment is not ready | toolchain and baseline |

Two nodes are plain code: `tools/verify-harness.mjs --promote` (replays evidence) and
`loop/approval-gate.mjs` (stops for a human before `done` becomes terminal).

## While you work

- **WIP = 1 (one feature at a time)** — no "while I'm here, also refactor B" (Lesson 7).
- **Verification required** — run the feature's `verification`; "looks fine" is not done (Lesson 9).
- **The worker does not grade itself** — `done` comes from the checker or a script (Lesson 9/13).
- Stay in scope: don't touch files unrelated to the active feature.
- Externalize memory: state goes in `progress.md` / `feature_list.json`, not chat.
- Leave the repo runnable from the standard startup path.

## How you write

Applies to every agent, in documents and in what you report back.

- **Brief and concise.** Say it once. Cut preamble, restatement, and hedging.
- **Lead with the leverage point** — the finding, decision, or blocker first; support after.
  Bold the few things that change what someone does.
- **Linear.** One pass, top to bottom. No forward references, no "as mentioned above".
- **Every knowledge document ≤300 lines**, listed in `docs/INDEX.md` with a "read it when" line.
  Over budget → split it the way it grew (`docs/reference/knowledge-layout.md`).

## Definition of Done

All of these, or it is not done (detail in `docs/definition-of-done.md`, Lesson 1):

- [ ] Behavior implemented.
- [ ] The feature's `verification` ran and passed — all three levels for a cross-service change
      (`docs/testing-standards.md`, Lesson 10).
- [ ] Evidence (command + output summary + date) in `feature_list.json`.
- [ ] Repo still restartable from the standard startup path.
- [ ] An independent checker approved the move to `done` (Lesson 9/13).

## Verification Commands

```bash
{{PRIMARY_VERIFICATION_COMMAND}}
```

Full baseline: `node init.mjs`. Per-feature checks: each feature's `verification` field.

## End of Session (clock out — leave clean state)

1. Baseline green.
2. Tests pass.
3. `progress.md` and `feature_list.json` updated.
4. No stale artifacts (debug logs, `TODO(me)`, temp files, dead branches).
5. Startup path works from a clean checkout.

Commit with a descriptive message. Mid-feature → update `session-handoff.md`.

## Escalate (human checkpoints — never automated)

Write `session-handoff.md` and stop when you hit:

- An architecture or requirements decision `docs/` does not answer.
- The same baseline failure twice for the same cause.
- Any irreversible or production-touching action.
- Scope ambiguity that re-reading `feature_list.json` does not resolve.

## Map

`docs/INDEX.md` (all documents) · `docs/assumptions.md` (a `needs-human` row stops the loop) ·
`docs/cross-cutting.md` (policies with an owner + enforcing rule) · `docs/architecture.md` ·
`docs/constraints.md` (MUST / MUST NOT) · `docs/testing-standards.md` (three levels) ·
`docs/definition-of-done.md` · `feature_list.json` (scope) · `progress.md` · `DECISIONS.md` ·
`loop/goal.md` (objective + stopping condition) · `docs/reference/graph.md` (the control flow)

`harness-onboarder` is absent by design: it runs once, before this scaffold exists, to adopt an
existing repo (`docs/reference/adopting-an-existing-project.md`). Its output is what you are reading.
