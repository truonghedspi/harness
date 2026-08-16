# P08 experiment 3 — rollback edges with layer attribution, and the approval node

## Part 1 — the rollback edge names a layer, not a distance

"Go back one step" is the wrong model. When the checker rejects, the defect could have originated
in the implementation, the cut, the design, or the spec — and returning to the wrong one wastes an
iteration and usually re-creates the same defect. So each marker in shared state carries the
**layer** it came from, and `loop/route.mjs` returns to that layer:

| Marker in shared state | Layer | Returns to | Written by |
|---|---|---|---|
| `docs/assumptions.md` row = `needs-human` | spec | human checkpoint; current agent uses `human-interview` | designer, design-reviewer, test-designer |
| `checkerNotes ^ NEEDS DESIGN:` | design | `designer` | maker, checker, test-designer |
| `checkerNotes ^ NEEDS RE-PLAN:` | decomposition | `feature-planner` | checker |
| no `falsifier` on an open feature | oracle | `test-designer` | — |
| verification touches a real cluster | implementation | `k8s-integration-tester` | — |
| otherwise eligible | implementation | `maker` | — |

**Precedence is deeper-first**, and that is a design decision, not an ordering accident: answering
a spec question can dissolve the design question hanging off it, so resolving them shallow-first
throws away the work. Walked down the ladder on a real target, one rung per resolution:

```
rung 1  →  human checkpoint     | layer: spec            (current agent keeps context)
rung 2  →  designer             | layer: design          | feat-a
rung 3  →  feature-planner      | layer: decomposition   | feat-b
rung 4  →  maker                | layer: implementation  | feat-a
```

### The livelock this removed, measured on the same target

```
feat-a  NEEDS DESIGN     status not-started
feat-b  NEEDS RE-PLAN    status not-started
→ all_settled(): open = 2, so the loop does NOT exit
→ maker-prompt step 3: skip both
→ old run-loop.sh: spawn maker → nothing changes → repeat, forever, one paid session per iteration
```

Neither feature is `done` (so the loop won't stop) nor `blocked` (so nothing escalates), and the
maker is instructed to skip exactly this state. With the router, the same input stops at a human
checkpoint on the first tick; the current conversational agent applies `human-interview` rather
than dispatching another agent.

`route.mjs` also distinguishes two states the old loop conflated: **exit 0** (everything done or
blocked-with-reason) versus **exit 3** (features open, but every rule declined — a human must
look). "Finished" and "stuck" needed opposite responses and previously produced the same log line.

## Part 2 — the approval node, and where it sits

It sits **before `--promote`**, not before commit. That is the edge where `done` becomes terminal:
no later node re-examines a `done` feature, so a wrong claim promoted there becomes the baseline
everything else is built on. `review-digest` had already measured this as the largest unreviewed
block in the repo — features whose command exited 0 and whose *claim* nobody judged.

Two design choices that matter more than the mechanism:

**Selective, not universal.** A gate that always fires produces a rubber stamp, which is worse than
no gate because it looks like review. It fires only when the batch carries judgement actually owed
— reusing `review-digest`'s weight≥4 ranking rather than inventing a second opinion of what
matters, plus one condition review-digest doesn't model: a feature about to be promoted after more
than one attempt.

**Timeout auto-rejects, never auto-approves.** An unanswered request means nobody looked, and the
honest reading of "nobody looked" is "not approved". Auto-reject costs one iteration. Auto-approve
costs a wrong `done` that nothing revisits. `--on-timeout escalate` writes to `session-handoff.md`
instead of silently deferring.

**A verdict with no reason is treated as a rejection.** The reason is what the next node acts on;
a bare "approved" is a signature, not a judgement.

### The interrupt format — four questions in the order a person needs them

1. **What happened** — the loop is about to flip these features to `done`, their commands exited 0.
2. **What changes if you approve** — the exact feature ids, and that `done` is terminal.
3. **Why you and not a machine** — every mechanical check already passed; here is the judgement
   still owed, one line each, with the specific question to answer.
4. **Cost of each answer** — approve: this becomes the baseline nothing re-examines. Reject: one
   iteration, features stay `readyForCheck`, your reason travels with them.

## Two full passes, both through `run-loop.sh`

### Pass 1 — REJECTED

Gate fired on `feat-a` (`attempts: 2`, `readyForCheck: true`). Evidence read:

> *"ran exit 0 — first attempt FAILED (assertion on identity), passed after widening the assertion"*

Verdict **rejected**: *"That is the maker fixing the test instead of the code — the identity
question feat-a raised as NEEDS DESIGN was never actually answered, it was assertion-ed away."*

Result: `--promote` skipped, `feat-a` stayed `in-progress` / `readyForCheck: true`, the checker
still received it. Cost of the rejection: one iteration.

### Pass 2 — APPROVED

Same feature, evidence corrected to a real red run and a code-side fix citing decision X-001.

Verdict **approved**: *"Evidence now shows a real red run for the right reason (identity differed
across replay) and the fix was in the code, not the assertion."*

Result: promote ran. It then **declined to promote anyway** — 2 unrelated blockers in the report,
and `--promote` never promotes out of an untrustworthy run. Two independent gates, both had to
agree, and they were checking different things. That is the layering working as intended.

### Timeout

`--timeout-min 0.05 --on-timeout escalate` → auto-escalated, nothing promoted, entry appended to
`session-handoff.md` and to `loop/approval-log.jsonl`. The rule fires.

## Did the human catch what the verify node missed?

**Yes, and it is the whole point.** In pass 1 every mechanical check passed: the command exited 0,
the evidence field was populated, no gate objected. The defect was one clause inside the evidence
text — *"passed after widening the assertion"* — which is `R-T3`, the tautology, in plain sight.

No gate in this harness reads that clause and understands what it means. `evidence-no-red` would
have been *satisfied* by it, since it does contain a failure. A machine can check that a red run
was recorded; only a person can read *what was changed to turn it green* and judge whether that was
the right change.

## Against the exercise's metrics

| Metric | Result |
|---|---|
| Can the rollback edge pinpoint the problem layer? | Yes — 4 layers, verified one rung at a time. |
| When approval rejects, can you name the layer? | Yes — the rejection reason named `design` (an unanswered NEEDS DESIGN), so the next route is to the designer, not back to the maker. |
| Approval wait time vs. value of problems caught | 1 of 2 passes caught a real tautology that every mechanical gate passed. The wait is ~10s of reading, on a batch that only forms when judgement is owed. |
| Are approval requests written clearly? | Format above; the human question is one line per item, not a diff. |
| Do the timeout/escalation rules fire? | Yes — auto-escalate on timeout, `session-handoff.md` + JSONL log. |

## Honest limits

- **The gate's trigger reuses `review-digest`'s heuristic.** If that ranking is wrong, the gate is
  silent at exactly the wrong moment. It is a heuristic about where judgement is owed, not a proof.
- **Selectivity is a real trade.** A wrong claim in a batch that trips no heuristic is promoted
  with no human ever seeing it. That is the deliberate price of not manufacturing a rubber stamp.
- **`route.mjs` cannot route what nobody marked.** A maker that absorbs a design question silently
  instead of writing `NEEDS DESIGN:` is invisible to the router — the marker discipline is still a
  prompt-level instruction, and prompts are the layer that degrades.
- **Both passes used a stubbed `kiro-cli`.** The routing, gate, promote and state transitions are
  real; the agent sessions themselves did no work.
