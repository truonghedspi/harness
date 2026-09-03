# What "good" means at each step — the human's rubric

The machine checks whether a thing *exists* and whether a command *exits 0*. It cannot judge
whether a design is sound or a test is worth having. That judgement is the human's, and this file
is what makes it a **rubric rather than a mood**: the same questions asked every time, in the same
order, so a design that passes on Tuesday would pass on Friday.

Use it when standing at an approval gate (`loop/approval-gate.mjs`), when reviewing what
`review-digest.mjs` ranked, or when acting as the human stand-in for a headless run.

Score each criterion **pass / weak / fail**. One `fail` is a rejection. Three `weak` is a rejection
too — a design nothing is clearly wrong with, and nothing is clearly right with, is not yet a
design.

---

## Design

**The question the whole rubric serves:** could a competent stranger build this, and would they
build the same thing you meant?

| # | Criterion | Fail looks like |
|---|---|---|
| D1 | **Claims are cited.** Every fact about a library, framework or this codebase carries a `path:line` that exists, or a spike that ran and whose output is quoted. | "Aeron generally…", "typically this returns…", a citation to a file that doesn't contain the claim |
| D2 | **Assumptions are registered, with blast radius.** Each load-bearing assumption is a row: status, *what breaks if false*, who depends on it. `needs-human` rows carry a recommended answer. | An assumption in prose but not in the registry. A `verified` with nothing behind it but confidence |
| D3 | **Observable seam per component.** For each component: what boundary a test attaches to, and what is visible across it *without reading the implementation*. | "test the reconciler" with no named boundary; a seam that requires an internal field |
| D4 | **Invariants, universal.** What must hold for *every* input — conservation, idempotency, ordering, round-trip. Not examples in disguise. | "returns 100 for this input" filed as an invariant |
| D5 | **Two real options per significant decision**, with the axis each wins on, and the rejected one recorded. | One option. Or two options that are the same idea with different names |
| D6 | **The design makes the wrong thing hard.** Invariants live in boundaries and types, not in a rule someone must remember. Ask: *what is the most likely mistake a competent implementer makes here, and what stops it?* | Correctness that depends on every caller remembering to do X. "Just don't call it twice" |
| D7 | **Dependency direction is stated and acyclic.** Each component has one responsibility. Nothing both decides and executes the thing it decided. | A component that reads config, chooses a policy, and applies it. Two components that import each other |
| D8 | **Non-goals and casualties are explicit.** What this does *not* do, and which existing features it changes or invalidates. | Silence about the ten features already in `feature_list.json` covering the same ground |
| D9 | **Premises that may be false are surfaced, not smoothed over.** If the requirement rests on something the design suspects is untrue, it says so and stops. | A design that quietly works around a broken premise and never names it |

**Transparency (D2 + D6 + D9) is where most designs actually fail.** They are readable and
still opaque: you cannot tell which sentence would collapse the rest. A design is transparent when
a reader can point at one assumption and say what dies with it.

---

## Decomposition

| # | Criterion | Fail looks like |
|---|---|---|
| P1 | One sentence per feature, one verifiable claim. No "and" joining unrelated clauses | A feature whose behaviour needs a paragraph |
| P2 | Every feature names 1–3 files it will touch | "somewhere in the tracer" |
| P3 | A real runnable verification command, not a placeholder | `npm test` for a feature that no test covers |
| P4 | **A `falsifier` derived from the design's invariants**, not invented | "the code is wrong" as a falsifier |
| P5 | Every build feature has a prove feature judging it | Code whose only judge is the test shipped with it |
| P6 | The DAG has no cycle, and dependencies exist in the same pass | A dependency on an id nobody wrote |

---

## Tests — what makes one effective

**A test is effective when it fails on a wrong implementation you can name.** Everything below is
that sentence taken apart. Coverage, test count and green CI are not on this list, deliberately.

| # | Criterion | Fail looks like |
|---|---|---|
| T1 | **Names its falsifier.** You can say which wrong implementation this catches | "tests the happy path" |
| T2 | **Independent oracle.** The expected value comes from the spec, a worked example, a known-good literal, or a property — *not* computed the way the code computes it (`R-T3`) | `assertEquals(sut.calc(x), reference.calc(x))` where reference is the same algorithm |
| T3 | **Was seen red, for the right reason.** An assertion failure, not a compile error or a missing fixture | Evidence that only ever shows green |
| T4 | **Traceable.** Names the requirement or condition it implements (`R-T6`) | A test file whose reason to exist is lost |
| T5 | **Shape matches the logic.** Property tests where an invariant exists; examples where a fixed rule exists. Not example-by-habit | Twelve example tests where one invariant property would cover the space |
| T6 | **Kills mutants at the core.** Change one constant or flip one comparison — the suite goes red | A suite that stays green when the code is broken on purpose |
| T7 | **Deterministic and bounded.** No `sleep`, no wall clock, no ordering luck; an explicit timeout | A flaky test kept because it passes on retry |
| T8 | **Does not test the framework.** Asserts *this system's* behaviour, not that the library or the cluster works | "the pod is Running" as a Level 3 assertion |

**The two failure modes to watch hardest**, because both look like diligence:
- *Tautology* (T2) — the test restates the implementation, so it can never fail. Green forever.
- *Assertion widening* (T3, T6) — a real failure turned green by loosening the check. The evidence
  even says so, in words like "passed after adjusting the assertion", and no gate reads that.

---

## Implementation

| # | Criterion | Fail looks like |
|---|---|---|
| I1 | The behaviour claimed is the behaviour built — read the claim, then the diff | A command that passes while the claim is not met |
| I2 | No scope bleed: files outside the feature untouched | "while I was there I also refactored…" |
| I3 | The change is where the design said it goes | A new component that appears in no design |
| I4 | Evidence reproduces on a fresh run, by someone else | Evidence that only works in the author's shell |

---

## How to use this without spending an afternoon

Do **not** apply all of it to everything. `review-digest.mjs` ranks what carries judgement still
owed; apply the rubric there and nowhere else. In practice:

- an approval gate → D9, T2, T3 (the three that fail silently)
- a design review → all of D
- a promoted feature you're spot-checking → I1 and T1

And record the verdict with its reason. A rubric applied and not written down was a feeling with
extra steps.
