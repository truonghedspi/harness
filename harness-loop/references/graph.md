# The harness as an explicit graph

`workflow-diagram.md` draws what the harness is *meant* to do. This file states what it *actually
executes*: every node, every edge, who owns every field of shared state, and the routing rule that
picks the next node. The difference between the two documents is the point — writing this one is
what surfaced seven edges that existed only inside an agent's context.

Scope: the project loop (`loop/run-loop.sh`). The harness self-improvement loop
(`scripts/harness-loop.sh`) is a second graph; the one edge between them is listed at the end.

## Nodes

| Node | Kind | Responsibility | Reads | Writes |
|---|---|---|---|---|
| `init.sh` | code | baseline gate — build + test + constraint gates | repo | exit code |
| `context-interviewer` | agent | ask only what the repo cannot answer; persist every answer | `assumptions.md`, audit output | `assumptions.md`, `cross-cutting.md`, `constraints.md`, `docs/context/**`, `DECISIONS.md` |
| `designer` | agent | components, cited claims, assumption registry, **observable seam + invariants per component** | `requirement.md`, `docs/**` | `docs/design/**`, `architecture.md`, `assumptions.md`, `spikes/**` |
| `design-reviewer` | agent | falsify the design; verify claims by citation | `docs/design/**` | `assumptions.md`, `session-handoff.md` |
| `feature-planner` | agent | cut the design into a build/prove DAG; derive each `falsifier` from the design's invariants | `requirement.md`, design | `feature_list.json`, `goal.md`, `constraints.md` |
| `test-designer` | agent | spec → test conditions; **never reads implementation** | spec, interfaces | `tests/design/**`, `feature_list.json` (`falsifier`) |
| `test-implementer` | agent | conditions → failing test code (red first) | conditions, interfaces | test sources |
| `maker` | agent | advance exactly one feature by one step | `feature_list.digest.md`, docs | source, `feature_list.json`, `progress.md` |
| `loop/route.mjs` | code | **the dispatcher** — reads shared state, returns the next node + its layer + why | `feature_list.json`, `docs/assumptions.md` | nothing (pure) |
| `loop/approval-gate.mjs` | code | stop for a human before `done` becomes terminal; selective, timeout auto-**rejects** | `feature_list.json`, `review-digest` output | `loop/approval-request.md`, `loop/approval-log.jsonl` |
| `verify-harness --promote` | code | replay every claimed evidence; flip mechanical passes | `feature_list.json`, repo | `feature_list.json`, `trace/verify-report.json` |
| `checker` | agent | falsify the maker's claims; sole owner of `done` | `feature_list.json`, evidence | `feature_list.json`, `progress.md` (state files only) |
| `k8s-integration-tester` | agent | Level 3 proof across a real service boundary (+ the cluster lifecycle it needs) | chart, `docs/testing-standards.md`, `feature_list.json` | chart, tests, `feature_list.json` |

`maker`, `test-implementer`, `harness-setup` and `k8s-integration-tester` write unrestricted; every
other agent is confined by `toolsSettings.write.allowedPaths`. **That confinement is the edge set**:
an agent cannot create a handoff it has no write access to.

## Shared state — one owner per field

| Field | Writer | Readers | Merge rule |
|---|---|---|---|
| `feature_list.json[].status` | `checker`, `--promote` | all | single writer per feature; `blocked` beats mechanical promotion |
| `feature_list.json[].readyForCheck` | `maker` | `--promote`, `checker` | maker sets, checker clears |
| `feature_list.json[].evidence` | `maker` | `checker`, `--promote` | overwrite per attempt |
| `feature_list.json[].checkerNotes` | `checker`, `maker`, `test-designer` | `maker`, `designer`, `feature-planner` | append; **first line is the routing marker** |
| `feature_list.json[].attempts` | `maker` | gate `over-budget` | +1 per iteration, never reset |
| `feature_list.json[].falsifier` | `feature-planner`, `test-designer` | `checker` | overwrite |
| `docs/assumptions.md` | `designer`, `design-reviewer`, `context-interviewer`, `test-designer` | all | row-level; status only moves toward `verified` |
| `docs/cross-cutting.md` | `context-interviewer`, `designer` | all | a row closes only with mechanism + owner + enforcing rule |
| `progress.md` / `session-handoff.md` | `maker`, `checker` | next session | append |
| `trace/**`, `memory/<agent>/**` | each agent, its own dir only | that agent at spawn | append |
| `loop/approval.md` | **the human** | `approval-gate.mjs` | first line is the verdict; a verdict with no reason is treated as a rejection |
| `loop/approval-log.jsonl` | `approval-gate.mjs` | audit | append-only |

## Routing rules

```
if init.sh red                            → maker (repair is its whole iteration)
if feature.checkerNotes ^ "NEEDS DESIGN:" → designer
if feature.checkerNotes ^ "NEEDS RE-PLAN:"→ feature-planner
if an open feature has no falsifier       → test-designer
if a prove feature has a falsifier
   but no recorded test run               → test-implementer
if a build feature's prove feature
   has no test yet                        → NOT eligible (the maker would write it)
if feature.verification touches k8s       → k8s-integration-tester  [integration]
if feature.attempts >= maxAttempts        → blocked (stop retrying)
if assumption.status == needs-human       → context-interviewer   [STOPS the loop]
if feature.readyForCheck                  → verify-harness --promote → checker
if checker APPROVE                        → done
if checker REJECT                         → maker            (rollback: implementation layer)
if checker REJECT + NEEDS DESIGN          → designer         (rollback: design layer)
if checker REJECT + NEEDS RE-PLAN         → feature-planner  (rollback: decomposition layer)
if every feature done|blocked-with-reason → exit
```

