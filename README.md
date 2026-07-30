# harness

This repository holds the agent-harness assets for the team:

- **Skill packs** (pre-existing): `code-review/`, `code-review-workflow/`, `flow-spec/`,
  `halo-guide/`, `java-aeron-quality-review/`, `test-design.skill`
- **`harness-loop/`**: scaffolds a full agent harness (Lessons 1–12) plus an autonomous
  maker–checker loop (Lesson 13) onto any project, targeting Kiro (kiro-cli), with a
  machine-checkable guarantee that all 13
  [Learn Harness Engineering](https://github.com/walkinglabs/learn-harness-engineering) lessons
  are covered. Run `node harness-loop/scripts/setup-harness-loop.mjs --target <proj>` then
  `node check-coverage.mjs` (must report 13/13). Lesson 10's top verification tier is
  microservice integration / contract testing.
- **TimesTen → Aeron Cluster migration harness** (below): the system of record that lets
  agents run the migration autonomously with a machine-enforced 100%-coverage guarantee

---

# TimesTen → Aeron Cluster Migration Harness

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

1. This repo root IS the harness root. Kiro picks up `AGENTS.md` automatically; the three
   custom agents live in `.kiro/agents/`.
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
