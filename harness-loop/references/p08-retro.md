# P08 retro — what changed when the loop became a graph

Three experiments, three branches, all against the live harness driving `aeron-demo`:

| Branch | What it added | Hard result |
|---|---|---|
| `p08-explicit-graph` | `references/graph.md` — nodes, edges, state ownership, routing rules | **7 implicit edges**, 3 of which compose into a reproduced livelock |
| `p08-parallel` | `scripts/replay-parallel.mjs` — fan-out/fan-in on the verify node | **2.56× wall clock** for **2.04× CPU**; one wrong partition found by a failing run |
| `p08-human-in-the-loop` | `loop/route.mjs` + `loop/approval-gate.mjs` | 4-layer rollback routing; approval caught a tautology every gate passed |

`demo.sh` still passes on the tip: 32 steps, 63 assertions.

## How the way of working changed

**Before: I asked "is this rule right?" Now I ask "who runs next, and who decided that?"**

That is the whole shift, and it is smaller than the vocabulary suggests. The harness was already a
graph — eleven agent nodes with private contexts, a shared state file with one writer per field,
markers carrying routing intent, checkpoints after every feature, a verify node with a genuinely
fresh context. Nothing in Lecture 14 was a new idea here. What the lecture supplied was **one
question the nine existing gates cannot ask**: *which node runs next?*

Every gate in `verify-harness.mjs` inspects the content of a file. None inspects control flow. So a
repo could pass 13/13 lessons, 9 gates, 32 demo steps and 63 assertions — and still contain a loop
that spawns a paid LLM session every iteration, forever, changing nothing, with every log line
reading healthy. It did. **Drawing the graph was a different axis of verification, not a stricter
version of the same one.**

The sharpest confirmation was Catacora's line landing literally:

> "Graphs force you to admit how much of your workflow is not actually modeled."

Eleven nodes; three with an executable incoming edge. The other eight worked because *I* read a
report and typed the next command. I had been the router, and I had not noticed, because from
inside the loop being the router feels like using the tool.

## What each experiment was actually worth

**Exp 1 was worth the most, and cost the least.** Roughly an hour of writing a table. It found a
livelock that a week of real dogfooding had not, because dogfooding exercises the paths you take
and the table enumerates the ones you don't. **A routing table is a cheap exhaustiveness check on a
system whose control flow lives in prose.**

**Exp 2 was worth the least, and taught the most per line.** 54 seconds saved per replay — real but
not important. The value was the failing run: `LedgerServiceSIT` passed alone, passed sequentially,
and failed beside `ClusterRigSmokeSIT` in a separate worktree. A worktree isolates the filesystem,
not the fixed UDP port base Aeron's `TestCluster` binds. **The fan-out key is not the command; it
is the machine-wide resource the command contends on — and that is not derivable from the command
text.** No amount of design produced that; one broken run did.

It also produced the honest number the lecture's fake statistics don't: 2.56× wall clock for 2.04×
CPU. Parallelism here buys latency and pays throughput. On a laptop that is a good trade. On a
CI runner billed per CPU-minute it is nearly a wash.

**Exp 3 justified the whole project.** Pass 1's evidence read *"passed after widening the
assertion"* — `R-T3`, the tautology, in plain sight. Every mechanical check passed it. Worse,
`evidence-no-red`, the gate I had built hours earlier specifically to catch weak evidence, was
*satisfied* by that clause: it does contain a failure.

**A machine can check that a red run was recorded. Only a person can read what was changed to turn
it green and judge whether that was the right change.** That is the cleanest statement of the
human/machine division this project has produced, and it arrived from a run, not from reasoning.

## Which tasks deserve a graph

Scored against the lecture's five criteria, this harness gets 3/5 — and **the two it fails are the
two everyone reaches for first**:

| Criterion | Here | Note |
|---|---|---|
| Independently decomposable | **No** | WIP=1 is deliberate (Lesson 7); the serial reviewer is the bottleneck |
| Branches / rollbacks | **Yes** | four rollback layers, all real |
| Intermediate state worth saving | **Yes** | checkpointed per feature |
| Results explicitly verifiable | **Yes** | the entire premise |
| Coordination benefit > cost | **Marginal** | because the first is No |

So: **draw the graph for the branches, not for the parallelism.** Almost all the value here came
from making rollback destinations explicit; almost none from running things at once. The one place
parallelism paid was a node that writes nothing to shared state — and that is not a coincidence.
The moment a fan-out node writes to shared state, you owe a merge rule for concurrent writes, which
is why `--promote` stayed sequential and should.

**Does not deserve a graph:** a linear pipeline, however many steps. A task with one path through
it. Anything where "what should I do next" has one answer.

**Does:** any workflow where a failure has more than one legitimate destination. That is the real
test — not node count, not scale. If every failure goes back to the same place, a loop is honest
about your system. If failures should go back to *different* places depending on what failed, the
loop is hiding a decision, and it is hiding it inside a context window where nobody can audit it.

## What I am not claiming

- **No framework changed hands.** No LangGraph, no engine. iii.dev's counterargument holds: shape
  is not the load-bearing wall — replay, observability, recoverability are, and those already
  existed (`trace/`, `verify-report.json`, evidence replay, per-feature checkpoints). Adopting an
  engine would have renamed them.
- **The orchestration tax went up, not down.** Two more nodes today, and a `route.mjs` that can now
  dispatch eight of them without me. More agent output arriving per hour, one serial reviewer. The
  approval node is a partial answer precisely because it is *selective* — a gate that always fires
  manufactures a rubber stamp, which is worse than no gate because it photographs as review.
- **`route.mjs` cannot route what nobody marked.** A maker that silently absorbs a design question
  instead of writing `NEEDS DESIGN:` is invisible to it. The marker discipline is still a
  prompt-level instruction, and prompts are the layer that degrades. The router made the *modeled*
  edges executable; it did not make the modeling automatic.
- **Both approval passes used a stubbed `kiro-cli`.** Routing, gating, promotion and state
  transitions are real; the agent sessions did no work.

## Recommended merge

`p08-explicit-graph` and `p08-human-in-the-loop` are load-bearing and should merge: the first is
documentation the next reader needs, the second closes a livelock that is live in every scaffolded
project today. `p08-parallel` is an opt-in tool, not a default — 54 seconds does not justify
doubling CPU on someone else's CI without them asking for it.

One thing this project earned and has not yet built: a gate for `unrouted-marker` — a marker
written to shared state that no node dispatches on. That is exactly the defect class exp 1 found by
hand, and the only reason it will not recur by hand is that nothing yet stops it.
