# Design engineering — automating design without inheriting the agent's blind spots

The loop had a hole: `feature-decomposition.md` Step 1 assumes *"a requirement usually already
names its parts"*, and `maker-prompt.md` step 8 sends any unanswered architecture question straight
to `blocked`. Neither role **produces** design. In practice a human did it in chat — so it was
never reproducible, never checked, and lost between sessions.

The obvious fix (an agent that designs) runs into the real objection: **design quality is bounded by
what the agent knows, and an agent confidently designing on a wrong premise poisons every feature
downstream — silently, because the checker verifies implementation against the spec, never the spec
against reality.** A wrong design ends with every feature green and the system wrong.

This document is how to automate design anyway: **automate exactly as far as the inputs and outputs
can be mechanically checked, and stop only where knowledge genuinely cannot exist in the repo.**

## Where agent design knowledge fails, and what to do about each

| Failure source | Fixable? | Mechanism |
|---|---|---|
| Wrong about a library/API (hallucinated, misremembered) | **Yes, mechanically** | Every factual claim cites `file:line` in a real checkout, or a **spike** that runs and proves it |
| Doesn't know a deployment/business fact | **Never** | Must be declared an assumption tagged `needs-human` — the only thing a human is asked |
| Weighing trade-offs by business context | Partly | Options + explicit trade-off axes; the human assigns weight, the agent doesn't pretend to |
| Unknown unknowns | Partly | **Adversarial `design-reviewer`**: "which assumption, if false, flips this conclusion?" |

That last row is not hypothetical. A feature in this skill's own dogfood project sat `blocked` for a
week as "no API path exists — needs a human decision among three lossy options". The API finding was
correct; it rested on an unstated assumption about whether the recorded stream was *originating* or
*derived* data. When the user stated the actual data flow, the block evaporated and the feature
became ordinary work. **The cost of an unexamined design assumption is measured in weeks.**

## The four artifacts a design must produce

### 1. Claims table — no uncited facts
Every factual claim about how a library, framework, or external system behaves carries a citation:

```markdown
| Claim | Evidence |
|---|---|
| `AeronArchive.replicate()` exists, 3 overloads | `aeron-archive/.../AeronArchive.java:1805,1865,2051` |
| `extendRecording` needs an exact position match | spike: `spikes/ExtendPositionSpike.java` — fails at P0±1 |
```

A citation is one of: a path+line in a checkout present on this machine; a runnable spike; or a
quoted section of the project's own requirement. **"I recall that…" is not a citation** — an
uncited claim is a defect the reviewer must flag.

### 2. Assumption registry — `docs/assumptions.md`
One row per load-bearing assumption. This is the highest-value artifact in the whole scheme,
because it is what converts "the agent doesn't know" from an invisible risk into a checkable one.

```markdown
| id | Assumption | Status | If false | Depends on it |
|---|---|---|---|---|
| A-001 | The Archive endpoint never changes address | needs-human | case 7's premise returns | feat-sit-7 |
| A-002 | The recorded stream is derived from the raft log | verified (user, 2026-08-07) | gaps become unrecoverable | gap-reconcile design, feat-sit-2 |
```

Status is one of:
- **`verified`** — with *how* (a citation, a spike, or a dated human statement)
- **`assumed`** — plausible, unverified; **blast radius must be stated** ("If false")
- **`needs-human`** — cannot be known from the repo; **this is the only thing that stops the loop**

### 3. Options and rejected alternatives
At least two real options with the axis each wins on. The rejected ones go into `DECISIONS.md` —
a design with exactly one option was not a design, it was a first idea.

### 4. Blast radius
Which components/features inherit this decision. Feeds the mechanical coverage check below, and
tells a future reader what breaks if the decision is revisited.

## Spikes — converting belief into proof

When a claim can't be cited from source, the designer writes a **throwaway** spike that proves it:
a test, a script, a one-file program. Rules: it lives under `spikes/`, it is never imported by
production code, it must actually run, and its result goes in the claims table.

Real example from this skill's dogfood: a feature was blocked for a week on "the environment is
broken (JDK/arch incompatibility)". Running the upstream project's *own* equivalent test on the same
machine took two minutes and it passed — killing the theory and converting a human-blocked item back
into ordinary engineering. **A two-minute spike beat a week of confident reasoning.**

### Ungrillable questions — the preference half of the same move

A spike settles a **fact** ("does this API behave that way?"). Some questions are not facts and no
interview settles them either: *how should this feel*, *is this latency acceptable*, *one long form
or three pages*. Talking through one of these is where a design session balloons — the agent keeps
rephrasing, the human keeps guessing, and scope grows to fill the uncertainty.

