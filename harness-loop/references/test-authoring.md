# Test authoring — breaking the circularity that makes verification theatre

The harness verifies outcomes: the command ran, the evidence replayed, the gate passed. All of that
is only as good as the test underneath — and there is a structural problem with the test:

> **The same agent writes the code and the test.** Both can be wrong in the same direction, and
> everything still passes. A green suite then proves the agent was self-consistent, not that the
> behaviour is right.

Matt Pocock's `tdd` skill names the resulting defect the **tautological test**: *"the expected value
is computed the way the code computes it, so the test passes by construction."* This project's own
`test-design` skill names it `R-T3` and adds the deeper one, `R-T9`: *a test must not look at the
implementation to choose its cases.*

## The fix is structural, not advisory

Telling an agent "don't write tautological tests" fails for the same reason every prohibition fails
(`llm-failure-modes.md`). What works is **information asymmetry** — making the tautology impossible
to write because the author never saw the implementation:

| Role | May read | May **not** read |
|---|---|---|
| **test-designer** | spec, interface/API signature, schema | implementation body; existing tests for the component being designed |
| **test-implementer** | test conditions, interface, references, mutant report | implementation body (except the exact line a kill-mutant task names) |
| **reviewer** | everything | — |

If a role receives implementation content it is not entitled to, it stops and reports rather than
using it. That is the whole trick: an oracle written by someone who cannot see the code is an
independent oracle.

## Where this sits in the loop

```
requirement → designer → feature-planner ──┬─→ test-designer  → test-implementer ─┐
                                           │   (spec→conditions) (conditions→tests)│
                                           └─→ maker (implementation) ─────────────┴─→ checker
```

The **prove features** the feature-planner already produces are the natural unit: each maps to a
requirement scenario, and its test should be authored from that scenario — not from the code that
the **build feature** produced. The maker implements; it does not author the acceptance test for a
scenario it is implementing.

## The four techniques, and where each already lives

| Technique | Where it is defined | What it buys |
|---|---|---|
| **Red–green evidence** | this harness (`maker-prompt`, gate `evidence-no-red`) | proves the test *can* fail; a test that was never seen red is not known to test anything |
| **Property / metamorphic tests** | `templates/test-design/references/property-catalog.md` — five kinds: `invariant`, `round_trip`, `model_based`, `metamorphic`, `algebraic` | the oracle is a *relation*, not a value the agent invented, so it cannot be fudged without visibly deleting the property |
| **Mutation testing** | `test-design` SKILL.md, "kill surviving mutant" protocol | measures whether the suite would *notice* a wrong choice. Its protocol also closes the obvious cheat: a mutant must be killed by asserting behaviour **from the spec**, never by asserting the code's current output (`R-T3`) |
| **Test before code** | the asymmetry above, plus `tdd`'s vertical slice | the acceptance oracle exists before the implementation it judges |

`test-design`'s strategy matrix goes further than "write property tests": it classifies each
behaviour by **logic shape** (`mapping`, `stateful`, `computational`, `decision`, `parsing`,
`concurrent`, `integration`, `fixed_rule`) and prescribes the technique per shape — property and
example tests as peers, chosen by shape rather than by habit.

## The mechanical half this harness adds

The skill is a discipline; these are the checks that keep it honest:

- **`test-untraceable:<file>`** (gate `features`, warn) — a test file with no header block naming
  the `condition_id`/`requirement_id` it implements. That block is `R-T6`'s traceability link, and
  its absence is the cheapest signal that a test was written from the code rather than the spec.
- **`evidence-no-red:<id>`** (gate `features`, warn) — a feature whose evidence never records the
  test failing first. Cheap, and it catches the most common shortcut.

Neither can catch a well-disguised tautology; that is what the reviewer's `R-T3`/`R-T9` pass is
for. Machines catch the lazy version, judgement catches the clever one — the same division as
everywhere else in this harness.

## Honest limits, from the sources themselves

- **Agents write the implementation first anyway, sometimes.** `tdd`'s own docs record a model
  admitting *"I knew the skill said red first. I just defaulted to my normal habit."* The loop is
  worth running even when imperfectly followed; watch the run when a slice really matters.
- **No technique here rescues a wrong `behavior` sentence.** If the requirement itself was
  misunderstood, the property holds in the wrong sense and the mutant dies in the wrong sense. That
  defence is the design/interview step, not the test step.
- **Not every change deserves the loop.** `tdd` flags this as an open gap: run it on config, glue,
  or straight delegation — anything with no independent source of truth to assert against — and you
  get a test that restates the implementation, arriving at the tautology from the other direction.
