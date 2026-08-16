# The 13-Lesson Coverage Contract

This is the authoritative spec that `scripts/check-coverage.mjs` implements. Each lesson has:
**intent** (the failure it prevents), **artifact(s)** the setup script scaffolds, and the
**machine check** — the precise, mechanical thing the checker inspects. A lesson is *covered*
only when its check passes against the target project. "All 13 covered" = every check passes.

The checker is deliberately structural: it proves the harness/loop is *present and coherent*.
It does not replace running the loop on real tasks. A green coverage report on a red `./init.sh`
means nothing — always run the baseline gate too.

---

## Lesson 1 — Capable models still fail (harness-induced failure)

- **Intent:** Failures are usually the harness's fault, not the model's. Give every task a
  concrete Definition of Done and a diagnostic loop (execute → attribute failure to a layer →
  fix the harness layer → re-run).
- **Artifacts:** `docs/definition-of-done.md`; a `## Definition of Done` section in `AGENTS.md`.
- **Check:** `docs/definition-of-done.md` exists AND `AGENTS.md` contains a Definition-of-Done
  section (heading matching `definition of done`).

## Lesson 2 — The five subsystems must all exist

- **Intent:** A harness is not one prompt file. All five subsystems must be present:
  Instructions, Tools, Environment, State, Feedback.
- **Artifacts:** `AGENTS.md` (instructions), a detected environment manifest
  (`package.json`/`pyproject.toml`/`go.mod`/`Cargo.toml`/`pom.xml`/`build.gradle*`/`*.csproj`),
  `progress.md` (state), `init.sh` + verification commands (feedback). Tools access is asserted
  in `AGENTS.md`.
- **Check:** all five markers present — `AGENTS.md`, an env manifest, `progress.md`, `init.sh`,
  and at least one verification command documented in `AGENTS.md` or `init.sh`.

## Lesson 3 — Repository is the single source of truth (Fresh Session Test)

- **Intent:** Knowledge not in the repo is invisible to the agent. A fresh session given only
  the repo must answer: What is it? / How is it organized? / How do I run it? / How do I verify
  it? / Where are we now?
- **Artifacts:** `docs/architecture.md` structured around those five questions.
- **Check:** `docs/architecture.md` exists AND addresses the five Fresh-Session-Test questions
  (headings/keywords: what / organiz / run / verif / where or "current state").

## Lesson 4 — One giant instruction file fails (router + progressive disclosure)

- **Intent:** A 600-line `AGENTS.md` buries signal. Keep the entry file a router (≤~200 lines):
  overview, quick-start, ≤15 hard constraints, links to topic docs revealed on demand.
- **Artifacts:** short `AGENTS.md`; `docs/*.md` topic files.
- **Check:** `AGENTS.md` line count ≤ 200 AND it links to at least two files under `docs/`.

## Lesson 5 — Long-running tasks lose continuity (external state)

- **Intent:** Context windows are finite; treat the agent as memory-wiped each session.
  Persist state and the *why* of decisions; define clock-in/clock-out routines.
- **Artifacts:** `progress.md` (current state / done / in-progress / next), `DECISIONS.md`
  (decision + reason + rejected alternative + date), clock-in/out steps.
- **Check:** `progress.md` AND `DECISIONS.md` exist AND `AGENTS.md` describes clock-in/out
  (keywords: "startup workflow"/"start of session" and "end of session").

## Lesson 6 — Initialization needs its own phase

- **Intent:** Separate a dedicated init phase (no business code) from implementation. Its output
  is a runnable env, a working test example, a Startup Readiness Checklist, and a task breakdown.
- **Artifacts:** executable `init.sh`; `## Startup Readiness` section in `AGENTS.md`.
- **Check:** `init.sh` exists and is executable (mode has +x) AND `AGENTS.md` has a Startup
  Readiness section.

## Lesson 7 — Agents overreach and under-finish (WIP=1)

- **Intent:** Finite attention; finish + verify one task before starting another. No "also
  refactor B." Completion needs executable evidence.
- **Artifacts:** a Work Rules section in `AGENTS.md` stating WIP=1 / one active feature; `state`
  field per feature.
- **Check:** `AGENTS.md` contains a WIP=1 / "one feature at a time" / "one active" rule.

