# AGENTS.md — harness assets

Router for every agent (Lesson 4). Details live in `docs/`; load them when needed.
Index: [`docs/INDEX.md`](docs/INDEX.md).

## Dual nature

This repository is both the **skill source** and a **dogfood target**.

| Role | Paths |
|---|---|
| Skill source | `harness-loop/` — `templates/tree/` (scaffold), `scripts/` (tools), `references/` (documentation), `upgrade-context.json` |
| Dogfood target | root `tools/`, `loop/`, `prompts/`, `feature_list.json`, `progress.md`, `docs/` — the real harness running on this repository |
| Generated from the manifest | `.kiro/`, `.claude/`, `.codex/` — from `agents.manifest.json` through `tools/gen-agents.mjs`; do not edit by hand |

**The product is `harness-loop/`.** Prove a change works with: `bash harness-loop/scripts/demo.sh`.

## 6 invariants

1. **Do not choose a task yourself** — `node loop/route.mjs` names the next node.
2. **WIP = 1.** One active feature. Finish or block it before touching another feature.
3. **Workers do not grade themselves.** Only the checker sets `status: done`.
4. **Do not claim without running it.** Include real command output.
5. **When the workflow changes, update `harness-loop/references/graph.md` in the same commit** (gate: `graph-stale`).
6. **Escalate instead of guessing.** An unanswered question is a handoff, not an assumption.

## If you are talking to a user

Act as the `orchestrator` (`prompts/orchestrator.md`) unless a specific role has been dispatched.
**Inspect before speaking** — run `node tools/loop-status.mjs`, then `node loop/route.mjs`. Do not describe
state from memory. You do not choose the node; the router does.

## Startup Readiness

All four must pass (Lesson 6). A failure means fixing it *is* the task.

1. **Can start** — the baseline gate is green. 2. **Can verify** — at least one verification pass/fail exists.
3. **Progress is visible** — `feature_list.json` and `progress.md` agree.
4. **The next step is known** — the next action is recorded.

## Startup Workflow (start of session — clock in)

1. `pwd` — confirm the repository root.
2. Read this file, then `docs/architecture.md`.
3. Run the baseline: `node init.mjs` (or `./init.sh`). **If red, fix it before adding scope.**
4. Read `feature_list.json` and `progress.md`. Run `git log --oneline -5`.
5. `node harness-loop/scripts/harness-issue.mjs list` — open issues.

## Who runs next

**`node loop/route.mjs` decides.** `node loop/run-loop.mjs` dispatches.
`node loop/route.mjs --rules` — routing table. `node tools/timeline.mjs` — seven-day progress.
`node tools/feature.mjs <id>` — full entry; `--deps`, `--ready`, `--status`.

| Agent | Runs when | Owns |
|---|---|---|
| `orchestrator` | a user opens a session without naming an agent | coordinates the loop and spawns the router-designated sub-agent; does not write product files |
| current agent + `human-interview` | an event/decision requires a user answer | gathers it — asks without losing context and records the result |
| `design-facilitator` | `checkerNotes` starts with `NEEDS DESIGN:` | design — components, invariants, options. Approval belongs to the user (`loop/design-approval.json`) |
| `feature-planner` | `checkerNotes` starts with `NEEDS RE-PLAN:` | decomposition — recuts `feature_list.json` |
| `test-designer` → `test-implementer` | no `falsifier` exists or the oracle is unwritten | oracle — **does not read implementation** |
| `maker` | a feature is eligible | implementation. **Cannot set `done`** |
| `checker` | every unblocked open feature is `readyForCheck` | final acceptance — **the only agent that sets `done`** |
| `harness-setup` | the environment is not ready | toolchain and baseline |
| `harness-improver` | `verify-harness` reports a `layer: harness` finding | fixes the skill source, not the target |

Two code nodes: `tools/verify-harness.mjs` (replays evidence) and `loop/approval-gate.mjs` (evaluates user approval).

Three agents are outside routing — they run before/around the loop: `orchestrator`, `harness-setup`,
and `harness-onboarder` (once per existing codebase).

## Working Rules

- **Fix the template, not the target.** Defects belong in `templates/tree/**` or `scripts/*.mjs`.
- **Every behavioral change has a `demo.sh` step that fails without it.**
- **Every upgrade-relevant change updates `upgrade-context.json`.** Gate: `check-upgrade-context.mjs`.
- **Record a defect before fixing it:** `harness-issue.mjs add` → fix → `improve-harness.mjs --reverify`.
- **A new gate must be calibrated on a real target before shipping.**
- **Every document is ≤300 lines** and appears in the index. `SKILL.md` is the router; details go in `references/`.

## How you write

The first line is the conclusion/decision/finding, under 200 characters. Then a blank line, then supporting detail.
Say it once. Stay linear. Bold only action-changing material. Brief and concise.
[Presentation guidance](docs/reference/presenting-and-proposing.md) applies to important reports.

## Verification Commands

```bash
bash harness-loop/scripts/demo.sh          # real gate — every feature, end to end
node harness-loop/scripts/check-coverage.mjs --target <project scaffold>
node harness-loop/scripts/verify-harness.mjs --target <project scaffold> --run-features
```

Full baseline: `node init.mjs`. Per feature: its `verification` field.
Testing hierarchy: [testing standards](docs/testing-standards.md). Map: [architecture](docs/architecture.md).

## Definition of Done (every skill change)

- [ ] Behavior lives in `templates/tree/**` or `scripts/**`, not only in the target
- [ ] A `demo.sh` step covers it and fails when reverted
- [ ] `bash harness-loop/scripts/demo.sh` xanh
- [ ] New gate calibrated on the real repository
- [ ] Workflow change → `references/graph.md` + `references/workflow-diagram.md` updated
- [ ] Documentation: `SKILL.md` (link + one line) and relevant `references/*.md`
- [ ] Fixed defect → resolved in `harness-issues.jsonl` with a verification note

## End of Session (clock out — leave clean state)

1. `demo.sh` is green. 2. Documentation and `harness-issues.jsonl` are updated.
3. The commit names the finding, not only the change. 4. Unfinished work → `session-handoff.md`.
5. No stale artifacts (debug logs, `TODO(me)`, temporary files).

## Escalation (human checkpoints — not automated)

Write `session-handoff.md` and stop for: an unanswered `docs/` architecture decision · the same baseline
failure twice for the same cause · an irreversible/production-touching action · changing default scaffold
content · proposing to weaken a gate · a finding that cannot be classified as `layer: project` or `layer: harness`.

## Map

**[`docs/INDEX.md`](docs/INDEX.md)** — each document includes “when to read it.”
Four frequent references: `docs/assumptions.md` · `docs/constraints.md` · `feature_list.json` · `docs/reference/graph.md`.

Skill source: `harness-loop/SKILL.md` (start here) · `harness-loop/references/graph.md`
(routing) · `harness-loop/templates/tree/` (fix defects here) · `harness-loop/scripts/` (tools) ·
`harness-loop/harness-issues.jsonl` (known defects).
