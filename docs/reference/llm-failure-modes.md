# LLM failure modes — what the harness counters, and what it still doesn't

A harness is a set of countermeasures. This file names the failure mode each mechanism exists to
counter, so nobody removes a mechanism without knowing what it was holding back — and so the gaps
stay visible instead of being rediscovered the expensive way.

Ordered by how much damage the mode does *in this harness specifically*, not by how famous it is.

## Countered, with the mechanism that does it

| Failure mode | What it looks like | Counter |
|---|---|---|
| **Confabulation** | fluent, plausible, false — and indistinguishable from a fact once written | claims table with `path:line` citations, spikes, evidence replay (`design-engineering.md`) |
| **Declaring victory early** | "done" on work that was never verified | generator/evaluator split; only the checker flips `done`; `--promote` re-runs the command |
| **Calibration failure** | cannot tell what it doesn't know | assumption registry with `verified`/`assumed`/`needs-human`; externalised verification |
| **Anchoring on the first idea** | commits to attempt #1 and rationalises | ≥2 options with the rejected ones recorded |
| **Silent summarisation loss** | context compaction drops detail without error | external state: `progress.md`, `feature_list.json`, memory files |
| **Scope creep / interference** | "while I'm here, also refactor B" | WIP = 1 |
| **Cross-session amnesia** | re-learns the same lesson forever | per-agent memory with an always-loaded index |

## Countered only partly — the honest list

### 1. Lost in the middle (position bias)
Recall of a long context is **U-shaped**: content at the beginning and end is retrieved far more
reliably than content in the middle. A rule buried mid-document is *loaded* but not reliably *used*.

- Countered by: the 300-line document budget (`knowledge-layout.md`) — a smaller document has less
  middle to lose.
- **Not countered:** *ordering*. Measured on this project's own maker agent: 1507 lines of resources
  load before it reads a line of code, and `feature_list.json` alone was 667 of them — sitting in
  the middle of the list and pushing the actual rules into the worst position.
- Fix now in place: agent `resources` are ordered **rules first, memory and goal last, bulk
  structured data in between**. Prose an agent must absorb goes at the edges; JSON it will grep
  goes in the middle, where position bias costs least.
- Convention for documents: state the load-bearing rule in the **first** paragraph and restate it in
  the **last**. Never leave the single most important sentence in the middle.

### 2. Instruction-load degradation
Per-instruction compliance falls as the number of simultaneous instructions rises. Fifty rules do
not produce fifty-rule behaviour; they produce roughly the top-N-by-salience.

- **This harness caused its own version of it.** A single session grew `docs/constraints.md` to 46
  rules, each individually justified, with nobody checking the total.
- Fix: `verify-harness` gate `rules` warns past a budget, and the remedy is deliberately not "write
  better rules" — it is **promote or cut**:
  - a rule that matters becomes a **gate** (mechanical, unforgettable), and then the prompt no
    longer needs to carry it;
  - a rule that does not matter enough to gate should be **deleted**.
  A prompt is not a storage medium for good intentions.

### 3. Negation weakness
"Do X" is followed more reliably than "don't do Y". Prohibitions are the weakest instruction shape,
and this harness is heavy on them — 14 `MUST NOT` rules on the project measured.

- Fix: every prohibition that actually matters gets a **mechanical gate**, and the rule text names
  it. A `MUST NOT` with no enforcement is advisory, and should be honest about that rather than
  wearing the same MUST-NOT uniform as an enforced one.
- `verify-harness`'s `rules` gate reports how many prohibitions are prompt-only, so the ratio is
  visible.

### 4. Sycophancy
Models agree under pressure — especially with a confident human. The maker/checker split counters
the *maker's* self-agreement, but nothing stopped a **checker** from folding when a human pushed
back on a verdict.

- Fix: a verdict may change only on **new evidence** — a command output, a citation, a spike — never
  on restatement, insistence, or authority. Written into the checker and design-reviewer prompts.

### 5. Self-preference between same-model agents
An LLM rates its own output higher, and two instances of the same model share blind spots. Our
generator/evaluator separation is real for *mechanical* claims (the checker re-runs the command —
an anchor outside both models), but **design review has no such anchor**: designer and
design-reviewer are the same model reasoning about the same thing.

- Partly countered: the reviewer must attempt a falsification and state it before any verdict.
- **Still open, honestly:** the load-bearing defence for design is not the reviewer, it is the
  mechanical gates plus the human on `needs-human` rows. Do not count the reviewer as insurance
  against a judgement error the designer would also make.

### 6. Goal drift within a long session
Later instructions dominate earlier ones; the original objective fades as a session grows.

- Countered by: `loop/goal.md` auto-loaded, WIP = 1, the `attempts`/`maxAttempts` timebox.
- **Not countered:** nothing measures session length and acts on it. `run-report` shows session
  minutes and tool-use counts after the fact; no agent is told "you have been at this too long,
  write the handoff". The closest thing is the attempts budget, which counts *retries*, not *time*.

## Not countered at all — accepted risks

- **Stated reasoning ≠ action.** A model can describe a plan and then do something else. The
  harness verifies *outcomes* (evidence replay, gates), never the reasoning that produced them.
  This is deliberate: outcome verification is checkable, reasoning verification is not.
- **Pattern continuation.** A wrong format earlier in the context tends to be copied forward.
- **Degradation near the context limit.** Quality falls before the window is technically full;
  nothing here detects it.

## Measuring it — `tools/context-budget.mjs`

None of the above is actionable without numbers, and nobody was producing any. The tool reports,
per agent: total lines auto-loaded before it does anything, the heaviest contributors, how many
rules it must actually remember, and whether the position-sensitive slots are used (rules and the
role's own contract at the **start**, goal and memory at the **end**, skimmable data in between).

Measured on the dogfood project, then fixed:

| | before | after |
|---|---|---|
| agents over a 1200-line budget | 5 of 8 | 1 of 8 |
| maker | 1509 | 898 |
| k8s-integration-tester | 1650 | 1037 |
| rules that must be remembered | 32 of 32 | 24 of 32 (8 promoted to gates) |

The single biggest win was not a rule at all: `feature_list.json` had grown to 667 lines and was
auto-loaded by five agents, dominating the middle of every one of their contexts. No agent needs
every field of every feature up front — it needs to know what exists, then open the one entry it is
working on. `tools/feature-digest.mjs` generates a ~50-line index that goes in `resources`, with
the full file left as the source of truth, read on demand.

`feature-planner` stays over budget at 1407, and that is recorded rather than gamed: its job is to
rewrite `feature_list.json`, so it is the one agent that genuinely needs the whole thing.

## The rule this file implies

When adding a mechanism to this harness, name the failure mode it counters. If you cannot name one,
the mechanism is decoration — and decoration is not free, because it spends the instruction budget
that the load-bearing rules need.
