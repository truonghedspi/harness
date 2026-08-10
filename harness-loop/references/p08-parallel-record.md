# P08 experiment 2 — fan-out / fan-in on the verify node

## Where the graph can parallelize, and where it must not

WIP=1 (Lesson 7) forbids parallel *makers*: two agents editing one repo produce a merge conflict
nobody asked for, and the serial reviewer is the bottleneck anyway. So the fan-out point is not
implementation.

It is **evidence replay**. `verify-harness --run-features` re-runs every claimed feature's
verification one at a time, and those subtasks are genuinely independent — each answers "does THIS
command still exit 0". No subtask reads another's output. That is the definition of a safe fan-out,
and it is the only such point in this graph.

## Fan-out rule

> One subtask per **distinct** verification command among features claiming `done`/`passing`.
> Identical commands collapse to one subtask — replaying the same command twice measures nothing
> twice. Each worker runs in its own detached `git worktree` at HEAD.

Two commands are excluded from the fan-out, for different reasons:

| Class | Example | Why | Handling |
|---|---|---|---|
| **not isolatable** | `./tools/k8s-test-env.sh …` | reaches a shared cluster; a worktree clones the filesystem, not the world | skipped, reported by count |
| **machine-exclusive** | Aeron `TestCluster` SITs | run locally, but bind a fixed UDP port base | run in parallel with everything else, **serial among themselves** (one-slot mutex) |

## Fan-in rule

> **AND.** Every subtask must exit 0. One failure fails the node.

This is evidence replay, so "most of the evidence still reproduces" is not a passing state — a
feature whose command no longer runs is a feature whose `done` is a lie, regardless of how the
other seventeen did. The report keeps the per-subtask verdict so the failure is localizable to one
command and one worktree, not to "the verify step".

## The measurement — aeron-demo, 20 claimed features → 18 distinct commands

| Run | Mode | Wall clock | Σ subtask time | Fan-in |
|---|---|---|---|---|
| baseline | sequential | **88.3s** | 88.3s | PASS 18/18 |
| 1 | parallel ×6, no exclusive group | **34.5s** | 176.9s | **FAIL 17/18** |
| 2 | parallel ×6, exclusive group | **34.3s** | 176.3s | PASS 18/18 |
| 3 | parallel ×6, exclusive group | 35.3s | 183.3s | PASS 18/18 |
| 4 | parallel ×6, exclusive group | 34.7s | 180.1s | PASS 18/18 |

Worktree setup cost: **0.4s** for six worktrees — negligible, and the reason worktrees are the
right isolation primitive here rather than a container.

**Speedup: 2.56×** wall clock, stable across three runs.

**But the CPU cost doubled.** The sum of subtask times went from 88.3s to ~180s for the same
eighteen commands: each maven build takes roughly twice as long when six of them share the machine.
So the honest number is *2.56× faster in wall clock for 2.04× more CPU-seconds* — parallelism here
buys latency and pays for it in throughput. On a laptop that is a good trade (you are waiting). On
a shared CI runner billed by CPU-minute it is close to a wash.

## What the failed run taught — the fan-out key is the resource, not the command

Run 1 failed `LedgerServiceSIT`, which had just passed sequentially and passed again in isolation
(1.0s). Not a regression: Aeron's `TestCluster` binds a **fixed UDP port base**, and it was running
concurrently with `ClusterRigSmokeSIT` in a different worktree.

A worktree isolates the filesystem. It does not isolate ports, `/dev/shm`, the loopback interface,
or any other machine-wide resource. So the fan-out rule had to change from *partition by command*
to **partition by the exclusive resource a command needs** — the three cluster SITs share one slot.
Cost of that correction: nothing measurable (34.5s → 34.3s), because the exclusive group is small
and short.

This is the single most transferable finding of the experiment: **a parallel fan-out is only as
correct as its model of what the subtasks contend on**, and that model is not derivable from the
command text. It came from one failing run.

## Against the exercise's metrics

| Metric | Result |
|---|---|
| Can shared state support parallel subtasks? | Yes, because this node **writes nothing** to shared state — it reads `feature_list.json` and emits a report. The moment a fan-out node writes to the shared state, the merge rule stops being trivial. That is why `--promote` (which writes `status`) stayed sequential. |
| When a subtask fails, can you locate which one? | Yes — command, worker, worktree path, exit code, and output tail per subtask, in `trace/replay-parallel-6.json`. |
| Time saved vs. coordination overhead | 53.8s saved per full replay; overhead is 0.4s setup + 92s of extra CPU. |
| Is every subtask's state visible? | Yes, streamed per subtask as it lands, plus the JSON report. |
| Is the fan-in merge standard sound? | Only after run 1 forced the exclusive group. AND was always the right *rule*; the fan-out partition was wrong, which made a sound rule produce a wrong verdict. |

## Honest limits

- **This is the cheap node.** It is deterministic code, no LLM, no tokens. The expensive nodes —
  maker, checker, designer — are exactly the ones WIP=1 and the serial-review bottleneck say not to
  parallelize. So the token cost of this experiment is zero, and so is the token *saving*.
- **`--promote` cannot join the fan-out** as written: it writes `status` back into
  `feature_list.json`. Parallelizing it needs a real merge rule for concurrent writes to one field,
  which is more machinery than the 54 seconds is worth.
- **18 commands, 6 workers, one machine.** Nothing here says anything about how this scales, and
  the CPU-time doubling suggests the curve flattens fast.
