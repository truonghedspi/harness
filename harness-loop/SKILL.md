---
name: harness-loop
description: >-
  Set up a complete agent harness AND an autonomous maker–checker loop on top of any project,
  targeting kiro-cli, Claude Code and Codex CLI from one agent manifest. Scaffolds AGENTS.md, feature_list.json, a cross-platform init gate, progress.md,
  DECISIONS.md, session-handoff.md, docs/ topic files, tools/trace.mjs observability, and a
  loop/ (goal + maker/checker prompts + run-loop.sh) plus .kiro/ custom agents. Every artifact
  maps to one of the 13 Learn-Harness-Engineering lessons, and a bundled coverage checker proves
  all 13 are present and their gates pass. Use whenever a coding agent needs to run reliably
  across sessions and then run autonomously (unattended) — forgets context, drifts scope, claims
  "done" too early, or you want to move from prompting the agent to designing a loop that prompts it.
license: MIT
---

# Harness Loop

Turn any repository into a project an agent can (1) work in reliably across sessions, and (2)
run **autonomously** in a maker–checker loop — with a machine-checkable guarantee that all 13
Learn-Harness-Engineering lessons are covered.

Two floors, built in order:

- **Floor 1 — Harness (Lessons 1–12):** make a *single* agent run reliable. Instructions, state,
  verification, scope, lifecycle, observability, clean-state.
- **Floor 2 — Loop (Lesson 13):** make *continuous* runs autonomous. A goal + verification +
  stopping condition, a maker/checker split (generator/evaluator separation), and an automation
  that fires it. The loop stands on the harness — never build Floor 2 without Floor 1 green.

Not for: model selection, prompt tuning in isolation, chat-UI design, or general app
architecture. Keep project-specific facts in the target repo, not in this skill.

## The 13-lesson coverage contract

This is the spine of the skill. Every lesson maps to a concrete artifact and a machine check.
The bundled `check-coverage.mjs` verifies each row — that is how "all 13 lessons are covered"
becomes a fact you can prove, not a claim.

| # | Lesson (why X fails) | Artifact scaffolded | Machine check |
|---|---|---|---|
| 1 | Capable models still fail (harness-induced) → Definition of Done + diagnostic loop | `docs/definition-of-done.md`, DoD section in `AGENTS.md` | DoD doc present; AGENTS.md links it |
| 2 | Five subsystems must all exist | `AGENTS.md`+env manifest+`progress.md`+`init.sh` (instructions/tools/env/state/feedback) | all five markers detected |
| 3 | Repo = single source of truth → Fresh Session Test | `docs/architecture.md` answering the 5 questions | doc answers What/How-organized/Run/Verify/Where-now |
| 4 | One giant instruction file fails → router + topic docs | short `AGENTS.md` (≤200 lines) linking `docs/*.md` | AGENTS.md within budget AND links topic docs |
| 5 | Long tasks lose continuity → external state | `progress.md` + `DECISIONS.md` + clock-in/out in `init.sh`/`AGENTS.md` | both files present; AGENTS.md has clock-in/out |
| 6 | Init needs its own phase → readiness checklist | Startup Readiness section in `AGENTS.md`; runnable `init.mjs` (+ `init.sh`/`init.cmd` wrappers) | a runnable entry point for this platform; readiness section present |
| 7 | Overreach/under-finish → WIP=1 + executable completion evidence | Work Rules (WIP=1) in `AGENTS.md`; `state` per feature | WIP=1 rule present |
| 8 | Feature lists are harness primitives → triple + 4-state | `feature_list.json` (behavior+verification+state+evidence) | every feature has verification + valid state |
| 9 | Declaring victory too early → externalized termination | `loop/checker-prompt.md`; only checker/script flips `passing`/`done` | checker artifact present; features carry `evidence` |
| 10 | Only full-pipeline runs count → cross-service integration gates | `docs/testing-standards.md` (3 levels, top = microservice integration/contract); `init.sh` runs build+test | testing doc has 3 levels incl. microservice integration; init runs pipeline |
| 11 | Observability belongs in the harness | `tools/trace.mjs` + `trace/`; agent `hooks` emit trace | trace.mjs present; agents reference it |
| 12 | Every session must leave clean state → exit checklist | Session-exit 5-condition checklist in `AGENTS.md`; `session-handoff.md` | exit checklist present; handoff file present |
| 13 | Manual prompting → autonomous loop | `loop/goal.md` (goal+verification+stop), maker/checker prompts, `run-loop.sh`, `.kiro/agents/*.json` | all loop artifacts present; goal.md has stop conditions |

Full spec (what each check inspects, exactly) lives in
[references/13-lesson-coverage.md](references/13-lesson-coverage.md) — it is the contract
`check-coverage.mjs` implements.

## Lifecycle: create → verify → improve