```mermaid
flowchart TD
  I([init.sh]) --> R{{"loop/route.mjs<br/>picks the next node + layer"}}
  R -->|spec| CI[context-interviewer]
  R -->|design| D[designer]
  R -->|decomposition| FP[feature-planner]
  R -->|oracle| TD[test-designer]
  R -->|oracle| TI[test-implementer]
  R -->|integration| K["k8s-integration-tester<br/>Level 3"]
  R -->|implementation| M[maker]
  CI --> R
  D --> DR[design-reviewer]
  DR -.->|"REJECT — no return edge yet"| D
  DR --> R
  FP --> R
  TD --> TI
  TI --> R
  M -->|readyForCheck| A[["loop/approval-gate.mjs<br/>human, only when judgement is owed"]]
  K --> A
  A -->|approved| P[["verify-harness --promote"]]
  A -->|rejected / timeout| C
  P --> C{checker}
  C -->|APPROVE| DONE([done])
  C -->|"REJECT (implementation)"| R
  C -->|"NEEDS DESIGN (design)"| R
  C -->|"NEEDS RE-PLAN (decomposition)"| R
  classDef code fill:#eef,stroke:#446
  class I,R,A,P code
```

Every rollback returns through `route.mjs`, which is the point: a verdict names the **layer** the
defect came from, and the router — not the checker, and not the next agent — decides who that is.

The one dotted edge is the one still unrouted: a `design-reviewer` REJECT has no return path to
the designer (implicit edge #6 below).

## The seven implicit edges

Writing the table above forced each marker to name a *destination*. Seven of them had none: they
were written to state, reported by tools, and dispatched by nobody. They worked only because a
human read a report and typed the next command.

| # | Edge | Written by | Read by | Dispatched by | Consequence |
|---|---|---|---|---|---|
| 1 | `NEEDS DESIGN:` → `designer` | maker, checker, test-designer | designer | ~~nothing~~ **`route.mjs`** | *closed* |
| 2 | `NEEDS RE-PLAN:` → `feature-planner` | checker | feature-planner | ~~nothing~~ **`route.mjs`** | *closed* |
| 3 | `needs-human` assumption → `context-interviewer` | designer, design-reviewer | context-interviewer | ~~nothing~~ **`route.mjs`** | *closed* |
| 4 | k8s feature → `k8s-integration-tester` | maker (skips it) | — | ~~nothing~~ **`route.mjs`** | *closed* |
| 5 | conditions → `test-implementer` | test-designer | test-implementer | ~~nothing~~ **`route.mjs`** | *closed 2026-08-10* — with it open, the maker wrote the test it was to be judged by |
| 6 | `design-reviewer` REJECT → `designer` | design-reviewer | designer | **nothing** | review findings die in `session-handoff.md` |
| 7 | baseline red → `maker` repair | `init.sh` | maker step 2 | **contradicted** | `run-loop.sh` exits on red *before* the repair node runs |

**Status, 2026-08-10.** Five of the seven are closed by `loop/route.mjs`, which turned the routing
table into executable code. Two remain: #6 (`design-reviewer` REJECT has no return edge) and #7
(`run-loop.sh` exits on a red baseline *before* the maker's repair step can run). Gate
`agent-unrouted` now fails any agent that neither the router nor `route.mjs` names, so this class
cannot silently return.

### Edges 1–3 compose into a livelock, reproduced

`all_settled()` exits the loop only when every feature is `done`/`passing`, or `blocked` *with* a
recorded reason. A feature marked `NEEDS DESIGN:` is none of those — it is still `not-started`. And
`maker-prompt.md` step 3 instructs the maker to **skip** exactly those features.

```
features: feat-a NEEDS DESIGN, feat-b NEEDS RE-PLAN   → open: 2 → all_settled = 1 (not settled)
  → run-loop spawns maker → maker skips both → no state change
  → next iteration: identical → …
```

So the loop burns a paid LLM session per iteration, forever, producing nothing — and every
iteration looks healthy in the log. This is the lecture's claim landing exactly: the edges were
*documented in prose* and *reported by tooling*, and neither is the same as being modeled.

Note what did **not** find this. Nine mechanical gates, 32 demo steps and 63 assertions all pass on
this repo: every gate inspects the *content of a file*, and none inspects *which node runs next*.
The graph is a different axis of verification, not a stricter version of the same one.

## The edge between the two graphs

`verify-harness.mjs` tags every finding `layer: project` or `layer: harness`. A `harness` finding
belongs to the second graph — `harness-issue.mjs` records it, `improve-harness.mjs` ranks it,
`harness-improver` fixes the template. That edge *is* dispatched, by `harness-loop.sh`. It is the
only cross-graph edge, and the only reason a defect found while working one project can change how
every future project is scaffolded.
