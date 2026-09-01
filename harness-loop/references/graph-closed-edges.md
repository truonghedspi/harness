# The twelve closed edges — how each marker got a destination

Extracted from [graph.md](graph.md), which is the map. This file is the **history**: what each
missing edge was, what closed it, when, and the incident that found it. Read it when you are about
to add a marker — the point is that a new marker names a destination on the day it is written, not
after a loop burns sessions on it.

## The seven implicit edges — and the five found after them

Writing the table above forced each marker to name a *destination*. Seven of them had none: they
were written to state, reported by tools, and dispatched by nobody. They worked only because a
human read a report and typed the next command.

| # | Edge | Written by | Read by | Dispatched by | Consequence |
|---|---|---|---|---|---|
| 1 | `NEEDS DESIGN:` → `designer` | maker, checker, test-designer | designer | ~~nothing~~ **`route.mjs`** | *closed* |
| 2 | `NEEDS RE-PLAN:` → `feature-planner` | checker | feature-planner | ~~nothing~~ **`route.mjs`** | *closed* |
| 3 | `needs-human` assumption → human checkpoint | designer, design-reviewer | current agent using `human-interview` | ~~dedicated context-switching agent~~ **`route.mjs` stops without dispatch** | *closed; migrated 2026-08-16* |
| 4 | k8s feature → `k8s-integration-tester` | maker (skips it) | — | ~~nothing~~ **`route.mjs`** | *closed* |
| 5 | conditions → `test-implementer` | test-designer | test-implementer | ~~nothing~~ **`route.mjs`** | *closed 2026-08-10* — with it open, the maker wrote the test it was to be judged by |
| 6 | `design-reviewer` REJECT → `designer` | design-reviewer | designer | ~~nothing~~ **typed `loop/design-review.json` + `route.mjs`** | *closed 2026-08-15* — verdict is bound to a design digest; one unchanged revision escalates — **superseded 2026-08-18, see row 11: bounded a digest that stayed identical after rejection, not one that changed a little every round** |
| 7 | baseline red → `maker` repair | `init.sh` | maker step 2 | ~~contradicted~~ **typed `loop/baseline-state.json` + `route.mjs`** | *closed 2026-08-15* — the dispatcher records the gate outcome instead of exiting before routing |
| 8 | chart present → `k8s-integration-tester` **exists** | the repo itself | setup | ~~nothing — a manual copy~~ **`setup-harness-loop.mjs --k8s auto`** | *closed 2026-08-13* — the node was reachable by the router and installable only by hand, so on every project that never ran that copy, rule 4 routed to an agent that did not exist |
| 9 | conditions **absent** → `test-designer` | — | test-implementer | ~~nothing — the rule keyed on the falsifier only~~ **`route.mjs`** | *closed 2026-08-13* — test-designer has two outputs (`falsifier` and `tests/design/**`) and only the first was routed on. Where the feature-planner derives falsifiers from the invariant contract, the designer rule never fires, `tests/design/` is never created, and the implementer is dispatched to implement conditions that do not exist. Measured on aeron-demo: two paid Codex sessions on `feat-sit-2`, zero output |
| 10 | `NEEDS DESIGN:` **answered** → `feature-planner` (clear the marker) | designer | — | ~~nothing — the marker rule kept matching~~ **`route.mjs`** | *closed 2026-08-13* — the marker lives in `feature_list.json`, which the designer may not write, so the node that answers the question cannot clear the flag that asked it. Observed live: the designer settled `feat-sit-2` in `DECISIONS.md`, and the router named the designer again, indefinitely. The fix needs three states, not two — unanswered → designer, answered → planner, both-turns-spent → **human**. First attempt keyed the middle state on "a design document mentions this feature, and when" — a proxy that cannot tell WHICH question was answered, so when the test-designer raised a *new* question on the same feature the router escalated a live question to a human. It now keys on dispatch history (`loop/route-log.jsonl`) and identifies a marker by a hash of its own text, so a new question is a new ladder |
| 11 | rejected design digest changes → retry counter resets, reject loop never bounded or escalated | `design-reviewer` (retired) | `designer` (retired) | ~~`loop/design-review.json` revision counter, reset by any digest change however small~~ **`design-facilitator` (merged role, one session) + human-authored `loop/design-approval.json`, matched on exact digest — no retry counter, because there is no auto-loop between agents to bound** | *closed 2026-08-18* — row 6's fix bounded a design that stayed byte-identical after rejection, not one that changed a little every round, which is what a real reject-and-redesign cycle actually looks like: each small revision was a new digest, so the "one unchanged revision escalates" rule never fired and the two agents could cycle indefinitely, each round a paid session. Neither `designer` nor `design-reviewer` had the business context to know when a design was actually *done* — only a human does, so the loop was replaced rather than re-bounded: one facilitator session produces the options, the critique, and the concerns; only a human can write `status: approved`, and every downstream layer is blocked until it matches the current digest exactly |
| 12 | a `prove` feature's own oracle is wrong → `test-implementer` | checker (had no marker for it) | — | ~~nothing — the rule keys on empty `evidence`~~ **`NEEDS ORACLE FIX:` + `route.mjs`** | *closed 2026-08-27* — the test-implementer rule tells "not written yet" from "written" by whether `evidence` is empty. A project that authors oracles BEFORE the implementation records a red run the moment it writes one, so from that instant the feature only matches the maker rule — and the maker prompt forbids touching an oracle-layer test, while the checker may not write test files at all. No node in the graph could fix that file. Observed on examples/jdt-mcp-server, where the workaround was a hand-written bounded edit permission in `checkerNotes`, re-invented per occurrence: a convention where a state was needed. The marker outranks the maker's eligibility filter, so a correct implementation cannot be "fixed" to satisfy a broken assertion |

**Status, 2026-08-27.** All twelve named edges are closed by executable state and routing; row 11
supersedes row 6, which bounded the wrong axis of the same loop. Design state is a typed,
digest-bound human artifact rather than an inter-agent verdict. Gate `agent-unrouted` fails any
agent that neither the router nor `route.mjs` names, while `demo.sh` exercises the return edges and
their bounded escalation so a documented edge cannot silently regress into prose.

### Edges 1–3 compose into a livelock, reproduced

`all_settled()` exits the loop only when every feature is `done`/`passing`, or `blocked` *with* a
recorded reason. A feature marked `NEEDS DESIGN:` is none of those — it is still `not-started`. And
`maker-prompt.md` step 3 instructs the maker to **skip** exactly those features.

```
features: feat-a NEEDS DESIGN, feat-b NEEDS RE-PLAN   → open: 2 → all_settled = 1 (not settled)
  → run-loop spawns maker → maker skips both → no state change
  → next iteration: identical → …
```

So the loop burns a paid LLM session per iteration, forever, producing nothing — and every iteration
looks healthy in the log. The edges were *documented in prose* and *reported by tooling*, and neither
is the same as being modeled.
Note what did **not** find this. Nine mechanical gates and every demo assertion pass on this repo:
each inspects the *content of a file*, none inspects *which node runs next*. The graph is a different
axis of verification, not a stricter version of the same one.
