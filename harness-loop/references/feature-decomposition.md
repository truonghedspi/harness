# Feature decomposition — turning a requirement into a `feature_list.json` an agent can finish

The single hardest judgment call in this whole skill isn't scaffolding files — it's cutting a
user's requirement into pieces small enough that bounded maker checkpoints can finish and verify one
piece without losing track of the system, but large enough that the pieces still add up to the
actual requirement instead of a pile of trivia. Get this wrong and you get one of two failure
modes, both real and both observed while building this skill's aeron-demo trial run:

- **Too big** — a "feature" that's really the whole system in one entry. The maker either stalls
  (can't hold the whole thing in context, `attempts` exhausts against `maxAttempts` on a problem
  that was never one problem) or fakes progress (implements a fraction, marks `readyForCheck`
  anyway because the container-sized entry technically "has some evidence").
- **Too small / wrong axis** — features so granular or so mis-cut that finishing all of them
  still doesn't add up to a working system, because the DEPENDENCIES between them were never
  actually captured, or two features silently needed to touch the same file (WIP=1 violation
  waiting to happen).

This is the algorithm `prompts/feature-planner.md` (the `feature-planner` agent) implements.

## Step 1 — Extract the decomposition axes from the requirement itself

Before inventing structure, look for structure the requirement already has:

- **Named components / responsibilities.** A requirement that describes a system usually already
  names its parts (aeron-demo's `requirement.md` §7–§10.5 named exactly 5: Bootstrap Manager, Day
  Index, Retention Job, Downstream-live, Downstream-via-Archive). Each named part with its own
  responsibility is a **build feature** — one entry, one class/module, one owner file set.
- **Explicit scenarios / acceptance cases.** A requirement with a test-case table, a list of
  "when X happens, Y must hold" statements, or numbered examples (aeron-demo's `requirement.md`
  §14 had exactly 9) is handing you **prove features** for free — one entry per scenario, mapped
  1:1, each with its own verification command. If the requirement doesn't have this table
  explicit, you build it yourself in this step (see Step 4) rather than skip straight to code.
