# TimesTen → Aeron Cluster Migration — agent router

> **Status: dormant.** Scaffolded 2026-07-30 and untouched since; all 9 features in
> `feature_list.json` are still `not-started`. This was the repository's original project, before
> the repo became the home of the `harness-loop` skill. It is kept because it is a real worked
> example of the harness applied to a hard migration — and because its scaffold (`init.sh`,
> `feature_list.json`, `inventory/`, `loop/`, `.kiro/agents/`, `trace/`) is still on disk at the
> repo root and would be orphaned without this file.
>
> This file **was** the repo's root `AGENTS.md`. If you resume the migration, read this as its
> router; the repo-level router is now [`../AGENTS.md`](../AGENTS.md) and describes the harness
> assets instead. Paths below are relative to the repository root.

This project migrates the core financial logic of a production system from Oracle TimesTen
(PL/SQL + SQL) to a deterministic Java service on Aeron Cluster. The repository is the system
of record: everything you need is in files here, never in chat history.

**Goal invariant: 100% of the old system's logic is either migrated with parity evidence, or
explicitly excluded with a human-approved justification. Nothing is silently dropped.**

## Startup workflow (every session)

1. `pwd` — confirm you are at the repo root.
2. Run `./init.sh` — environment + baseline verification. If it fails, fixing it IS your task.
3. Read `progress.md` (last session state), then `feature_list.json`.
4. `git log --oneline -5`.
5. Pick exactly ONE feature whose dependencies are all `done`. Never work two at once.

## The per-unit pipeline

Every logic unit advances through these states in order (field `pipeline` on its feature):

`inventoried → specced → golden-mastered → implemented → parity-verified → done`

No skipping states. Exit criteria per state: `docs/00-migration-playbook.md`.

## Invariants — never violate

- A unit is never `done` without parity evidence (Definition of Done below).
- Never edit `inventory/inventory.json` by hand — it is machine-extracted (docs/01).
- Excluding a unit requires an entry in `inventory/exclusions.json` with a written reason AND
  a human `approvedBy`. Agents may propose exclusions; only humans approve them.
- All cluster-service Java must pass `tools/check-determinism.sh`. Forbidden inside the
  service: wall-clock time, RNG, thread creation, blocking I/O, float/double for money.
  Full rules: docs/03-aeron-determinism-rules.md.
- Money and quantities are fixed-point longs (or scaled decimals) with documented scale and
  rounding mode. Never float/double.
- When TimesTen behavior and "clean" Java behavior differ (rounding, NULLs, ordering, locking
  anomalies, sequence gaps): never resolve silently. Record the decision in
  `docs/04-decision-log.md` first, then implement what was decided.
- TimesTen access goes through the read-only MCP server declared in `inventory/sources.yaml`
  — SELECT/dictionary queries and capture only, never DML/DDL on shared data, never a
  production instance. The parity runner never calls TimesTen; it replays stored vectors.
- Baseline red = stop feature work and repair the baseline first.

## Definition of Done (per unit feature)

- [ ] Spec in `specs/<unit-id>.md`: inputs, outputs, side effects, NULL handling, error
      paths, edge cases, and any uncaptured behavior explicitly listed
- [ ] Golden-master vectors in `vectors/<unit-id>/` meeting the minimums in docs/02
- [ ] Java implementation with domain unit tests, all green
- [ ] Parity run green: vectors replayed against the new service, field-by-field match
- [ ] `tools/check-determinism.sh` clean
- [ ] `node tools/coverage-check.mjs` passes
- [ ] Evidence recorded in `feature_list.json`: exact command, result summary, output digest, date
- [ ] Checker approval (second agent via `loop/checker-prompt.md`, or a human)

## End of session

1. Update `progress.md` and `feature_list.json`.
2. `./init.sh` must pass before you stop.
3. Commit with a descriptive message. If mid-unit, fill `session-handoff.md`.

## Doc map (read on demand — do not preload everything)

| Doc | When to read |
|---|---|
| `docs/00-migration-playbook.md` | Before starting any unit; phase overview and exit criteria |
| `docs/01-logic-inventory.md` | Working on inventory extraction or coverage gaps |
| `docs/02-parity-testing.md` | Capturing vectors or writing/debugging parity tests |
| `docs/03-aeron-determinism-rules.md` | Writing or reviewing any service Java |
| `docs/04-decision-log.md` | Hitting any TimesTen ↔ Java semantic difference |
| `docs/05-capture-replay.md` | Building or operating input capture, tapes, replay rigs |

## Escalation

- Semantic decision with no entry in docs/04 → propose one, mark feature `blocked`, move on.
- Same failure twice across sessions → write it up in `session-handoff.md`, flag for human.
- Anything touching production TimesTen or cutover → human-only. Agents work against the
  reference instance defined in `inventory/sources.yaml`.

## Task trace (observability)

`trace/trace.jsonl` is the append-only decision-path record of the whole migration — who
did what, when, and why, replayable after the fact. Two collection layers:

- **Harness-collected (automatic, not optional):** `./init.sh` logs every baseline result;
  Kiro agent hooks log session start/end and tool use. You cannot turn these off.
- **Agent-logged decision points (mandatory):** feature picked, pipeline transition,
  blocked, verify-failed (maker); evidence re-run, verdict (checker) — via
  `node tools/trace.mjs <actor> <event> <feature> "<detail>"`.

Never edit or delete existing trace lines; append only. Commit the trace with your work.
When diagnosing "how did this unit get to done?", read the trace before reading progress.md.

## Agent runtime (Kiro / kiro-cli)

- Custom agents live in `.kiro/agents/`: `harness-setup` (environment bootstrap),
  `maker` and `checker` (the migration loop). TimesTen MCP config: `.kiro/settings/mcp.json`.
- Autonomous operation: `loop/run-loop.sh N` alternates maker and checker headlessly and
  stops on any red baseline or stop condition in `loop/goal.md`.

---

# Project README (moved here from the repo root)

_What follows was the second half of the repository README. Paths are relative to the
repository root._

A complete agent harness for migrating a financial system's core logic from Oracle TimesTen
(PL/SQL + SQL) to a deterministic Java service on Aeron Cluster, with a machine-enforced
100%-coverage guarantee.

Built on the five harness subsystems from
[Learn Harness Engineering](https://github.com/walkinglabs/learn-harness-engineering):
Instructions (`AGENTS.md`), State (`feature_list.json`), Verification (`init.sh` + tools),
Scope (per-unit pipeline + Definition of Done), Lifecycle (`progress.md`,
`session-handoff.md`), plus the Lecture 13 maker–checker loop (`loop/`).

## The coverage chain — why "100%" is enforceable, not aspirational

1. **Machine-extracted denominator** — `tools/extract-inventory.sql` enumerates every
   logic-bearing object from TimesTen catalogs (plus app-side Java/Spring Boot logic) into
   `inventory/inventory.json`. No hand-written lists.
2. **Total mapping** — `tools/coverage-check.mjs` fails unless every unit is mapped to a
   feature or carries a human-approved exclusion.
3. **Behavior, not code** — each unit is pinned by golden-master vectors captured from a
   real TimesTen instance (`docs/02`), then replayed field-by-field against the new service.
   Real-traffic vectors come only from certified tapes (`docs/05`).
4. **Determinism gates** — static scan (`tools/check-determinism.sh`) + replay tests
   guarantee the Aeron service is a valid deterministic state machine (`docs/03`).
5. **Drift control** — source hashes recorded at spec time; one mandatory re-extraction
   before cutover proves the frozen-logic assumption held.
6. **Maker–checker** — no feature reaches `done` without an independent checker re-running
   the evidence and trying to falsify it (`loop/`).

**Hard rules:** the migration team has zero PROD rights — all PROD-derived data comes from
existing exported copies requested per D-009; no replay of any kind ever executes on PROD.

## Install (Kiro / kiro-cli)

1. This repo root IS the harness root, and the custom agents live in `.kiro/agents/`.
   **Changed since this was written:** the root `AGENTS.md` Kiro auto-loads now describes the
   harness assets, not this migration. To resume the migration, point the agents at *this* file
   as their router — or restore it to the root under a name Kiro picks up.
2. Configure the TimesTen MCP server in `.kiro/settings/mcp.json` (replace the
   placeholders), pointing at a reference instance — never production.
3. Run the bundled setup agent: `kiro-cli chat --agent harness-setup`. It verifies the
   toolchain, proves TimesTen MCP connectivity with real dictionary queries, fills
   `inventory/sources.yaml` with verified values, gets `./init.sh` green, and reports what
   remains blocked.
4. After setup reports green: start feat-001 with the maker agent
   (`kiro-cli chat --agent maker`), or go autonomous with `loop/run-loop.sh N`
   (headless; requires `KIRO_API_KEY`).

## Layout

```
AGENTS.md            entry point: startup workflow, invariants, Definition of Done
feature_list.json    state: foundation features + per-unit migration features
init.sh              baseline gate run at every session start/end
progress.md          session continuity log
session-handoff.md   mid-unit / escalation handoff
docs/                playbook, inventory, parity, determinism, ADR log, capture/replay
tools/               extraction SQL, coverage gate, determinism scanner, trace appender
trace/               trace.jsonl — append-only task trace (created on first init.sh run)
inventory/           machine-extracted inventory + exclusions + sources
loop/                goal + maker/checker prompts + run-loop.sh (headless kiro-cli loop)
prompts/             harness-setup agent prompt body
.kiro/agents/        harness-setup, maker, checker (kiro-cli custom agents)
.kiro/settings/      mcp.json — TimesTen MCP server config (fill placeholders)
.kiro/steering/      determinism.md — auto-loads on src/main/java/** edits
specs/  vectors/  scenarios/   created as units progress
```

## Human-only checkpoints

Data acquisition requests (D-009), exclusion approvals, `docs/04` decisions marked
`needs-human`, masking policy (D-008), and the Phase 4 shadow-run/cutover.