`check-coverage.mjs` proves the 13 lessons are *structurally present* — every required file
exists. It cannot tell a real feature from `feature_list.json`'s placeholder `feat-002`, and it
cannot tell you `init.sh` exits 0 without running a single check. A scaffold that passes 13/13
while still saying `REPLACE ME` everywhere is not a harness anyone can use.

The skill closes that gap with three more scripts that turn "looks scaffolded" into "proven to
work," and — the point that makes this self-improving — proven to work *because the skill itself
was fixed*, not because the one target was patched around:

1. **create** — `setup-harness-loop.mjs` (above). Never overwrites without `--force`.
2. **verify** — `node scripts/verify-harness.mjs --target DIR` runs nine gates beyond structure:
   placeholders left unfilled, `./init.sh` actually going green (including a *vacuous* green —
   exiting 0 without running any build/test step is treated as red), every feature's evidence
   replaying under `--run-features`, loop-artifact sanity (a goal with no stop condition, a maker
   prompt that doesn't forbid self-grading), a feature stuck past its `attempts`/`maxAttempts`
   timebox without being marked `blocked`, an unjustified `blocked` (empty `checkerNotes` and no
   matching `DECISIONS.md` entry), agent-memory hygiene (a referenced `memory/<agent>/MEMORY.md`
   missing, or grown past its index budget —
   [references/agent-memory.md](references/agent-memory.md)), design hygiene (an uncited claim, a
   blocked feature resting on an unverified assumption, a named component no feature covers, an
   invariant no falsifier cites, a falsifier citing an invariant nobody stated —
   [references/design-engineering.md](references/design-engineering.md)), knowledge layout (a
   document past the 300-line budget an agent can actually hold —
   [references/knowledge-layout.md](references/knowledge-layout.md)), instruction load (rule count
   past the budget an agent can actually follow, and prohibitions with nothing enforcing them —
   [references/llm-failure-modes.md](references/llm-failure-modes.md)), test-authoring hygiene (a
   green feature whose evidence never shows a red run, a verification with no `falsifier`, a build
   feature no prove feature judges, a test file that traces to no requirement —
   [references/test-authoring.md](references/test-authoring.md)), a `docs/reference/graph.md` older
   than the router or an agent config (`graph-stale` — the workflow moved and the only document
   describing it did not), agent-config integrity (a
   `file://` URI that resolves to nothing — kiro resolves them relative to `.kiro/agents/`, and a
   dead one silently starts the *unrestricted default* agent instead, which is the only failure in
   this harness that is invisible while it happens), agents no router or routing rule names, and
   clean-state hygiene. **Every
   finding is tagged
   `layer: project` (the target repo needs work) or `layer: harness` (the skill itself is the
   defect)** — that tag is what routes the fix to the right place instead of to a one-off patch.
   Add `--promote` (requires `--run-features`) to mechanically flip a `readyForCheck` feature to
   `done` once its evidence re-runs clean and the whole report is otherwise blocker-free — the
   purely mechanical half of the checker's job (re-run it, don't trust the claim), not a
   replacement for the checker's semantic review (does the behavior actually match, is there scope
   bleed). It never promotes anything while any blocker exists anywhere in the report.
3. **improve** — when verify finds a `layer: harness` finding, that is a bug in this skill, and it
   must be remembered past the end of the chat:
   ```bash
   node scripts/harness-issue.mjs import --report DIR/trace/verify-report.json   # record it
   node scripts/improve-harness.mjs                                              # rank open issues
   node scripts/improve-harness.mjs --prompt                                     # hand to an agent
   # ... fix templates/tree/** or scripts/*.mjs, never just the one target ...
   node scripts/improve-harness.mjs --reverify --auto-resolve                    # prove it, don't claim it
   ```
   An issue closes only when `--reverify` shows it no longer reproduces on a real target. A
   resolved issue seen again is flagged `regressed`, not silently reopened.

`scripts/harness-loop.sh --target DIR [--setup] [--runner kiro|none]` drives all three phases as
one meta-loop: verify, split findings by layer, dispatch the `harness-improver` agent for
harness-layer findings and the project's own maker/checker loop for project-layer ones, verify
again. Each repair is pinned to the issue imported from that target report, and it stops when a
canonical state repeats anywhere in the run (including A→B→A cycles) — a loop that isn't moving
needs a human, not another agent turn. The typed-state design and its DeepSeek comparison are in
[references/deepseek-harness-workflow-research.md](references/deepseek-harness-workflow-research.md).

`scripts/demo.sh` exercises all of the above — create, idempotent re-run, both verify layers, a
real injected harness bug caught and closed via issue → improve → reverify, regression detection,
evidence-replay catching a false `done` claim, the attempts-budget/blocked-justification/scope-smell
feature hygiene checks, and the meta-loop's stuck-progress stop — against a disposable target in
one command. Run it after touching any script in this skill; it is the
regression test for the skill itself. See
[references/harness-improvement-loop.md](references/harness-improvement-loop.md) for the full
layer-classification contract and event-log schema.