- **Invariants / constraints.** Cross-cutting rules ("the Cluster must never call an Archive
  write API") aren't features on their own — they become entries in `docs/constraints.md` and,
  wherever mechanically possible, a grep-able check `verify-harness.mjs` or `init.sh` can run.
  Don't turn a constraint into a feature; that's how you get a feature nobody can "finish."

**The two-axis result:** one set of features that BUILD the system (vertical slices of real code)
and one set that PROVE it does what the requirement said (one verification per named scenario).
aeron-demo ended up with 5 build features + 9 prove features + 2 foundation features (baseline,
shared test rig) = 16 total. That ratio — roughly one proof per named scenario, one build per
named component — is a reasonable default shape, not a hard rule.

## Step 2 — When the requirement has no explicit scenario table

Most real requirements are messier than aeron-demo's. Two reliable ways to manufacture the prove
axis when it isn't handed to you:

1. **Boundary-crossing decomposition (Lesson 10's own logic, applied one level down).** For any
   flow that crosses an internal boundary (function → module → service), the smallest scenario
   that would be false without the feature and true with it is the verification. "User signs up,
   gets a welcome email" isn't one feature — it's at minimum: validate input (unit), persist user
   (in-service integration), send email (in-service integration, or a fake mail transport), and
   ONE end-to-end feature proving the whole chain actually fires together. That last one is the
   prove feature; the rest are build features with their own narrower verification.
2. **The falsifiability question.** For every capability the requirement describes, ask: "what's
   the smallest concrete input/output pair that would be FALSE if this capability were missing,
   and TRUE once it's built?" If you can't answer that in one sentence, the capability is still
   too vague to be a feature — go back to the requirement (or ask the user) before drafting it.

## Step 3 — Sizing: the "one sitting, one verifiable claim" rule

A feature is correctly sized when ALL of these hold. Treat this as the actual algorithm, applied
per feature, not a vibe check:

| Check | Pass | Fail → what to do |
|---|---|---|
| **Behavior sentence** | One sentence, one subject, no unrelated clauses joined by "and"/"then" | Split at the joining word into separate features with a dependency edge |
| **Verification** | Exactly one runnable command | If you need "and also check Y", that's a second feature or Y belongs in a higher-tier prove feature |
| **File footprint** | You can name the 1–3 files it creates/touches before writing any code | Can't name them → requirement is still too vague, go back to Step 1/2 |
| **Context footprint** | Implementing it requires deep understanding of ≤ 3–5 EXISTING files beyond its own new code | Needs more → either the feature is really "learn the system" bundled with "change the system" (split them), or the needed context belongs in `docs/architecture.md` so future iterations don't re-derive it |
| **Dependency count** | Depends on ≤ 3 other features, directly | More → likely secretly two features pretending to be one |

This is deliberately mechanical. `verify-harness.mjs` runs a cheap, imperfect proxy for the first
two rows automatically (`feature-scope-smell` — see below) precisely so this isn't just a human
judgment call that erodes under time pressure.

### The lower bound — every row above guards against too BIG

There was no rule against too small, and the loop's cost per feature is fixed, so a list cut too
fine spends most of its budget on overhead. Measured on aeron-demo: **each feature costs about two
LLM dispatches** (a maker, then a checker — each re-loading ~1000 lines of context) plus a ~20s
baseline gate. Sixty-one features is roughly 120 dispatches before anyone writes a line of the
sixty-second.

**The economics are a U-curve** (Reinertsen, *Principles of Product Development Flow*): total cost
is transaction cost plus holding cost. Small batches raise the first and lower the second; the
optimum is the minimum of the sum, not the smallest possible batch.

**So when small features hurt, cut the transaction cost before you merge anything** — merging also
destroys the fast feedback that small features bought. In this harness, in order of value:

- `verify-harness --promote` replaces the LLM checker with a mechanical evidence replay for
  features whose verification reproduces. `run-loop.sh` already runs it, which turns the common
  case from two dispatches into one.
- The checker is gated and batched: partial maker checkpoints keep `readyForCheck: false`; one
  checker dispatch runs only when complete feature-level claims exist and judges the whole batch.
- Per-dispatch context is a per-feature tax. `tools/context-budget.mjs` prices it.

**Then fix the shape, not the size.** The story-slicing test applies directly: *if slice one needs
slice two to function, it is a horizontal split in disguise* (SPIDR). Merge two features when the
first cannot be demonstrated without the second — that is one feature that was written as two.

| Too-small check | Fail → what to do |
|---|---|
| **Independently demonstrable** | If A can only be shown to work once B exists, A and B are one feature |
| **Distinct proof** | Two features sharing a `verification` command make the loop pay twice to run the same proof — merge them, or give the second a proof of its own (`verification-duplicated`) |
| **Worth a dispatch** | If implementing it is one edit an agent already holding its sibling's context would make anyway, it is a step, not a feature |

**The build/prove pair is the deliberate exception.** `build-unproven` requires every build feature
to have a prove feature depending on it, so each unit of behaviour becomes two features. That is a
chosen trade — it is what stops the maker writing the test it will be judged by — and it is usually
the largest single reason a list looks over-cut. Do not merge those. Reduce the count the legitimate
way instead: **one prove feature may cover several build features.** The gate requires each build to
have *a* prove depending on it, not its own private one, so group builds under a shared acceptance
scenario.

## Step 4 — Build the dependency DAG, don't just list features

`feature_list.json`'s `dependencies` array is what makes `maker-prompt.md`'s picking rule work
("first `not-started` feature whose dependencies are all `done`") — the planner's job is to
produce a valid DAG, not a flat list a human has to manually sequence later.

1. Foundation features first, no dependencies: baseline (`./init.sh` green), and — if the project
   needs shared test infrastructure multiple prove features will reuse (aeron-demo's `SitRig`) —
   a foundation feature for that, too. Building shared test scaffolding as its OWN feature (not
   inline in the first test that happens to need it) is what let 6 later features reuse it
   without re-deriving it.
2. Each build feature depends on whatever foundation/build feature it needs, never on a prove
   feature (prove features depend on build features, never the reverse).
3. Each prove feature depends on exactly the build feature(s) whose claim it's proving — usually
   one, sometimes two if the scenario spans components (aeron-demo's rotation scenario depended
   on both `PlannedRotation` and `DownstreamRecordingTracker`).
4. Check for cycles by hand once — the planner should refuse to emit a DAG with one.

## Step 5 — The Definition-of-Ready checklist (apply to every feature before writing it)

- [ ] `id` — short, stable, greppable (`feat-<name>`, not `feat-001` once you're past the
      foundation features — a name survives reordering, a number doesn't).
- [ ] `behavior` — one sentence, passes Step 3's row 1.
- [ ] `verification` — one real, copy-pasteable command. Never `REPLACE ME`, never "manually
      check X" — if it can't be a command yet, the feature isn't ready to write, go back a step.
- [ ] `dependencies` — only feature ids that already exist earlier in this same planning pass.
- [ ] `status: "not-started"`, `readyForCheck: false`, `evidence: ""`, `checkerNotes: ""`,
      `attempts: 0`, `maxAttempts` set (3 rejected review cycles is a reasonable default; raise it
      for a feature you already know is exploratory/uncertain, never leave it unset).

## Worked example (aeron-demo, real, checked into `feature_list.json`)

```
feat-001 (baseline)              — foundation, no deps
feat-sitrig (shared test rig)    — foundation, deps: [feat-001]
feat-bootstrap (build)           — deps: [feat-sitrig]
  feat-sit-1, feat-sit-2, feat-sit-3 (prove)  — deps: [feat-bootstrap], one per §14 scenario
feat-retention (build)           — deps: [feat-bootstrap]
  feat-sit-4 (prove)             — deps: [feat-retention]
feat-dayindex (build)            — deps: [feat-bootstrap]
  feat-sit-8 (prove)             — deps: [feat-dayindex]
feat-downstream (build)          — deps: [feat-bootstrap]
  feat-sit-5, feat-sit-6, feat-sit-7 (prove)   — deps: [feat-downstream]
feat-rotation (build)            — deps: [feat-downstream]
  feat-sit-9 (prove)             — deps: [feat-rotation]
```

Notice the shape: every build feature has 1–3 prove features hanging off it, never more; every
prove feature depends on exactly the build feature(s) it's proving; the foundation layer is built
once and never touched again. This is the target shape to aim for on a new project, not a
template to copy literally — the actual component/scenario names come from that project's own
requirement.

## What this doesn't solve

The planner produces a good STARTING decomposition. It does not replace the checker's judgment
(a feature can be correctly SIZED and still wrong in substance), and it does not replace
`docs/architecture.md`/`DECISIONS.md` for capturing the "why" behind a cut that isn't obvious from
the DAG alone. If a feature turns out to be wrong-sized once the maker actually starts it (Step 3
missed something), that's what `checkerNotes`/`status: blocked` plus a `DECISIONS.md` entry are
for — re-planning mid-flight is normal, not a sign the planner failed.