## Lesson 8 — Feature lists are harness primitives (triple + 4-state)

- **Intent:** The agent must know what "done" means. A machine-readable feature list is the
  single source of truth serving scheduler / verifier / handoff reporter / progress tracker.
  Every entry carries the triple: behavior + verification command + state, plus evidence.
- **Artifacts:** `feature_list.json`.
- **Check:** `feature_list.json` parses AND every feature has a non-empty `verification`
  (or `verify`) command AND a `status`/`state` in
  `{not_started, not-started, active, in-progress, blocked, passing, done}`.

## Lesson 9 — Agents declare victory too early (externalized termination)

- **Intent:** Models are overconfident; self-evaluation skews positive. Termination is decided by
  the harness/checker, not the worker's feelings. Separate worker from checker.
- **Artifacts:** `loop/checker-prompt.md`; `evidence` field per feature; the rule that only the
  checker (or a script) flips a feature to `passing`/`done`.
- **Check:** `loop/checker-prompt.md` exists AND every feature in `feature_list.json` has an
  `evidence` field (may be empty string, but the key must exist).

## Lesson 10 — Only a full pipeline run counts (cross-service integration gates)

- **Intent:** Unit tests are blind to boundary defects. Verification is a hierarchy: Level 1 unit
  / Level 2 in-service integration / Level 3 **microservice integration (cross-service /
  contract)**, with the top level required for any change that crosses a service boundary. The
  classic false green in a microservice system is "each service's own tests pass but they don't
  agree on the wire."
- **Artifacts:** `docs/testing-standards.md` describing the three levels; `init.sh` that runs the
  real pipeline (build/typecheck/test), not just the fastest test.
- **Check:** `docs/testing-standards.md` exists AND references three levels — unit + integration +
  microservice integration (matched by `micro-service` / `cross-service` / `service-to-service` /
  `contract`, or `e2e`/`end-to-end` as a fallback) — AND `init.sh` invokes a build/test/check step.

## Lesson 11 — Observability belongs inside the harness

- **Intent:** Without observability, agents decide blind and handoffs lose 30–50% of session
  time. The harness auto-collects logs/traces/decision artifacts — don't rely on the agent's own
  prints.
- **Artifacts:** `tools/trace.mjs` (append-only task trace to `trace/trace.jsonl`); agent `hooks`
  that emit trace events on spawn/tool-use/stop.
- **Check:** `tools/trace.mjs` exists AND at least one `.kiro/agents/*.json` references
  `trace.mjs` in its hooks.

## Lesson 12 — Every session must leave a clean state

- **Intent:** Entropy grows by default. Clean state = 5 conditions at exit (build passes, tests
  pass, progress/feature list updated, no stale artifacts, standard startup path works).
- **Artifacts:** a Session-Exit / End-of-Session checklist in `AGENTS.md`; `session-handoff.md`.
- **Check:** `AGENTS.md` has an "End of Session" / "Clean state" checklist AND
  `session-handoff.md` exists.

## Lesson 13 — From manual prompting to autonomous loops

- **Intent:** Move the human outside the loop. The simplest loop = goal + verification method +
  stopping condition, judged by an independent evaluator. Six primitives: Automations, Worktrees,
  Skills, Connectors, Sub-agents (maker/checker), External State.
- **Artifacts:** `loop/goal.md` (objective + iteration contract + gates + explicit stop
  conditions + human checkpoints), `loop/maker-prompt.md`, `loop/checker-prompt.md`,
  `loop/run-loop.mjs`, and `.kiro/agents/{maker,checker}.json`.
- **Check:** all of `loop/goal.md`, `loop/maker-prompt.md`, `loop/checker-prompt.md`,
  `loop/run-loop.mjs`, `.kiro/agents/maker.json`, `.kiro/agents/checker.json` exist AND
  `loop/goal.md` contains a "stop condition" section.

---

## Scoring

`check-coverage.mjs` prints one line per lesson: `PASS` / `FAIL` with the reason, then a summary
`N/13 covered`. Exit code is non-zero unless all 13 pass, so the check can gate a loop or CI.
Treat the lowest-covered lessons as the bottleneck and fix those first. Structural coverage is
necessary but not sufficient — a green report on a red `./init.sh` proves only that the files are
in place, not that the project works.
