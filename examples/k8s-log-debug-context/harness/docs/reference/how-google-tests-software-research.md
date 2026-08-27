# *How Google Tests Software*: concepts applicable to this harness

Research date: 2026-08-16. Scope: extract mechanisms, not copy Google's organization. The book is
a 2012 snapshot; later first-party Google material is used to separate durable principles from
roles and tactics that subsequently changed.

## Source boundary

The primary book-era evidence is Pearson's official sample of Whittaker, Arbon, and Carollo's
[*How Google Tests Software*](https://ptgmedia.pearsoncmg.com/images/9780321803023/samplepages/0321803027.pdf)
and the authors' contemporary Google Testing Blog series:
[Part 1](https://testing.googleblog.com/2011/01/how-google-tests-software.html),
[Part 2](https://testing.googleblog.com/2011/02/how-google-tests-software-part-two.html), and
[Part 5](https://testing.googleblog.com/2011/03/how-google-tests-software-part-five.html).
The later comparison is Google's 2020 *Software Engineering at Google* chapters on
[testing](https://abseil.io/resources/swe-book/html/ch11.html),
[larger tests](https://abseil.io/resources/swe-book/html/ch14.html), and
[continuous integration](https://abseil.io/resources/swe-book/html/ch23.html), plus the official
account of the [SET to SETI evolution](https://testing.googleblog.com/2016/03/from-qa-to-engineering-productivity.html).

## What is durable, and what is historical

| Concept | Book-era formulation | Later Google evidence | Decision for the harness |
|---|---|---|---|
| Quality ownership | SWEs own the quality of what they change; SETs make code and testing easier; TEs represent the user and analyze risk ([Part 2](https://testing.googleblog.com/2011/02/how-google-tests-software-part-two.html)). | The SET role expanded beyond test tooling and became Software Engineer, Tools & Infrastructure in 2016; teams still own testing, while TEs bridge engineering output and user satisfaction ([role evolution](https://testing.googleblog.com/2016/03/from-qa-to-engineering-productivity.html), [modern TE examples](https://testing.googleblog.com/2016/09/test-engineers-at-google.html)). | Preserve the responsibilities, not the job titles. A maker cannot outsource quality; a harness/tooling owner improves testability; an independent user/risk role judges journeys. |
| Test size | Small, medium, and large describe execution constraints and answer progressively wider questions ([Part 5](https://testing.googleblog.com/2011/03/how-google-tests-software-part-five.html), [2010 size table](https://testing.googleblog.com/2010/12/test-sizes.html)). | Google now explicitly separates **size** (resources/constraints) from **scope** (code verified), and encodes some size constraints in infrastructure. It favors the smallest useful test and a rough 80/15/5 scope pyramid, not a universal quota ([testing overview](https://abseil.io/resources/swe-book/html/ch11.html)). | Model both axes. The harness's current “Level 1–4” is scope/fidelity; it does not mechanically state runtime resources, isolation, or scheduling class. |
| Risk-driven test planning | Components, Capabilities, and quality Attributes (ACC) replace a long-lived prose test plan; stakeholder risk scores prioritize scarce testing ([Test Analytics](https://testing.googleblog.com/2011/10/google-test-analytics-now-in-open.html), [risk analysis](https://testing.googleblog.com/2010/09/ingredients-list-for-testing-part-three.html)). | Modern guidance still says coverage need depends on business criticality, change frequency, expected lifetime, complexity, and domain—not one global target ([coverage practices](https://testing.googleblog.com/2020/08/code-coverage-best-practices.html)). | Turn integration-init answers and design artifacts into a living risk model. Do not add a static “test plan” document or a single coverage threshold. |
| Testability is a product feature | SETs review design for risk/testability and build fakes, frameworks, and automation so developers can test efficiently ([Part 2](https://testing.googleblog.com/2011/02/how-google-tests-software-part-two.html)). | Google later reframed this as engineering productivity: fast feedback, easy local running/debugging, observable seams, and low friction ([hackability](https://testing.googleblog.com/2016/08/hackable-projects.html)). | Keep observable seams/invariants in design, but additionally measure whether the promised seam is executable cheaply and deterministically. |
| Automation needs trusted signal | The book-era system distributes testing instead of relying on a separate QA phase. | Modern Google guidance emphasizes immediate repair of broken tests, hermeticity, isolation, explicit ownership, and active flake control; large tests are slower, collision-prone, and harder to own ([testing overview](https://abseil.io/resources/swe-book/html/ch11.html), [larger tests](https://abseil.io/resources/swe-book/html/ch14.html)). | A passing command is insufficient evidence if the test is flaky, retried without disclosure, collision-prone, ownerless, or run in the wrong stage. |

## Mapping to the current harness

The harness already implements part of this model:

- `maker` owns implementation quality; `test-designer`/`test-implementer` provide an independent
  oracle; `checker` evaluates it. This resembles the responsibility split but improves it with
  enforced information asymmetry.
- Design-facilitator output already names components, public seams, invariants, and a feature-impact table.
  Feature planning already emits build/prove pairs and falsifiers. These are strong inputs to ACC,
  but **Capabilities and Attributes are not yet typed or checked as a total mapping**.
- `docs/testing-standards.md` and business journeys express scope/fidelity. They do not express
  Google's orthogonal execution-size constraints or say when each class runs.
- The integration initializer now collects business and environment decisions. It does not yet ask
  stakeholder-specific consequence/likelihood/detectability questions, bind risks to tests, or
  recompute residual risk from changes, failures, and evidence.
- Timeouts and per-run journey isolation exist. HI-030 (paired runs colliding on a fixed port) is
  direct evidence that isolation is not yet an enforced property of every resource-owning test.

## Recommended changes, ordered by leverage

### 1. Add a typed, living Capability–Attribute risk register

Generate `docs/test-risk.json` during design/integration init. Each row should contain
`capabilityId`, `componentIds`, `attribute` (for example correctness, availability, latency,
security, recoverability), `consequence`, `likelihood`, `detectability`, `stakeholders`,
`riskReason`, `requiredScope`, and `oracleIds`. Human questions should present collected evidence
and ask the relevant stakeholder only for unknowable business judgements. Risk scores prioritize;
they must never manufacture false precision.

Mechanical proof:

- every business capability maps to at least one component and attribute;
- every high-risk row maps to a prove feature and executable oracle;
- every prove feature traces back to a risk row;
- stale component/capability digests invalidate the assessment;
- a fixture with a high-risk unmatched capability makes `demo.sh` fail.

This is the largest gain because it connects the harness's collection, questions, design,
decomposition, oracle creation, and human attention into one durable decision surface.

### 2. Split test **scope** from execution **size**, and schedule by both

Add typed verification metadata rather than parsing commands:

```json
{"scope":"unit|component|contract|journey","size":"small|medium|large",
 "hermetic":true,"network":"none|localhost|cluster","maxSeconds":30,
 "isolation":"process|namespace|shared","stage":"local|presubmit|postsubmit|staging"}
```

Mechanical proof:

- small forbids network, sleeps, multiple processes, and shared isolation;
- medium permits localhost but not an external/shared cluster;
- large requires an owner, bounded timeout, isolation strategy, cleanup evidence, and later-stage
  schedule;
- a cross-service feature still requires contract/journey scope even if its test happens to run
  quickly;
- demo fixtures mislabel a cluster test as small and omit isolation from a large test.

This also closes the conceptual hole behind HI-030: parallel execution becomes conditional on a
declared, checked isolation mode rather than assumed safety.

### 3. Make testability a design acceptance gate, not only a named seam

For every changed component, require an executable `testabilityProbe` proving its public seam can
be started, controlled, observed, and reset within a stated size class. The design reviewer rejects
an internal-field oracle, wall-clock-only convergence, or a dependency that cannot be substituted
at the chosen scope.

Mechanical proof:

- digest-bound probe command exits green and emits a typed receipt;
- probe receipt names control, observation, and reset boundaries;
- verification rejects a seam mentioned only in prose or a stale receipt;
- demo includes a component whose “seam” requires database inspection and must fail.

### 4. Add signal-health and ownership to every non-small test

Record per test/oracle `owner`, recent outcomes, duration, retry count, distinct failure
fingerprints, quarantine state/reason/expiry, and cleanup result. Classify “passed after retry” as
flaky evidence, not green evidence. Route a newly flaky test to its owner; an expired quarantine or
unowned large test blocks promotion.

Mechanical proof:

- identical input/environment run repeatedly during calibration; mixed outcomes create a flake
  finding;
- retry-masked passes cannot promote a feature;
- quarantine is typed, time-bounded, owner-bound, and visible as reduced coverage of its risk row;
- a demo fixture exits pass/fail alternately and proves the gate catches it.

### 5. Select verification from change impact plus residual risk

Use the existing feature-impact table, service dependency graph, risk rows, and test traceability to
emit a deterministic test selection plan: fast affected small tests locally/presubmit; impacted
contracts next; high-risk journeys postsubmit/staging. The full suite remains a scheduled backstop.
CI should provide timely proof appropriate to the stage, a principle Google describes explicitly
in its [CI chapter](https://abseil.io/resources/swe-book/html/ch23.html).

Mechanical proof:

- every changed component has a dependency-closed selected test set;
- every impacted high-risk capability retains at least one non-quarantined oracle;
- selector output records why each test was selected or safely omitted;
- fixtures include a downstream journey that must be selected after an upstream contract change.

## What not to copy

- Do not create agents literally named SWE/SET/TE. Google's own roles evolved; executable
  responsibility and permissions are the useful part.
- Do not enforce 80/15/5 as a gate. Google calls it a rough mix that varies by team.
- Do not use coverage percentage as quality or a universal target. Google calls coverage lossy and
  recommends risk context and mutation testing.
- Do not replace independent acceptance oracles with developer-owned unit tests. Small tests and
  user journeys mitigate different risks.
- Do not automate stakeholder risk answers. Collection can provide evidence and defaults, but
  consequence and risk appetite remain human decisions with provenance.

## Suggested first vertical slice

Implement changes 1 and 2 together for integration-project init: a schema/checker for the risk
register plus typed scope/size metadata on the seeded registry and business journey. Add one high-
risk-uncovered fixture and one mislabeled/unsafe large-test fixture to `demo.sh`. This slice is
small enough to evaluate yet connects human collection to mechanically different verification;
without the risk register, size labels are taxonomy, and without size constraints, the risk plan
still schedules unreliable evidence.

## Implemented calibration (2026-08-16)

The first slice was calibrated against three shapes rather than promoted from one synthetic pass:

- A fresh integration scaffold carrying the new capability pack produced **0 harness-layer
  quality-strategy findings**; the structural pack-presence gate is silent when machinery exists.
- The real Aeron-derived order-match business-journey artifact from the earlier capability
  experiment had **3 findings**: no risk artifact, no capability, and no verification metadata.
  This is the intended pre-adoption gap, not a claim that its public oracle is wrong.
- A newly initialized integration target with human risk input produced **1 capability, 1 risk,
  1 journey/large verification, 0 findings**. Negative fixtures independently produced
  `high-risk-uncovered`, `small-unsafe`, and `cluster-not-large`.

The gate therefore distinguishes absent adoption, a valid portfolio, uncovered material risk, and
unsafe size classification. It does not enforce a test-count ratio or coverage percentage.