Visual walkthrough (end-to-end flow including where the opt-in `k8s-integration-tester` fits, the
maker/checker generator-evaluator sequence, that agent's own K8s deploy/test/diagnose cycle, and
the self-improvement loop) lives in
[references/workflow-diagram.md](references/workflow-diagram.md) — read it alongside this section
and "Setup workflow" below rather than re-deriving the shape from prose alone.

## Adopting an EXISTING project

A repo with history is a different job from a fresh scaffold, and the difference decides whether
anyone keeps using the harness. Run this instead of the scaffolder:

```bash
node harness-loop/scripts/install-onboarder.mjs --target /path/to/repo
cd /path/to/repo && kiro-cli chat --agent harness-onboarder
```

It installs **two files** and touches nothing else. The `harness-onboarder` agent then surveys the
repo (real build command, whether the baseline even passes, every file the scaffold would collide
with, what work is actually in flight), asks one round of questions with recommended answers, and
only then scaffolds — never with `--force`.

The mechanism that makes adoption survivable is `tools/adoption-baseline.mjs`. Every gate here
assumes a project that grew up with them; pointed at existing code they all fire at once (49
warnings on this skill's own dogfood target, none of them anyone's fault). So the onboarder freezes
today's counts as **accepted debt** and from then on the rule is one sentence: *you may leave the
old debt alone, you may not add to it.* New work is held to the full standard, `--ratchet` locks in
debt paid down, and blockers and a red baseline are never grandfathered. Full contract:
[references/adopting-an-existing-project.md](references/adopting-an-existing-project.md).

## Setup workflow

For a fresh project, or once the onboarder has surveyed an existing one:

1. **Inspect the target.** Detect stack/package manager, existing `AGENTS.md`/`CLAUDE.md`,
   any feature/state files, and the real verification commands. Never overwrite silently.
2. **Ask only what can't be inferred:** target agent file name (`AGENTS.md` vs `CLAUDE.md`),
   one-line project purpose, whether overwriting existing harness files is allowed, and whether
   the loop should run local (`kiro-cli` on this machine) or headless (CI/cron).
3. **Scaffold Floor 1 + Floor 2** with the bundled script:

   ```bash
   node harness-loop/scripts/setup-harness-loop.mjs --target /path/to/project
   ```

   Options: `--agent-file CLAUDE.md`, `--package-manager npm|pnpm|yarn|bun`,
   `--commands "cmd one,cmd two"` (override detected verification), `--name "Project X"`,
   `--purpose "one line"`, `--runtime kiro|claude|codex|both|all` (default `all`), `--k8s auto|on|off`, `--force` (only after
   the user OKs overwrites).

   `--k8s` defaults to `auto`: on when the target already holds a `Chart.yaml`. A repo that ships a
   chart is deployed to a cluster whether or not anything tests it there, so the Kubernetes layer
   installs with the scaffold rather than waiting for someone to remember a manual copy. `on` forces
   it, `off` suppresses it. Setup also writes the MCP config for **both** runtimes from one source —
   `.kiro/settings/mcp.json` and `.mcp.json` — pre-populated with the read-only cluster server when
   k8s is on; gate `mcp-runtime-skew` fails them if they later diverge.

4. **Collect what the repo cannot contain, before designing.** If the requirement leaves
   deployment facts, business intent, or risk appetite implicit, run the `context-interviewer`
   agent (its interview technique follows the `grilling` skill by Matt Pocock). It looks up
   anything greppable itself, asks **the whole frontier of currently-answerable questions per
   round, each numbered with a recommended answer** so a round can be answered by number, and — the
   part that matters — **persists every answer to a file**: an `docs/assumptions.md` row flipped to
   `verified`, a `docs/cross-cutting.md` decision with its enforcing rule, or a ≤300-line
   `docs/context/<topic>.md` indexed in `docs/INDEX.md`. An answer that stays in chat is lost to
   the next session.
