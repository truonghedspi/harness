# Human attention — the one resource the harness must not waste

Everything else in this harness is renewable. Compute is cheap, agent sessions are cheap, a spike
costs two minutes. **The human's judgement about value and context is the only scarce input**, and
it is the only thing an agent categorically cannot produce.

So the rule:

> **An agent may spend human attention only on what the environment cannot answer.**
> Anything discoverable — by reading, grepping, running, or building a throwaway — the agent finds
> itself. What survives that is irreducible, and irreducible questions deserve *all* of the human's
> attention because nothing else is competing for it.

Measured on this skill's own dogfood project: of three features escalated as "needs a human
decision" and left blocked for a week, **one was reducible** — the theory was "the environment is
broken", and running the upstream project's own equivalent test on the same machine took two
minutes and disproved it. A 33% waste rate on the most expensive resource in the system.

## The exhaustion ladder — climb all five before asking

In order. Each rung is cheaper than a human's attention by orders of magnitude.

1. **Registry** — is it already decided? `DECISIONS.md`, `docs/cross-cutting.md`,
   `docs/assumptions.md`. Asking again for something already settled is the most insulting kind of
   waste: the human already paid for that answer.
2. **Memory** — has an agent learned this before?
   `node tools/memory-query.mjs --target . --grep <keyword>`. Cross-session amnesia is not the
   human's problem to solve.
3. **Environment** — grep the repo, read the file, run the command, check the dependency's actual
   source in a checkout on this machine. "I recall that…" is not knowledge.
4. **Spike** — a fact you cannot read, you can often *prove*. Write a throwaway under `spikes/`,
   run it, cite the result (`docs/reference/design-engineering.md`). Two minutes here has already
   beaten a week of confident reasoning once in this project's real history.
5. **Prototype** — if the question is a *preference* rather than a fact ("how should this feel",
   "is this latency acceptable"), no amount of asking settles it either. Build the throwaway, look
   at it, then ask a one-line question instead of an open one.

Only what survives all five rungs may cost a human anything.

## What is genuinely irreducible — ask these without hesitation

The ladder exists to protect these, not to suppress them. An agent that under-asks is more
dangerous than one that over-asks (see the asymmetry below), and all of the following are
legitimate on sight:

- **Business or domain intent.** "What *should* count as terminal failure for us?" No amount of
  reading the code answers what the business wants.
- **Deployment and operational facts not in the repo.** "Does the Archive endpoint ever change
  address?" — a fact about the world the repo does not contain.
- **Risk appetite and trade-off weighting.** Two options both work; which cost matters more here is
  a value judgement. Present the frontier, never pick the point on it.
- **Irreversible or production-touching actions.** Approval, always.
- **Anything cheap to ask and expensive to get wrong.** When the asymmetry runs that way, ask.

## The asymmetry — this matters more than the ladder

**Over-asking costs annoyance. Under-asking costs a wrong system that looks right.**

A guessed answer is indistinguishable from a verified one the moment it is written down, and every
feature built on it inherits the error while passing every test. An agent that avoids asking in
order to seem self-sufficient has optimised the wrong variable.

So: climb the ladder honestly, then **ask**. If you are unsure whether a question is reducible,
spend two minutes on rung 3 and 4 — and if it survives, ask it. Never resolve the uncertainty by
guessing, and never park it as `blocked` to avoid the conversation. **Blocking is not a substitute
for asking**; a blocked feature nobody is asked about is just a question with the human removed
from it.

## How to ask, once you have earned it

Follow the interview technique in `prompts/context-interviewer.md` — rounds over a frontier, each
question numbered with a recommended answer, so the human's job is to *evaluate* rather than to
*generate*. That format is itself an attention-saving device: judging a proposal takes seconds,
producing one from a blank page takes minutes.

And **persist the answer**. An answer that stays in chat will be asked again next session, which is
the same waste with extra steps.

## Mechanical support, and its limits

`verify-harness.mjs` reports `escalation-without-evidence:<id>` (gate `features`, warn) when a
feature is `blocked`, or an assumption is `needs-human`, and its recorded justification shows **no
trace of exploration at all** — no command, no `path:line`, no spike, no exit code. That catches
the laziest escalations, which are the common ones.

It cannot catch the interesting case. The feature that cost a week *did* carry evidence — a real
reproduction with vanilla upstream code — it just never ran the one experiment that would have
settled it. **No mechanical check knows which experiment you did not think of.** That gap is what
the checker and the design-reviewer are for, and why both are instructed to ask of any escalation:
*what would have settled this without a human, and was it tried?*

`tools/run-report.mjs` prints the standing human-attention ledger — every open `needs-human`
assumption, undecided cross-cutting row, and blocked feature — so the cost stays visible instead of
accumulating quietly.
