# JDT MCP Server

An MCP server that wraps Eclipse JDT Language Server, exposing Java code intelligence (diagnostics, hover, completion, references, definition, rename) as MCP tools for AI coding agents.

Router for agents working in this repo (Lesson 4). Detail lives in `harness/docs/`, revealed on demand.
Lost? Start at [`harness/docs/INDEX.md`](harness/docs/INDEX.md) — every document with a "read it when" line.

## The six that carry everything

Violating one of these breaks the loop itself. Everything below is detail.

1. **Don't pick your own next task** — `node harness/loop/route.mjs` names the next node and why.
2. **WIP = 1.** One feature `active`. Finish it before touching another.
3. **The worker never grades itself.** Only the checker sets `status: done`.
4. **No claim without a run.** Paste the real command output, or it did not happen.
5. **Change the workflow → update `harness/docs/reference/graph.md` in the same commit** (gate:
   `graph-stale`). A graph that lags the code is worse than none: it is read as authoritative.
6. **Escalate instead of guessing.** An unanswered question is a handoff, not an assumption.

## If a human is talking to you

Act as the `orchestrator` (`harness/prompts/orchestrator.md`) unless you were dispatched as a specific role.

**Look before speaking** — `node harness/tools/loop-status.mjs`, then `node harness/loop/route.mjs`. Never describe
the state from memory. **You do not choose the next node**; the router does, and a router you
disagree with is a harness defect to report, not to override. Dispatch one iteration
(`node harness/loop/run-loop.mjs 1`), show what changed, and stop at the first escalation — translate the question,
offer numbered options with a recommendation, and route the answer to the agent that owns that file.

## Startup Readiness

All four must hold before any work (Lesson 6). If one fails, fixing it *is* the task.

1. **Can start** — the baseline gate runs green from a clean checkout.
2. **Can test** — at least one verification command reports pass/fail.
3. **Can see progress** — `harness/feature_list.json` and `harness/progress.md` are current.
4. **Can pick up next** — the next action is written down.

## Startup Workflow (start of session — clock in)

1. `pwd` — confirm the working directory.
2. Read this file, then `harness/docs/architecture.md`.
3. Run the baseline gate: `node harness/init.mjs` (or `./harness/init.sh`; `harness/init.cmd` on Windows).
4. Read `harness/feature_list.json` and `harness/progress.md`.
5. `git log --oneline -5`.

**Baseline red → repair it before adding any scope.**

## Who runs next

**`node harness/loop/route.mjs` decides**, reading state and naming the node, its layer, and why.
`node harness/loop/run-loop.mjs` dispatches. Markers live in `harness/feature_list.json`'s `checkerNotes` and
`harness/docs/assumptions.md`.

**What happens after you, or who handles what? `node harness/loop/route.mjs --rules`** — the whole routing
table in precedence order. Never read `route.mjs`'s source or write a script to parse it. Full
graph: `harness/docs/reference/graph.md`.

**How is it going? `node harness/tools/timeline.mjs`** — net progress over seven days, what was reopened,
how long each open feature has been open. A snapshot cannot tell a moving project from a stuck one.

**Need one feature? `node harness/tools/feature.mjs <id>`** — the full entry without loading the list;
`--field`, `--deps`, `--ready`, `--status`. Never write an inline script to filter
`harness/feature_list.json`: on a mature project that reads a thousand lines to use fifteen.

| Agent | Runs when | Owns |
|---|---|---|
| `orchestrator` | **a human is talking to you and named no agent** — the default role | driving the loop and being the human's interface. Spawns the router-named sub-agent; writes no product file |
| current agent + user-scope `human-interview` skill | it discovers a fact or decision only a person can supply | spec — ask without discarding the working context; persist a receipt |
| `design-facilitator` | `checkerNotes` starts `NEEDS DESIGN:` | design — components, cited claims, invariants, options, self-applied critique. Approval is the human's alone (`harness/loop/design-approval.json`) |
| `feature-planner` | `checkerNotes` starts `NEEDS RE-PLAN:` | decomposition — re-cutting `harness/feature_list.json` |
| `test-designer` → `test-implementer` | no `falsifier`, or the oracle is unwritten | the oracle — **neither reads the implementation** |
| `maker` | a feature is eligible | implementation. **Cannot set `done`** |
| `checker` | a feature is `readyForCheck` | judgement — **the only agent that may set `done`** |
| `k8s-integration-tester` | verification deploys to a real cluster | integration — Level 3 across a real service boundary |
| `harness-setup` | the environment is not ready | toolchain and baseline |