5. **Design before decomposing — including how anyone would know it works.** The feature-planner cuts a *design* into features — it does not
   create one (`references/feature-decomposition.md` Step 1 assumes the requirement "already names
   its parts"). When it doesn't, run the `designer` agent, then `design-reviewer`: named components
   and boundaries, a claims table where every library fact cites a real `path:line` or a runnable
   spike, and `docs/assumptions.md` — a registry of load-bearing assumptions tagged
   `verified`/`assumed`/`needs-human`. Each component must also state its **observable seam** and
   the **invariants** it holds for every input: that is a design property, not a testing chore, and
   a component whose behaviour is only visible from inside has a boundary defect that gets paid for
   later by whoever writes the test. Those invariants are what step 6 derives each `falsifier`
   from. **The loop stops only on `needs-human` assumptions**: the
   deployment and business facts that cannot exist in the repo. Everything else proceeds without
   asking. Full contract, and why automating design without this is unsafe:
   [references/design-engineering.md](references/design-engineering.md).
6. **Decompose the requirement into `feature_list.json`.** This is the step that makes the loop
   actually do the user's work — do not leave placeholders, and do not hand-wave the cut. Run the
   `feature-planner` agent (`kiro-cli chat --agent feature-planner`), which follows the scaffolded
   `skills/feature-planning/SKILL.md` capability pack: draft, schema/DAG/traceability self-check,
   then publish. Against the real requirement it extracts named
   components as **build features** and named/derived scenarios as **prove features**, sizes each
   against a concrete checklist (one sentence, one verification command, a nameable file
   footprint), and produces a dependency DAG instead of a flat list. Full algorithm + a worked
   example: [references/feature-decomposition.md](references/feature-decomposition.md). Then fill
   `loop/goal.md` with the project's real objective + stopping condition to match.
7. **Author the oracles before the code.** The same agent writing both the implementation and its
   test can be wrong in both directions and still go green — so the acceptance test for a prove
   feature is designed by an agent that has not read the implementation — and `loop/route.mjs`
   enforces it as an *ordering*: a build feature is not eligible until its prove feature has a
   recorded red run, because a prompt saying "don't rewrite the test" cannot hold when there is no
   test to not rewrite. Run `test-designer`
   (spec → conditions under `tests/design/`, plus each feature's `falsifier`: the wrong
   implementation its verification catches) and then `test-implementer` (conditions → failing test
   code). Both follow `skills/test-design/SKILL.md`, scaffolded into the target. Why this is
   structural rather than advisory: [references/test-authoring.md](references/test-authoring.md).
8. **Get the baseline green.** Run `./init.sh` (or `node init.mjs` anywhere, `init.cmd` on Windows) in the target. If red, that is the only work until
   it is green (Lesson 6/9). A loop on a red baseline just amplifies failure.
9. **Prove coverage:**

   ```bash
   node harness-loop/scripts/check-coverage.mjs --target /path/to/project
   ```

   Report the per-lesson scorecard, the lowest-covered lessons, and the first 2–3 fixes. Do not
   tell the user "all 13 are covered" until this passes — that is the whole point of the skill.
10. **Verify it actually works, not just that the files exist:**

   ```bash
   node harness-loop/scripts/verify-harness.mjs --target /path/to/project --run-features
   ```

   Structural 13/13 plus a green `verify-harness.mjs` (0 blockers) is the real bar for "the
   harness is ready" — not step 6 alone. If it reports `layer: harness` findings, this skill has a
   bug; follow the Lifecycle section above before blaming the target.
11. **Start the loop only after both checks pass and the baseline is green.** Local first:
   `kiro-cli chat --agent maker` then `--agent checker`; or headless `loop/run-loop.sh N`.
   Begin at maturity Level 1 (one `/goal`-style run) and climb the ladder — see
   [references/loop-engineering.md](references/loop-engineering.md).

## Design rules (do not violate)

- **Floor 1 before Floor 2.** Never wire a loop onto a harness whose baseline is red or whose
  coverage check fails. The loop inherits every weakness underneath it.
- **The maker never grades itself.** `status: done` is the checker's decision alone (Lesson 9/13,
  generator/evaluator separation). Keep the maker write-broad and the checker write-restricted to
  state files, exactly as the `.kiro/agents/*.json` templates do.
- **Stopping conditions are machine-checkable**, never "looks right" (Lesson 10; Four Silent
  Costs → verification debt). Every feature's `verification` must be a real command.
- **Keep the router short.** `AGENTS.md` routes and states invariants; project facts go in
  `docs/*.md` (Lesson 4). Do not grow it into a manual.
- **Externalize memory.** State lives in `progress.md`/`feature_list.json`/`trace/`, never only
  in chat (Lesson 5/13 External State).
- **Human checkpoints stay human.** Exclusion approvals, ambiguous requirements, and any
  irreversible/production action are stop conditions in `loop/goal.md`, never automated.
- **Never hide destructive behavior in scaffolding.** Overwrites require explicit user approval
  (`--force`).

## When to read references

- A picture instead of prose — end-to-end flow, the maker/checker sequence, the self-improvement
  loop: [references/workflow-diagram.md](references/workflow-diagram.md)
- The full per-lesson check contract: [references/13-lesson-coverage.md](references/13-lesson-coverage.md)
- Lesson 13 in depth (six primitives, `/goal` vs `/loop`, generator/evaluator separation, four
  silent costs, maturity ladder): [references/loop-engineering.md](references/loop-engineering.md)
