# AGENTS.md — TimesTen → Aeron Cluster Migration

This repository migrates the core financial logic of a production system from Oracle TimesTen
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
