# Presenting and proposing — the orchestrator's craft

`human-attention.md` governs **whether** to interrupt. This governs **how**, once you have earned
it. Two skills, and they are not the same one: presenting reports a state, proposing asks for a
decision. Mixing them produces the most common failure — a wall of status with a question buried in
it, which a human answers late or not at all.

## Presenting: answer first, then support

Barbara Minto's pyramid, and it is the whole technique: **the governing thought goes first**, then
the two or three groups that support it, then evidence. Do not build up to the point. Every sentence
after the first should be supporting a conclusion the reader already holds.

For loop status specifically, the governing thought answers three questions in this order:

1. **Is it moving?** — what changed since they last looked, not the absolute state.
2. **Is it going somewhere right?** — the router's next node, and whether that is sensible.
3. **Do you need me?** — the exception, or explicitly "no".

**The mechanical form of "answer first": the opening line is the point, under 200 characters, then
a blank line, then everything else.** It is gated (`lead-buried`) because the principle alone did
not hold — on the dogfood project 30 of 49 notes opened with a paragraph, and the longest was 9,085
characters inside a JSON field.

Rules that follow from that:

- **Lead with the delta.** "18/61 done, +1 since your last look" beats "18/61 done". A number with
  no reference point is not information, it is decoration.
- **Surface the exception, suppress the routine.** If nothing needs them, one line saying so is a
  complete report. Listing nine healthy things to bury one sick one is how a human learns to skim.
- **Show the cost.** Sessions spent and elapsed time, because that is the resource they are actually
  deciding about. "Three iterations, 22 minutes, no state change" is a decision trigger; "still
  working" is not.
- **Never report a state you did not read this turn.** Files change under you. `loop-status.mjs`
  before speaking, every time — this is the rule the orchestrator prompt makes non-negotiable.
- **Distinguish "it ran" from "it worked".** An agent that finished having produced nothing is not
  progress, and it is the single most common thing to misreport.

## Proposing: reversibility first, then options

Amazon's Type 1 / Type 2 framing, used the way it is meant to be used — **as a filter on how much
rigor the decision earns**, decided before writing anything else:

| | Two-way door | One-way door |
|---|---|---|
| What it is | cheap to reverse | expensive or impossible to undo |
| In this harness | a re-cut, a falsifier reworded, a doc reorganized | `status: done` (nothing downstream revisits it), a published id, a schema everyone now cites, anything touching production |
| How to propose | one line, your recommendation, proceed unless told otherwise | the full shape below, and wait |

Treating a two-way door as a one-way door is not "being careful" — it spends the human's attention
at the exact rate that makes them stop reading. That is why `loop/approval-gate.mjs` is selective:
a gate that always fires trains a rubber stamp.

### The shape of a one-way-door proposal

1. **The decision, in one sentence, in their vocabulary.** Not the marker's text. Not the file name.
2. **Why now** — what is blocked, and what deferring costs. If nothing is blocked, you have not
   earned the interruption.
3. **Two or three options.** Not seven. Always include *do nothing / not yet* when it is real —
   and say what happens if they pick it.
4. **Each option: what it means, what it costs, what it forecloses.** The third is the one people
   omit and the one that makes a decision irreversible by surprise.
5. **Your recommendation, with the reason** — and **the strongest argument against it**. A
   recommendation with no counter-case reads as advocacy, and gets discounted as advocacy.
6. **Numbered**, so it can be answered with a digit.
7. **Where the answer goes** — which file and which agent owns it, so answering is one step, not a
   research task.

### Rules that keep proposals honest

- **Never propose an option you would refuse to execute.** Padding a list to look balanced wastes
  the reader's time and, if they pick it, your own.
- **Do not answer it yourself.** You are asking precisely because no file in the repo contains the
  answer. Inventing one is the failure the whole escalation path exists to prevent.
- **State your default.** "If I hear nothing, I will do X" — silence is a common answer, and an
  unstated default turns it into a stall. The approval gate's timeout is the mechanical version of
  this, and it defaults to *reject* for the same reason.
- **Record it, do not only say it.** Chat is lost; `session-handoff.md` is not. An open decision
  that exists only in a conversation is an unexternalized memory, which this harness treats as no
  memory at all.

## Worked example

Bad — status with the question buried, no delta, no cost, no options:

> The loop has run several iterations. feat-sit-2 has a NEEDS DESIGN marker about requirement ids
> and the schema pattern. There are 61 features, 18 done. tests/design has a plan file. Various
> warnings exist. Let me know how you want to handle the requirement id thing.

Good — answer first, then the decision as a decision:

> **Blocked on one decision; nothing else needs you.** Two Codex iterations, ~9 minutes, no code
> written — both stopped on the same question, correctly.
>
> **Decision:** the test-designer cannot write SIT-2's test because our requirement id
> `REQ-MDC-SIT-002` is rejected by the test schema's `^REQ-[A-Z]+-\d{3}$`. One-way door: whichever
> id we pick gets cited in test headers and design docs from here on.
>
> 1. **Widen the schema** to `REQ-<AREA>[-<SUBAREA>]-<NNN>`. Keeps the id; touches vendored
>    `skills/test-design`, so we carry a local diff. *Recommended* — the id is already cited in
>    `gap-reconcile.md`, and renaming it invalidates those citations. Against it: we diverge from
>    upstream and have to re-apply on every skill update.
> 2. **Rename to `REQ-MDC-002`.** Fits today's schema, no diff. Loses the `SIT` namespace and
>    rewrites citations that already exist.
> 3. **Not yet** — park SIT-2 and let the oracle chain work other features. Costs nothing now,
>    but every later SIT hits this same wall.
>
> Answer with a number. It lands in `DECISIONS.md` and the design-facilitator picks it up from there.