Same move, different target: **build the throwaway, look at it, then answer in one line.** A spike
settles a fact; a prototype settles a preference. Both beat another round of questions, and both
live under `spikes/` under the same rules. (The distinction comes from the `grilling` skill by Matt
Pocock — github.com/mattpocock/skills.)

## Generator / evaluator separation, applied to design

The same rule that keeps the maker from grading itself applies here — a designer is its own
design's best defense attorney:

- **`designer`** explores, produces the four artifacts, records assumptions honestly. It may not
  mark its own assumptions `verified` on its own say-so.
- **`design-reviewer`** tries to **falsify**: hunts uncited claims, load-bearing assumptions that
  were never written down, a suspiciously narrow option space, and above all asks of every
  conclusion: *which assumption, if false, flips this?* If the answer is an assumption not in the
  registry, the design is rejected.

## Cross-cutting decisions are not assumptions — they need their own register

An assumption is "I believe X but haven't checked": if wrong, a conclusion **flips**, and verifying
it is the cure. A cross-cutting decision (retry policy, message identity, timeout budget, failure
reporting) is different: nobody is wrong yet, but **if no one owns it, it gets decided by accident**
by whichever feature touches it first, and the next forty features inherit that accident.

`docs/cross-cutting.md` holds one row per concern, and a row is **closed only when it names the
chosen mechanism, the owner and date, and the rule that enforces it**. A stub row is tracked, not
closed — otherwise writing "not yet decided" would be a way to silence the audit, which is the
verification-debt failure this skill exists to prevent (found by dogfooding, immediately).

`node scripts/cross-cutting-audit.mjs --target DIR` looks for two signals across the project's own
domain artifacts (never the harness's own plumbing — that produced pure false positives when tried):

- **`unowned`** — a concern is all over the repo with no MUST rule and no register row: nobody has
  noticed it is a decision.
- **`open-decision`** — registered but incomplete: known, tracked, waiting on a human. A better
  state, still open.
- **`fragmented`** — two or more different mechanism terms for one concern are each in active use.
  A policy that was never chosen, only drifted into.

This is the division of labour that actually works for cross-cutting concerns: **the agent is very
good at noticing that a decision is being made by accident** (breadth — it reads every file and
never tires), and **very bad at making it** (the trade-off lives in business context that is not in
the repo). Measured on a real project, the audit found a mechanism conflict — three identity keys in
use with nothing stating how they relate — inside a design document written two hours earlier *by
the agent itself*, which every other gate had passed.

## Where the human is actually needed

Not "approve every design" — that is the interruption pattern that makes people turn automation
off. Only this:

**The loop stops exactly on `needs-human` assumptions.** These are mechanically detectable, few, and
high-value: they are the facts about deployment, business intent, and risk appetite that do not
exist in the repo and never will. Everything else — exploring options, citing sources, running
spikes, recording decisions — proceeds without asking.

## Mechanical gates (`verify-harness.mjs`, gate `design`, severity `warn`)

- **`design-claim-uncited:<file>`** — a design doc contains a claims table row with an empty or
  `TODO`/`recall` evidence cell.
- **`design-assumption-unverified:<feature>`** — a feature is `blocked` (or its `checkerNotes` cite
  a design conclusion) while resting on an assumption whose status is not `verified`. This is the
  feat-sit-2 failure mode, made mechanical.
- **`design-component-uncovered:<name>`** — a component named in `docs/architecture.md` has no
  feature in `feature_list.json` covering it. The same total-mapping idea the TimesTen migration
  harness in this repo uses to make "100% coverage" enforceable rather than aspirational.

None are blockers: design hygiene is a heuristic, and a false positive must never stop a loop. They
are signals a reviewer or a human reads.

## Routing

Reuses the mechanism already built for re-planning:

```
requirement → designer → design-reviewer → [human: needs-human assumptions only]
                 ↑                                    ↓
                 └── NEEDS DESIGN: ──┐        feature-planner → maker → checker
                                     └──────────────────────────────────────┘
```

A maker or checker that hits a design-level question writes `NEEDS DESIGN:` as the first token of
`checkerNotes` instead of quietly setting `blocked`. The maker is forbidden from touching such a
feature — exactly as with `NEEDS RE-PLAN:` — and the designer picks it up on its next pass.

## What this does not solve

It does not make an agent's judgment equal to an expert's. It makes the agent's **reasoning
auditable**: every fact traceable to a source, every assumption visible with its blast radius, every
rejected option recorded. An expert reviewing that artifact spends their attention on the two or
three load-bearing assumptions instead of re-deriving the whole design — which is the actual goal.
