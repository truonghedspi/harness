# Loop Engineering (Lesson 13, in depth)

Loop engineering is *replacing yourself as the person who prompts the agent* — you design the
system that prompts it instead. The harness (Lessons 1–12) makes a single run reliable; the loop
makes continuous runs autonomous. **The loop is one floor above the harness — it never replaces
it.** A loop on a weak harness just amplifies the weakness faster.

## The simplest possible loop: goal + verification + stopping condition

Every loop, no matter how elaborate, reduces to three things:

1. **Goal** — what the end state looks like (not the next step).
2. **Verification method** — how "done" is checked, mechanically.
3. **Stopping condition** — a *machine-checkable* predicate, judged by someone other than the
   worker.

`loop/goal.md` in the scaffold is exactly this document. Fill it with the project's real
objective and a real stop predicate (e.g. "`node check-coverage.mjs` passes and `./init.sh` is
green"). The single most common mistake is a vague stop condition ("looks about right"); that is
verification debt on day one.

## `/goal` vs `/loop` — don't confuse them

| | `/goal` (goal-based) | `/loop` (time-based) |
|---|---|---|
| Shape | one big task, runs until done | one small action, repeats on an interval |
| Stop | goal reached, or budget exhausted | you stop it, or the task exits |
| Memory | cumulative progress each iteration | each run independent, no memory |
| Use | "implement the payment system with tests" | "check if CI is broken every 15 min" |

One-sentence test: **does this thing have an end?** Has an end → goal-based. No end, just keep
watching → interval-based. Never shove a goal-shaped task into an interval loop — it restarts
from the same point every time.

## The four loop types

| Type | Trigger | Stop |
|---|---|---|
| Turn-based | you type each prompt | agent thinks done / you interrupt |
| Goal-based | you give a goal | independent evaluator confirms, or max turns |
| Time-based | scheduled interval | you stop it, or task exits |
| Event-driven | external event (PR, CI, issue) | after handling event, or retry limit |

## The six primitives

A loop's design toolkit — reach for what the job needs, not all of them every time.

1. **Automations — the heartbeat.** Without a trigger it's a one-off, not a loop. On Kiro this is
   `run-loop.sh` under cron/CI, or a scheduled `kiro-cli` invocation.
2. **Worktrees — isolation at scale.** As soon as >1 agent runs, file collisions are inevitable.
   Give each parallel agent its own `git worktree`. Ceiling is still your review bandwidth.
3. **Skills — stop re-explaining the project.** Codified project knowledge (`SKILL.md`) read
   every run instead of re-typed. This skill is itself an example.
4. **Connectors — touch real tools.** MCP servers let the loop read the issue tracker, hit
   staging, post to Slack. Configured in `.kiro/settings/mcp.json`.
5. **Sub-agents — keep the maker away from the checker.** The single most valuable structural
   choice. See below.
6. **External State — the loop's memory (the spine).** Models forget between runs. `progress.md`,
   `feature_list.json`, `trace/trace.jsonl`, an issue tracker — memory lives on disk. Everything
   else depends on this.

## Generator/evaluator separation — the hardest lesson

A model is its own output's best defense attorney. If the agent that wrote the code judges the
code, it scores itself high — not from dishonesty but because it already convinced itself the
path was right. **Never let the same entity (same model, same prompt) both do the work and grade
it.** The scaffold enforces this:

- `maker` advances work and records honest evidence, but **cannot** set `status: done` — it sets
  `readyForCheck: true`.
- `checker` re-runs the evidence, tries to *falsify* the maker's claims, and is the only agent
  allowed to flip a feature to `done`. It is write-restricted to state files in
  `.kiro/agents/checker.json` so it can't quietly "fix and pass" its own review.

One sentence to remember: **someone in your crew must not believe you.**

## The ratchet (Karpathy's autoresearch pattern)

The exemplar loop only moves forward. Each iteration: read direction → survey state → propose a
change → modify → snapshot (`git commit`) → run under a *fixed* budget → evaluate against a
machine metric → keep (commit stays, log it) or revert (`git reset`, log the failure) → next.
`git log` becomes a validated work log; a results file records every attempt, success or failure.
The methodology lives in an English document (`program.md`/`goal.md`), not in code — you give the
agent a *methodology*, not a task, and let the methodology be the loop.

## The four silent costs

They accumulate invisibly the longer a loop runs. Design against them from iteration one:

1. **Verification debt** — "looks fine" ≠ "confirmed." Stop conditions must be machine-checkable.
2. **Comprehension rot** — the faster it ships, the further your understanding drifts. Fast loops
   require fast reading; read what the loop produces.
3. **Cognitive surrender** — don't use the loop to *avoid* thinking. "The loop doesn't know the
   difference between going faster and avoiding understanding. You do."
4. **Token blowout** — context grows ~quadratically with turns. Compact/summarize old turns;
   keep external state on disk so each run starts lean.

## The maturity ladder — start at Level 1

1. **Goal Runner** — one goal with a stopping condition; agent loops until met.
2. **Scheduled Single-Task** — one automation runs one task on a timer.
3. **Multi-Agent Loop** — maker/checker split; each finding forks an isolated worktree.
4. **Self-Feeding Loop** — the loop discovers its next task from external state
   (`feature_list.json` is the natural source).
5. **Fleet Orchestration** — multiple loops in parallel sharing one memory layer.

Most teams sit between L2 and L3. Level 1 is the fastest path to a return. With this scaffold:
Level 1 = one `kiro-cli chat --agent maker` run against a real `loop/goal.md`; Level 3 =
`run-loop.sh N` alternating maker/checker; Level 4 = the maker picking its own next feature from
`feature_list.json` dependencies.