- Running on kiro-cli, Claude Code **and** Codex CLI from one `agents.manifest.json` — the field
  mapping, where each runtime genuinely differs, and what was verified by running it rather than by
  reading docs. Codex needs the most care: `codex exec` has no `--agent` flag (roles are assembled by
  `tools/codex-dispatch.mjs`), its agent TOML cannot carry hooks (so write confinement is
  project-wide plus `HARNESS_AGENT`, and is **not enforced** for interactively-spawned agents), and
  an untrusted hook is skipped *silently*: [references/runtimes.md](references/runtimes.md)
- Automating design without inheriting the agent's blind spots (cited claims, the assumption
  registry, spikes, adversarial design review, and where the human is actually needed):
  [references/design-engineering.md](references/design-engineering.md)
- What each mechanism in this skill is actually defending against — the LLM failure-mode taxonomy,
  including the ones still uncountered: [references/llm-failure-modes.md](references/llm-failure-modes.md)
- The design → decomposition handoff as a checkable contract — invariant ids, falsifiers that cite
  them, and why both traceability directions are gated:
  [references/invariant-contract.md](references/invariant-contract.md)
- What "good" means at each step, as a rubric rather than a mood — the criteria to apply at an
  approval gate, and the two test failure modes that look like diligence:
  [references/step-acceptance.md](references/step-acceptance.md)
- Spending the one resource that does not renew — the exhaustion ladder before any question
  reaches a person, what is genuinely irreducible, and why under-asking is worse than over-asking:
  [references/human-attention.md](references/human-attention.md)
- Keeping documents inside the size an agent can actually use (the 300-line budget, splitting a
  topic doc vs rotating an append-only log, the `docs/INDEX.md` map):
  [references/knowledge-layout.md](references/knowledge-layout.md)
- Why a green suite can prove nothing, and the information asymmetry that fixes it (the
  test-designer/test-implementer split, red-green evidence, `falsifier`, property and mutation
  oracles): [references/test-authoring.md](references/test-authoring.md)
