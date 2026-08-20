# Cross-cutting decision register — JDT MCP Server

Cross-cutting concerns fail differently from assumptions, so they get their own register
(`harness/docs/reference/design-engineering.md`):

- **Assumption** (`harness/docs/assumptions.md`) = "I believe X but haven't checked" → if wrong, a
  conclusion **flips**. Cured by verifying it.
- **Cross-cutting decision** (this file) = "someone must choose a policy" → if unowned, it gets
  decided **by accident** by whichever feature touches it first, and every later feature inherits
  it. Cured by an owner plus a rule that enforces the choice mechanically.

A row counts as **closed** only when all three of these are filled: the chosen mechanism, who chose
it and when, and the rule or gate that stops a future feature from silently doing something else.
A stub row ("not yet decided") is tracked, not closed — `harness/tools/cross-cutting-audit.mjs` reports it
as `open-decision`, which is a better state than unnoticed but is still open.

Find candidates with `node harness/tools/cross-cutting-audit.mjs --target .`. That audit reads breadth
(AI-strong: it never tires of reading every file); **choosing the policy is a human trade-off**
(AI-weak) — the agent surfaces and enumerates, you decide.

All rows below are **open** — surfaced by the design session on 2026-08-19 with a recommendation
attached, waiting on the human who owns the trade-off. `node harness/tools/cross-cutting-audit.mjs
--target .` reports them as `open-decision`, which is the correct state until someone chooses.

| id | Concern | Chosen mechanism | Owner / date | Enforced by | Inherited by |
|---|---|---|---|---|---|
| X-001 | **Timeout / deadline budget** for a tool call — the audit already flags `timeout` vs `deadline` in fragmented use | *open.* Recommend: one **deadline** carried per call (absolute instant, not a duration), defaulting to 30 s, propagated into the readiness wait, the LSP request and the resync wait so they cannot sum past it | — | — | `readiness-gate`, `lsp-client`, `mcp-tool-layer`, `INV-READY-3` |
| X-002 | **Concurrency model inside the daemon** — the audit flags `thread`/`concurren`/`lock`/`single-threaded` in fragmented use | *open.* Recommend: **one in-flight LSP request per workspace, queued**, until A-007 is settled by a spike; the daemon itself stays single-threaded Node with per-workspace queues | — | — | `workspace-pool`, `lsp-client`, A-007 |
| X-003 | **Failure reporting** — how a tool call says it failed | *open.* Recommend: a closed taxonomy (`unroutable`, `not-ready`, `resyncing`, `workspace-crashed`, `cap-exceeded`, `invalid-position`) returned as a structured MCP error; an empty successful result is never a failure encoding | — | — | `mcp-tool-layer`, `INV-TOOL-4` |
| X-004 | **Observability** — where logs go, given stdout is protocol | *open.* Recommend: daemon logs to a rotating file under the cache dir; the shim logs to **stderr only**; nothing but MCP messages ever reaches stdout | — | — | `mcp-shim`, `daemon-supervisor`, `INV-SHIM-1` |
| X-005 | **Workspace identity** — the key everything is filed under | *open.* Recommend: absolute realpath of the reactor-root directory, hashed for the `-data` path; symlinks resolved before hashing so two paths to one project are one workspace | — | — | `project-router`, `workspace-pool`, `INV-ROUTE-3`, `INV-POOL-1` |
| X-006 | **Disk retention** of `-data` index directories | *open.* Recommend: keep on eviction (`INV-POOL-4`), garbage-collect directories untouched for 30 days, and expose `jdt-mcp cache clear`. Index dirs grow without bound otherwise | — | — | `workspace-pool`, `jdtls-provisioner` |
| X-007 | **Source position coordinate system** in every tool result | *open.* Recommend: **1-based line and column**, converted from LSP's 0-based UTF-16 positions at exactly one boundary, and documented in the tool descriptions. Everything else an LLM reads about source — compiler errors, `grep -n`, stack traces — is 1-based, and a mixed convention produces off-by-one edits that look like model error | — | — | `mcp-tool-layer`, `INV-TOOL-1` |
| X-008 | **Result size caps** for list-returning tools | *open.* Recommend: default 200 items, `truncated: true` plus the true total whenever the cap bites, configurable per call up to a hard ceiling | — | — | `mcp-tool-layer`, `INV-TOOL-3` |
| X-009 | **Retry** of a tool call after a workspace crash | *open.* Recommend: the daemon retries **once**, transparently, after respawning the workspace; anything beyond that is the agent's decision and must surface as `workspace-crashed` | — | — | `workspace-pool`, `INV-POOL-3`, X-003 |
| X-010 | **Auth / network exposure** if the HTTP front door ships (A-003) | *open.* Recommend: bind 127.0.0.1 only, validate `Origin` with 403 (both are spec MUST/SHOULD), and require a token when bound to anything else | — | — | `daemon-supervisor` |
