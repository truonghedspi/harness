# Approval request — 2026-08-28T14:53:08.774Z

**What happened.** The loop finished an iteration and is about to flip the features below to
`done` mechanically: their verification commands re-ran and exited 0.

**What changes if you approve.** 1 feature(s) become `done`: feat-005.
`done` is terminal — no later node re-examines it. The claim becomes the record.

**Why you and not a machine.** Every mechanical check already passed. What no check covers is
whether the behaviour claimed is the behaviour you wanted. Grade with
`docs/reference/step-acceptance.md` — at this gate the three that fail silently are D9 (a false
premise smoothed over), T2 (a tautological test) and T3 (an assertion widened to go green).
These items carry judgement still owed:

1. **[assumption] A-001** — assumption added (needs-human): The Archive endpoint never changes address in this deployment
   → If this is false, what breaks — and is it actually true?
2. **[contested] feat-012** — a checker rejected it at least once before it landed
   → The disagreement was resolved by an agent — do you agree with how?
3. **[contested] feat-002** — a checker rejected it at least once before it landed
   → The disagreement was resolved by an agent — do you agree with how?

**Cost of each answer.**
- `approved` — the features become `done`. If a claim was wrong, it is now the baseline that
  every later feature builds on, and nothing will look at it again.
- `rejected` — nothing is promoted; the features stay `readyForCheck` and the checker gets them
  next iteration with your reason attached. Cost: one iteration.

---

**Reply** by replacing this line in `loop/approval.md` with `approved` or `rejected`, then a
blank line, then your reason (the reason is not optional — a verdict with no reason cannot be
acted on by the node that receives it).

_No timeout set: this waits._