- Bringing an existing repo under the harness without a day-one wall of warnings (the survey, the
  merge-don't-overwrite table, honest backfill, the debt baseline and ratchet):
  [references/adopting-an-existing-project.md](references/adopting-an-existing-project.md)
- The harness as an explicit graph — nodes, edges, shared-state ownership, the routing table, and
  the seven edges that were documented but never dispatched: [references/graph.md](references/graph.md)
- Turning a requirement into a right-sized `feature_list.json` (the two-axis build/prove split,
  sizing heuristics, dependency DAG construction, a worked example):
  [references/feature-decomposition.md](references/feature-decomposition.md)
- Giving an agent its own persistent, self-reorganizing memory (world-standard grounding, entry
  schema, read/write lifecycle, the `memory-consolidate.mjs` mechanical reorganize pass):
  [references/agent-memory.md](references/agent-memory.md)
- More than one service has to be running for the test to mean anything — the service registry, why
  the unit is a directory rather than a repository, and the four things a survey of seven real repos
  changed about the design: [references/multi-service.md](references/multi-service.md).
  `tools/collect-services.mjs` surveys N repos into `services.manifest.json`;
  `setup-harness-loop.mjs --integration <manifest>` scaffolds the target above them, generating
  `docs/services.md` from the registry and seeding `feat-registry`, whose verification
  (`tools/services-check.mjs`) stays **red** while any deployable service lacks a chart, an image, a
  health command or an explicit `dependsOn`; `tools/k8s-test-env.sh --services <manifest>` brings the
  set up in `dependsOn` order and ranks the diagnostics when one of them does not come up
- Target is a Kubernetes-deployed microservice and Docker isn't available for Level 3 testing:
  [references/k8s-integration-testing.md](references/k8s-integration-testing.md) — a
  namespace-per-run Helm deploy/test/collect-diagnostics/teardown script
  (`templates/k8s/tools/k8s-test-env.sh`), the `k8s-integration-tester` agent — a **test-layer**
  node owning Level 3, held to the same authoring rules as the other test agents (a traceability
  header, a named `falsifier`, a red run recorded before the green one), which fills in the
  chart, writes and runs real Level 3 tests against it, and diagnoses failures
  (`templates/k8s/prompts/k8s-integration-tester.md`; the agent config itself is generated into both
  runtimes from `agents.manifest.json`, where it is `optional` — the prompt file's presence is what
  enables it) — installed by `setup-harness-loop.mjs --k8s auto|on`, no longer a manual copy — plus a
  read-only Kubernetes MCP server config written for both runtimes, routed
  through `templates/k8s/tools/mcp-k8s-readonly-wrapper.sh` so a stopped local cluster's kubeconfig
  doesn't crash the MCP server before the connection handshake, so the agent
  can diagnose a failed deploy without holding write access to a shared cluster.

## The front door

`orchestrator` is the agent a human talks to, and the role a session takes when nobody names one
(`AGENTS.md` says so, and all three runtimes read it). It reports where the loop is, dispatches the
node the router named, and brings decisions back — translated, with numbered options and a
recommendation.

Its safety is two mechanical constraints, not two sentences of good intent:

- **It cannot choose the next node.** `loop/route.mjs` does. A router it disagrees with is a harness
  defect to report, never to route around — otherwise the deterministic, reviewable control flow
  quietly becomes an LLM's judgement call.
- **It cannot write a product file.** No source, tests, `feature_list.json` or design docs — enforced
  by `guard-write.mjs` on Claude Code and Codex, `allowedPaths` on kiro. It dispatches; the agent
  that owns the file writes it.

How it talks to you is technique, not tone: answer-first for status (the delta, the next node, and
whether you are needed), and reversibility-first for decisions — a two-way door gets one line and a
recommendation, a one-way door gets options with what each **forecloses**, the case *against* the
recommendation, and a stated default for silence.
[references/presenting-and-proposing.md](references/presenting-and-proposing.md) carries the
technique and a worked bad-vs-good example.

It is also the one agent `route.mjs` never dispatches — it is the node that *reads* the router, so
giving the loop an edge into its own front door would let it recurse.

## Surveying a project you did not write

```bash
node harness-loop/scripts/survey-project.mjs --target /path/to/repo            # read it
node harness-loop/scripts/survey-project.mjs --target /path/to/repo --agents-md > AGENTS.md
```

Two rules make the output worth trusting:

- **Every fact carries its source.** A command is reported with the file it was read from, so it can
  be checked — `./gradlew slowTest` from `.github/workflows/ci-low-cadence.yml` is evidence; the
  command that is merely conventional for the stack is not a fact about this repo. CI is read first,
  because it is what actually blocks a merge.
- **What cannot be derived stays blank.** `purpose` is always `null`: nothing in a repository states
  why it exists, and an invented purpose becomes AGENTS.md's first paragraph, confidently wrong.

The map comes from **what git tracks**, not a skip list — the real Aeron repo carries a 1,496-file
`graphify-out/` that is untracked rather than ignored, and it topped the map as if it were the
project.

`harness-onboarder`'s Phase 1 now starts here: the survey answers stack, commands, layout, docs and
tests mechanically, leaving the human the two it cannot — run the baseline, and say what the project
is for.

## Vendored code

Anything under `vendor/`, `third_party/`, `external/` or `skills/<name>/` is code this project did
not write, and it needs `vendor.manifest.json`:

```json
{ "vendored": [{ "path": "skills/test-design", "upstream": "https://…", "ref": "v1.2.3",
                 "vendoredCommit": "<sha>",
                 "localModifications": [{ "file": "schemas/x.json", "why": "… — DECISIONS.md <date>" }] }] }
```

Two gates. `vendor-unpinned`: no manifest, or an entry with no `upstream`/`ref` — a copy you cannot
diff against its source is a fork you did not decide to make. `vendor-modified-unrecorded`: a file
that differs from the vendored commit and is not in `localModifications`, working tree included.

The second one is the point, and it is borrowed from
[deepseek-harness](https://github.com/deepseek-ai/deepseek-harness), whose `vendor/README.md` pins
every package to an upstream repo *and* commit with a modification log. This harness had none of it
and was already bitten: `skills/test-design`'s schema was widened here to accept a hierarchical
requirement id, with nothing recording that as local — so the next sync would silently revert the
fix, or silently keep a stale one.

## What the harness commits, and what it ignores

Three categories. Conflating them is how a harness quietly stops working:

| | Examples | Tracked? |
|---|---|---|
| **Run output** | `trace/**`, `loop/current.json`, `loop/route-log.jsonl` | **ignored** — regenerated every run, pure diff noise |
| **State** | `feature_list.json`, `progress.md`, `DECISIONS.md`, `session-handoff.md`, `memory/**`, `docs/**` | **always tracked.** This is the externalised memory the design rests on, and gates read it *out of git* — `feature-field-lost` compares against `git show HEAD:feature_list.json`, so ignoring it turns a blocker into a no-op |
| **Machinery** | `tools/`, `prompts/`, `.kiro/`, `.claude/`, `.codex/`, `docs/reference/` | tracked by default; `setup --gitignore-harness` keeps it out of a product repo. The cost is real: a clone that ignores it cannot run the loop until the harness is re-installed |

## Upgrading a target that already exists

```bash
node harness-loop/scripts/upgrade-harness.mjs --target /path/to/project [--dry-run]
```

`setup-harness-loop.mjs` never overwrites and `--force` overwrites everything including the
project's own work, so neither is an upgrade. This splits the tree in two: **machinery the skill
owns** (`tools/**`, `docs/reference/**`, `loop/route.mjs`, `run-loop.sh`, `dispatch.sh`,
`approval-gate.mjs`, the init wrappers) is refreshed, and **files a project legitimately
customises** (prompts, `AGENTS.md`, `agents.manifest.json`, `init.mjs`'s verification block) are
reported as drift for a human to merge — never replaced. It then regenerates the agents and the
digest, so the refresh actually takes effect, and names any agent the skill has added that the
target's manifest has never heard of.

Drift is compared placeholder-tolerantly, so a target scaffolded a minute ago reports nothing.

## Carrying context between agents

The complaint that produced this: agents re-read the codebase on every task and re-ask what an
earlier step already settled. Three channels, each fixing a specific leak:

| Leak | Channel |
|---|---|
| The planner names the 1-3 files a feature touches **in order to size it**, then discards them | `context: { touches, note }` on the feature. Free to record — you cannot size a feature without knowing it. Gate: `feature-context-missing` |
| The maker navigates the codebase without the map the designer maintains | `docs/architecture.md` is now one of the maker's resources |
| Facts the repo cannot contain get re-asked | `docs/assumptions.md`, already loaded by the maker — a row flipped to `verified` is answered forever |

What is deliberately **not** shared: agent memory stays per-role. `memory/designer/` is the
designer's lessons about designing, not about this codebase; broadcasting it would cost every agent
context to carry advice for a job it does not do. Codebase facts belong in
`docs/architecture.md` and in the feature's `context`, which is why those exist.

## Reading scope without paying for it

Two tools, one job each. `feature_list.digest.md` (generated, auto-loaded by every agent) is every
feature in one line — the whole shape, cheaply. `node tools/feature.mjs <id>` is one feature in
full, so nobody has to `cat` a thousand-line JSON to read fifteen lines of it. Also
`--field verification`, `--deps <id>` (is it eligible yet), `--ready`, `--status`, `--json`.

That pair is why even the `feature-planner` — the agent that rewrites the array — no longer
auto-loads the full list. The guarantee it gave up is replaced by a gate, not a prompt sentence:
`feature-field-lost` is a **blocker** when a field that had content in the last commit is now
empty, which is exactly what rewriting the array from the digest would do.

## Is it moving?

`node tools/timeline.mjs` — replayed from git history of `feature_list.json`, because commit dates
are evidence while the dates agents write into `evidence` are self-reported (22 of 61 had one at
all on the dogfood project). It gives the **net** change over the last seven days, what was
**reopened**, a per-day bar of transitions, and how long each open feature has been open.
`--feature <id>` replays one feature's whole history.

Net, not a count of transitions: a feature finished, reopened and refinished must count once.
Counting transitions reported "21 finished this week" on a list with 18 done — true, and it reads
as a bug, which quietly destroys trust in every other number on the screen.

## Watching a run

`loop/run-loop.sh` is **attended by default** — it pauses after each iteration, shows the diff and
the router's next move, and waits. `--headless` is for CI and cron; with no TTY it falls back to
headless and says so. From a second terminal, `node tools/loop-status.mjs --watch` shows the
in-flight node and its elapsed time, features in flight, open escalations, the dispatch trail, and
a livelock warning when the same node hits the same feature four times running. The reasoning and
the three-rung ladder: [references/human-attention.md](references/human-attention.md).

## Platform support

The baseline gate is **`init.mjs`**; `init.sh` and `init.cmd` are one-line wrappers around it. So the
gate runs on macOS, Linux, WSL, Git Bash, cmd.exe and PowerShell, and `feature_list.json` verifies it
as `node init.mjs` rather than `./init.sh`. Node was already a hard dependency — every tool here is a
`.mjs` — so this adds nothing to install, and it avoids a PowerShell twin that would drift toward
whichever copy the person making the change happens to run.

**Do not put logic in the wrappers.** `improve-harness.mjs` routes every `baseline/*` finding to
`templates/tree/init.mjs` for the same reason.

What is **not** portable yet, stated plainly rather than discovered later:

| Component | Windows |
|---|---|
| `init.mjs` + wrappers, and every `tools/*.mjs` | works natively |
| `loop/run-loop.sh` — the autonomous loop driver | **bash only.** Needs Git Bash or WSL. The router (`loop/route.mjs`) and dispatch (`tools/codex-dispatch.mjs`) are already Node; it is the driver shell around them that is not |
| `tools/k8s-test-env.sh`, `tools/mcp-k8s-readonly-wrapper.sh` | bash only — Git Bash or WSL |
| `scripts/demo.sh`, `scripts/harness-loop.sh` | bash only (developer-facing, not shipped into a target) |

So on Windows a human can run the harness end to end today, and the *autonomous* loop needs Git Bash
or WSL until `run-loop.sh` is ported.

## Deliverable checklist

After setup, the target project should contain:

- [ ] `AGENTS.md` (or `CLAUDE.md`) — router with DoD, Startup Readiness, Work Rules (WIP=1),
      clock-in/out, and session-exit checklist
- [ ] `feature_list.json` — features with the behavior+verification+state+evidence triple, plus
      an `attempts`/`maxAttempts` timebox so a stuck feature converts to `blocked` instead of
      retrying forever, a `kind` (`build`/`prove`), and a `falsifier` naming the wrong
      implementation each verification would fail on
- [ ] `init.sh` — baseline gate running the real verification pipeline
- [ ] `progress.md` + `DECISIONS.md` — external state
- [ ] `session-handoff.md` — lifecycle handoff
- [ ] `docs/{architecture,constraints,testing-standards,definition-of-done}.md`
- [ ] `tools/trace.mjs` + `trace/` — observability
- [ ] `tools/{verify-harness,memory-query,memory-consolidate}.mjs` +
      `docs/reference/{agent-memory,feature-decomposition}.md` — the knowledge the agents' prompts
      cite and the tools they invoke, copied INTO the target (a prompt citing a file that only
      exists in this skill's repo fails the Fresh Session Test, Lesson 3)
- [ ] `skills/test-design/` — the test-design skill (strategy matrix by logic shape, property
      catalog, anti-patterns R-T1…R-T10, schemas), scaffolded into the target because the
      `test-designer`/`test-implementer` prompts dispatch to it
      ([references/test-authoring.md](references/test-authoring.md))
- [ ] `skills/feature-planning/` — the planner capability pack: cutting rules, counterexamples,
      schema, deterministic DAG/traceability checker and discriminating fixtures
- [ ] `memory/{maker,checker,harness-setup,feature-planner,test-designer,test-implementer}/MEMORY.md` — per-agent persistent
      memory ([references/agent-memory.md](references/agent-memory.md)); referenced in each
      agent's `resources` so it loads every run
- [ ] `loop/{goal.md,maker-prompt.md,checker-prompt.md,run-loop.sh}`
- [ ] `docs/INDEX.md` — the map of documents with a "read it when" column; every knowledge doc
      under 300 lines, the rule itself stated in `docs/constraints.md` (auto-loaded into every
      writing agent) and in `AGENTS.md`'s Working Rules
      ([references/knowledge-layout.md](references/knowledge-layout.md))
- [ ] every agent with write access loads `docs/constraints.md` — checked mechanically, because an
      agent that can write without the rulebook violates rules it has never seen
- [ ] `docs/assumptions.md` — registry of load-bearing design assumptions; `docs/cross-cutting.md`
      — policies with an owner and an enforcing rule; `docs/design/` for design docs
      ([references/design-engineering.md](references/design-engineering.md))
- [ ] `tools/adoption-baseline.mjs` — freezes pre-existing warnings as accepted debt on an adopted
      repo, fails only on growth, `--ratchet` locks in what has been paid down
      ([references/adopting-an-existing-project.md](references/adopting-an-existing-project.md))
- [ ] `loop/route.mjs` + `loop/approval-gate.mjs` — the routing table as code (a rollback returns to
      the *layer* the defect came from), and a selective human-approval node on the edge where
      `done` becomes terminal ([references/graph.md](references/graph.md))
- [ ] `tools/review-digest.mjs` — turns a large generated diff into the ranked handful of
      *decisions* a human should judge, and says plainly what it is telling you to skip
- [ ] `tools/context-budget.mjs` + `tools/feature-digest.mjs` — measure what every agent is made
      to read before it starts, and keep the feature list out of that budget
      ([references/llm-failure-modes.md](references/llm-failure-modes.md))
- [ ] `tools/cross-cutting-audit.mjs` — finds concerns nobody owns (`unowned`) and registered
      decisions still waiting on a human (`open-decision`)
- [ ] `agents.manifest.json` — the single source for every agent, from which
      `.kiro/agents/*.json`, `.claude/agents/*.md` **and** `.codex/agents/*.toml` are generated
      (`tools/gen-agents.mjs`); the fields Claude Code and Codex lack are covered by
      `tools/agent-context.mjs` (per-agent resources), `tools/guard-write.mjs` (per-agent write
      limits) and `tools/codex-dispatch.mjs` (Codex has no `--agent` flag)
      ([references/runtimes.md](references/runtimes.md))
- [ ] `.kiro/agents/*.json`, `.claude/agents/*.md` and/or `.codex/agents/*.toml` for
      {maker,checker,harness-setup,feature-planner,designer,design-reviewer,context-interviewer,test-designer,test-implementer}
      (+ the MCP config for each installed runtime: `.kiro/settings/mcp.json`, `.mcp.json`,
      `.codex/config.toml` — and `.codex/hooks.json`, without which no Codex write limit is enforced)
- [ ] `check-coverage.mjs` reports all 13 lessons covered, and `./init.sh` is green
- [ ] `verify-harness.mjs --run-features` reports 0 blockers (not just structural coverage)

If you cannot write files, output the exact file contents and commands instead.
