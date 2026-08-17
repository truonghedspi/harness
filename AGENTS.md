# AGENTS.md — harness assets

Router for agents working in **this** repo (Lesson 4): what lives here, the rules that hold, and
where to read next. This repo *builds* the harness, so it is held to the harness's own rules — a
skill that teaches a discipline it does not follow is not evidence of anything.

> **This repo is a skill, not an application.** There is no product to run. The deliverable is
> `harness-loop/`, and the way you prove a change to it works is `harness-loop/scripts/demo.sh`.

## Map (read these when relevant)

| Path | When to read |
|---|---|
| `harness-loop/SKILL.md` | **Start here.** What the skill does, the 13-lesson contract, setup + adoption workflow |
| `harness-loop/references/graph.md` | Who runs next and why — nodes, edges, shared-state ownership, the routing table |
| `harness-loop/references/*.md` | One topic each: test authoring, agent memory, design engineering, LLM failure modes, human attention, knowledge layout, feature decomposition, k8s testing, adoption |
| `harness-loop/templates/tree/` | What every scaffolded project receives. **Fix bugs here, not in a target.** |
| `harness-loop/scripts/` | The tooling: create, verify, improve, plus the analysis tools copied into targets |
| `harness-loop/harness-issues.jsonl` | Known defects in this skill, their status, and where each was seen |
| `test-design.skill/` | The test-design skill pack (vendored into targets as `skills/test-design/`) |
| `examples/timesten-migration/` | A dormant worked example — a real migration under this harness, self-contained |

## Startup Workflow (start of session — clock in)

1. `pwd` — confirm the repo root.
2. `git log --oneline -5` — what landed last.
3. `node harness-loop/scripts/harness-issue.mjs list` — open defects in the skill.
4. Read `harness-loop/SKILL.md`'s section for whatever you are changing. Do **not** preload the
   references; open the one the task names.

## Startup Readiness

Before feature work, confirm the demo baseline can run, at least one check can report red or green,
`feature_list.json` and `progress.md` agree, and `node loop/route.mjs` names the next node. Fixing a
failed readiness condition is the task; do not start the autonomous loop on top of it.

## Working Rules

- **WIP = 1.** Keep one feature active and finish or explicitly block it before starting another.
- **Fix the template, never the target.** A bug found while a target is being scaffolded belongs to
  `templates/tree/**` or `scripts/*.mjs`. Patching the one target hides the defect from every future
  project — that is what `layer: harness` findings exist to route.
- **Every behaviour change gets a `demo.sh` step that would fail without it.** The demo is this
  repo's verification; a change it does not exercise is unverified, whatever the reasoning says.
- **Every upgrade-relevant harness change updates `harness-loop/upgrade-context.json`.** Record why
  it changed, target impact, affected paths, semantic merge actions and verification. The onboarder
  must receive context, not reverse-engineer intent from a filename diff. Gate:
  `node harness-loop/scripts/check-upgrade-context.mjs --target .`.
- **Record a defect before fixing it:** `harness-issue.mjs add`, then fix, then
  `improve-harness.mjs --reverify`. An issue is closed by the defect no longer reproducing, never
  by a claim that it was fixed.
- **A mechanical gate must be calibrated against real targets before it ships.** A gate that fires
  on everything teaches people to ignore it, which is worse than no gate — it photographs as
  coverage. Check it against a fresh scaffold (should be silent) and a real repo (should find the
  real gap).
- **Any change to the workflow updates `harness-loop/references/graph.md` in the same commit.**
  Adding or renaming an agent, adding a routing rule, changing a node's layer, introducing a code
  node, changing who writes a shared-state field — all of it. The graph is the only place the whole
  control flow is written down; a graph that lags the code is worse than none, because it is read
  as authoritative. `verify-harness.mjs` reports `graph-stale` when `route.mjs` or an agent config
  is newer than the graph, but it can only see the timestamp — whether the *content* is right is
  yours. Nine gates and 80 demo assertions did not find the livelock that writing this file did
  ([graph.md](harness-loop/references/graph.md)): they inspect file content, none inspects which
  node runs next.
- **Keep every document ≤300 lines** and indexed. This repo's own rule, applied to itself
  (`harness-loop/references/knowledge-layout.md`). An indexed archive directory is exempt.
- **`SKILL.md` is a router, not a manual.** Detail goes in `references/`; the skill file links.

## How you write

Lead with the verdict, decision, finding, or blocker in a first line under 200 characters. Put the
support after a blank line. Keep claims traceable without turning every sentence into a citation;
use [presenting guidance](docs/reference/presenting-and-proposing.md) for consequential reports.

## Verification Commands

```bash
bash harness-loop/scripts/demo.sh          # the real gate: every feature, end to end
node harness-loop/scripts/check-coverage.mjs --target <a scaffolded project>
node harness-loop/scripts/verify-harness.mjs --target <a scaffolded project> --run-features
```

`demo.sh` green is the bar for any change to the skill. It scaffolds throwaway targets, breaks them
deliberately, and asserts each gate catches what it claims to.

The target-level testing hierarchy is recorded in [testing standards](docs/testing-standards.md),
and the stable repository map is in [architecture](docs/architecture.md).

## Definition of Done (per change to the skill)

- [ ] The behaviour exists in `templates/tree/**` or `scripts/**`, not only in a target
- [ ] A `demo.sh` assertion covers it, and fails when the change is reverted
- [ ] `bash harness-loop/scripts/demo.sh` is green
- [ ] Any new gate calibrated on at least one real repo, with the numbers recorded
- [ ] If the workflow changed: `references/graph.md` (node table, shared state, routing rules,
      mermaid) and `references/workflow-diagram.md` both updated
- [ ] Docs updated: `SKILL.md` (link + one line), the relevant `references/*.md`, `README.md` if
      the surface changed
- [ ] Any defect this fixes is resolved in `harness-issues.jsonl` with a note saying how it was
      confirmed

## End of Session (clock out — leave clean state)

1. `demo.sh` green.
2. Docs and `harness-issues.jsonl` updated.
3. Commit with a message that states what was found, not only what was changed.
4. Anything mid-flight → `session-handoff.md`.

## Escalation (human checkpoints — never automated)

- **Weakening a gate.** Making a check quieter is a judgement about what may go unverified.
- **Anything that changes what a scaffolded project receives by default** — every future target
  inherits it.
- **A finding you cannot classify** as `layer: project` vs `layer: harness`. Guessing sends the fix
  to the wrong place, and the wrong place is usually the one that hides it.

## Also in this repo

`examples/timesten-migration/` is a **dormant** worked example: a real TimesTen → Aeron Cluster
migration under this harness, self-contained with its own `AGENTS.md`, `init.sh`,
`feature_list.json`, `loop/`, `tools/`, `inventory/` and `.kiro/`. `cd` into it and Kiro loads its
three agents; from the repo root Kiro loads only `harness-improver`, which is the harness's own.

It is an example, not this repo's scope. Read it for what a filled-in harness looks like on a hard
problem — the per-unit pipeline, the parity-evidence Definition of Done, the exclusion register
that requires a human `approvedBy`.
