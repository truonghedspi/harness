# Logic Inventory — how "100%" is defined and enforced

A 100%-coverage claim is only meaningful against a machine-extracted denominator. Humans and
agents forget objects; system catalogs don't. The inventory is that denominator.

## What counts as logic

1. **PL/SQL units** — procedures, functions, packages (spec + body)
2. **Views and materialized views** — a view's SELECT is logic; materialized-view refresh
   semantics are logic
3. **Check constraints and column defaults** with business meaning
4. **Sequences** — including how gaps and ordering are relied upon
5. **Cache group definitions** and aging policies (TimesTen-specific)
6. **Scheduled / background jobs** and any daemon-driven behavior
7. **Application-side logic (Java/Spring Boot)** — part of the business logic lives in Java
   service code that calls down into TimesTen procedures. None of it appears in database
   catalogs. Two kinds of app-side units, both inventoried from the repositories listed in
   `inventory/sources.yaml`:
   - `java-service` — a Spring service method / endpoint containing business logic
     (validation, branching, orchestration of one or more proc calls, post-processing).
     Extraction: scan for `CallableStatement`, `SimpleJdbcCall`, `{call …}`,
     `@Procedure`, `JdbcTemplate`, native `@Query`, MyBatis mappers — then walk up to the
     public service/controller method that owns the flow. Record `calls: [proc unitIds]` as
     cross-layer dependency edges.
   - `app-sql` — plain embedded SQL statements with business meaning
   The Java→proc call graph matters twice: it defines migration unit boundaries (see
   docs/00 §Unit sizing) and it tells you which procs are only ever reached through one
   Java flow
8. **Triggers, if present** — many TimesTen deployments have none; verify against your
   version and configuration rather than assuming either way

## Extraction

Agents extract directly through the TimesTen MCP server named in `inventory/sources.yaml`
(configured in .kiro/settings/mcp.json; treat it as READ-ONLY — SELECT and dictionary queries
only, never DML/DDL). `tools/extract-inventory.sql` is the query catalog: run its sections
through the MCP server, or via `ttIsql` as a human-run fallback. Transform the results into
`inventory/inventory.json`:

```json
{
  "extractedAt": "2026-07-19T00:00:00Z",
  "units": [
    {
      "unitId": "APP.PKG_SETTLEMENT.CALC_FEE",
      "type": "function",
      "owner": "APP",
      "sourceHash": "sha256:…",
      "dependsOn": ["APP.PKG_REFDATA.GET_FEE_SCHEDULE"],
      "loc": 142
    }
  ]
}
```

`sourceHash` is the SHA-256 of the unit's normalized source text (whitespace-collapsed).
Never hand-edit inventory.json; if it is wrong, fix the extraction script and re-run.

Dictionary view availability differs across TimesTen versions — verify each query in the SQL
file; where a view is missing, use the `ttIsql` built-in commands noted in its comments.

## Drift control

The project owner has declared TimesTen logic FROZEN for the duration of the migration
(`logic_frozen: true` in sources.yaml), so no periodic re-extraction cadence is needed.
The hash mechanism stays, because it is nearly free and freezes have a way of leaking:

- `sourceHashes` are still recorded on each feature at spec time.
- One mandatory full re-extraction runs before the Phase 4 shadow run;
  `tools/coverage-check.mjs` then proves the frozen assumption held. Any drifted unit it
  flags reopens to `specced` at best — that is the pre-cutover safety net.

## Exclusions

Dead code, DBA-only helpers, and monitoring conveniences may be excluded — but explicitly:

```json
{ "unitId": "APP.PKG_DEBUG.DUMP_STATE", "reason": "ops-only debug dump, no business logic",
  "proposedBy": "agent", "approvedBy": "" }
```

`approvedBy` must be a human name. coverage-check fails on any exclusion without it. An
agent may propose an exclusion; it stays a coverage violation until a human approves.

## Coverage arithmetic

```
coverage = done units / (all inventory units − human-approved exclusions)
```

`init.sh` prints this every session via coverage-check. The migration is finished only when
this is 100% AND Phase 3 integration parity is green.
