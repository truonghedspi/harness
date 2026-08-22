# harness

This repository holds the agent-harness assets for the team:

- **`test-design.skill`** — test-design skill pack
- **`harness-loop/`**: scaffolds a full agent harness (Lessons 1–12) plus an autonomous
  maker–checker loop (Lesson 13) onto any project, targeting Kiro (kiro-cli), with a
  machine-checkable guarantee that all 13
  [Learn Harness Engineering](https://github.com/walkinglabs/learn-harness-engineering) lessons
  are covered — and a second, self-improving loop that keeps the skill itself honest. Three
  phases: **create** (`setup-harness-loop.mjs`), **verify** (`check-coverage.mjs` for structure,
  `verify-harness.mjs` for whether it actually works — no placeholders, `init.sh` really green,
  feature evidence really reproduces, runtime-specific hook calibration rejects malformed Codex
  allow/deny output, a feature past its rejected-review `attempts`/`maxAttempts` timebox that
  hasn't been marked `blocked`, a `blocked` with no reason recorded anywhere; `--promote`
  mechanically flips a feature to `done` once its evidence reproduces clean and the whole report
  is otherwise blocker-free), **improve** (`harness-issue.mjs` + `improve-harness.mjs`
  turn a `layer: harness` finding into a ranked, tracked fix to the template, closed only when
  `--reverify` proves it stopped reproducing). Run
  `node harness-loop/scripts/setup-harness-loop.mjs --target <proj>`, then
  `node check-coverage.mjs` (must report 13/13) and
  `node harness-loop/scripts/verify-harness.mjs --target <proj> --run-features` (must report 0
  blockers). Scaffolded targets run the baseline, router, named dispatch and autonomous loop
  natively on Windows, macOS and Linux through Node `.mjs` entry points; `.sh` and `.cmd` files are
  compatibility wrappers only. In an interactive session, the orchestrator natively spawns the
  one sub-agent selected by the router; Node dispatch is the headless/CI fallback. After every
  state change it shows canonical done/total/percent/remaining progress from `loop-status.mjs`.
  Fresh scaffolds contain harness state, tools, prompts and documentation under one root-level
  `harness/` directory. Only `AGENTS.md` and runtime-required `.kiro/`, `.claude/`, `.codex/`
  adapters remain at project root. `node harness/cli.mjs status` detects local changes even while
  the experimental harness remains uncommitted. Machine-specific Java/Maven paths, Kubernetes
  context and redacted API-key presence live under local-only `harness/env/`.
  Kubernetes-deployed microservice without Docker access: an opt-in
  `harness-loop/templates/k8s/tools/k8s-test-env.sh` does namespace-per-run Helm
  deploy/test/collect-diagnostics/teardown for Level 3 testing, and the opt-in
  `k8s-integration-tester` agent (`templates/k8s/.kiro/agents/k8s-integration-tester.json`) fills
  in the chart, writes and runs the real cross-service tests, and diagnoses failures via read-only
  cluster access — see `harness-loop/references/k8s-integration-testing.md`.
  For non-obvious implementation seams, the planner can publish a digest-bound feature context
  packet; dispatch injects fresh facts plus live `mustRead` sources and records a typed receipt.
  Runtime hooks emit redacted read/search metadata to `trace/tool-events.jsonl`; the run report
  separates native coverage from inferred shell activity and never stores file contents.
  Integration targets additionally receive a business-journey capability pack for public
  command-to-outcome flows, optional Cucumber, per-run isolation, distributed/fault oracles and
  redacted deployment/readiness/scenario metrics.
  For a new integration-test repository, `init-integration-project.mjs` inventories service roots
  and emits evidence-rich typed questions; only `finalize-integration-init.mjs` accepts the
  digest-bound human answers and creates the executable scaffold.
  Its `quality-strategy` capability turns the human Capability–Attribute risk decision into
  risk-to-oracle traceability and checks test scope independently from small/medium/large execution
  constraints, including ownership/isolation/cleanup for cluster-sized evidence.
  The versioned `user-skills/human-presenter` package is installed once at user scope with
  `install-user-skill.mjs`; it applies a lightweight communication audit to substantive answers,
  conditionally loading intent, provenance, language and visual-routing references. The installer
  also writes an always-included global Kiro steering bridge, because installing a skill alone does
  not guarantee that an agent will notice its trigger.
  `user-skills/human-interview` replaces the context-switching interviewer agent: the agent that
  discovers a human-owned gap exhausts evidence, asks in place, validates the answer and records a
  durable receipt.
  The onboarding installer also ships `skills/harness-upgrade`: existing harness targets are
  upgraded through an ownership-aware merge plan instead of ad-hoc prompt/manifest edits. A
  versioned `upgrade-context.json` carries each relevant change's reason, target impact, merge
  actions and verification into that plan; dropped or unacknowledged context keeps it red.
  `harness-loop/scripts/demo.sh` proves the whole lifecycle end-to-end on a disposable target in
  one command. Lesson 10's top verification tier is microservice integration / contract testing.
- **`examples/timesten-migration/`** — a dormant worked example: a real TimesTen → Aeron Cluster
  migration under this harness, self-contained (its own `AGENTS.md`, `init.sh`, `feature_list.json`,
  `loop/`, `tools/`, `inventory/`, `.kiro/`). Scaffolded 2026-07-30, untouched since, all 9
  features `not-started`. Read it for what a filled-in harness looks like on a hard problem —
  the per-unit pipeline, parity-evidence Definition of Done, and an exclusion register that
  requires a human `approvedBy`.

---

## Working in this repo

Read [`AGENTS.md`](AGENTS.md) — the router: what lives here, the rules that hold (fix the template
not the target; every behaviour change gets a `demo.sh` step), and how a change is verified.