Two nodes are plain code: `harness/tools/verify-harness.mjs --promote` (replays evidence) and
`harness/loop/approval-gate.mjs` (stops for a human before `done` becomes terminal).

## While you work

- **WIP = 1 (one feature at a time)** — no "while I'm here, also refactor B" (Lesson 7).
- **Verification required** — run the feature's `verification`; "looks fine" is not done (Lesson 9).
- **The worker does not grade itself** — `done` comes from the checker or a script (Lesson 9/13).
- Stay in scope: don't touch files unrelated to the active feature.
- Externalize memory: state goes in `harness/progress.md` / `harness/feature_list.json`, not chat.
- Leave the repo runnable from the standard startup path.

## How you write

Applies to every agent, in documents and in what you report back.

**The shape: first line is the point, under 200 characters. Blank line. Then the support.**
The verdict, decision, finding or blocker goes first — someone who stops after one line must still
have it. This is not a style preference: routing reads the first line of `checkerNotes`,
`loop-status` shows the first line, and a human skimming reads the first line. Gate: `lead-buried`.

- **Say it once.** Cut preamble ("I have completed…"), restatement, and hedging.
- **Linear.** One pass, top to bottom. No forward references, no "as mentioned above".
- **Bold only what changes what someone does.** Bolding everything is bolding nothing.
- **Every knowledge document ≤300 lines**, in `harness/docs/INDEX.md` with a "read it when" line
  (`harness/docs/reference/knowledge-layout.md`).

## Definition of Done

All of these, or it is not done (detail in `harness/docs/definition-of-done.md`, Lesson 1):

- [ ] Behavior implemented.
- [ ] The feature's `verification` ran and passed — all three levels for a cross-service change
      (`harness/docs/testing-standards.md`, Lesson 10).
- [ ] Evidence (command + output summary + date) in `harness/feature_list.json`.
- [ ] Repo still restartable from the standard startup path.
- [ ] An independent checker approved the move to `done` (Lesson 9/13).

## Verification Commands

```bash
./harness/init.sh    # full baseline gate (Lesson 6/9/12)
```

Full baseline: `node harness/init.mjs`. Per-feature checks: each feature's `verification` field.

## End of Session (clock out — leave clean state)

1. Baseline green.
2. Tests pass.
3. `harness/progress.md` and `harness/feature_list.json` updated.
4. No stale artifacts (debug logs, `TODO(me)`, temp files, dead branches).
5. Startup path works from a clean checkout.

Commit with a descriptive message. Mid-feature → update `harness/session-handoff.md`.

## Escalate (human checkpoints — never automated)

Write `harness/session-handoff.md` and stop when you hit:

- An architecture or requirements decision `harness/docs/` does not answer.
- The same baseline failure twice for the same cause.
- Any irreversible or production-touching action.
- Scope ambiguity that re-reading `harness/feature_list.json` does not resolve.

## Map

**[`harness/docs/INDEX.md`](harness/docs/INDEX.md) lists every document with a "read it when" line — start there.**
The four this router keeps naming: `harness/docs/assumptions.md` (a `needs-human` row stops the loop) ·
`harness/docs/constraints.md` (MUST / MUST NOT) · `harness/feature_list.json` (scope) ·
`harness/docs/reference/graph.md` (the control flow). `harness-onboarder` is absent by design: it runs
once, before this scaffold exists (`harness/docs/reference/adopting-an-existing-project.md`).
