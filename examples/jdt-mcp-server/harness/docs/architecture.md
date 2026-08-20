# Architecture — JDT MCP Server

Structured around the **Fresh Session Test** (Lesson 3): a new agent session given only this repo
must be able to answer all five questions below. If it can't, the knowledge isn't in the repo yet
— add it here.

> **The design is approved.** `harness/loop/design-approval.json` (digest `c0a83df4b8d6c5b2`) records
> the human sign-off on `harness/docs/design/architecture.md`'s Option A. `harness/feature_list.json`
> is the cut from it — see its 32 features and `harness/DECISIONS.md`'s 2026-08-20 entries for the
> non-obvious splits (build-order enforced as DAG edges, the deferred HTTP front door, and where a
> falsifier borrows a citation from a neighboring component's invariant).

## What is this?

An MCP server that wraps Eclipse JDT Language Server, exposing Java code intelligence (diagnostics,
hover, completion, references, definition, rename, code actions) as MCP tools for AI coding agents.

**Primary user:** a stranger installing an OSS tool, not just its author — so packaging, first-run
behaviour and a clean public tool surface are v1 requirements, not polish.

**Core domain concepts.** A **workspace** is one Maven reactor root (the directory of the nearest
ancestor `pom.xml`); it owns exactly one JDT LS process and one `-data` index directory. The
**daemon** is one long-lived process per user holding several workspaces at once. A **shim** is the
short-lived stdio process an MCP client launches, which does nothing but relay to the daemon. A
**tool call** is always routed to a workspace by the file path in its arguments — never by a session.

The two facts that shape everything: JDT LS costs **434–952 MB resident per instance** even on a
two-file project, and it **does not watch the filesystem** — it answers from a stale model until the
client tells it a file changed. Both are measured; see `harness/docs/design/evidence.md`.

## How is it organized?

Ten components, their seams and their invariants are in `harness/docs/design/`. Dependency direction
runs strictly downward: transport never reaches past the tool layer, and nothing below the tool layer
knows MCP exists.

```
src/
  shim/        # stdio front end the MCP client launches; relays to the daemon
  daemon/      # supervisor: socket listener, single-instance lock, idle shutdown
  tools/       # MCP tool registration, argument validation, result shaping
  workspace/   # project-router, workspace-pool, readiness-gate, file-sync-watcher
  lsp/         # LSP client: Content-Length framing, correlation, diagnostics cache
  provision/   # JDT LS distribution resolution + JVM version check
spikes/        # throwaway proofs, never imported by src/
```

## How do I run it?

```bash
./harness/init.sh          # install + verify + baseline gate
npx jdt-mcp                # what an MCP client is configured to launch (the shim)
jdt-mcp daemon status      # what is running, per workspace: state, pid, memory, last sync
```

## How do I verify it?

The three-level hierarchy is in `harness/docs/testing-standards.md`. Fast path:

```bash
npm test                   # unit + component, against fake LSP servers
npm run test:integration   # cross-process: shim ↔ daemon ↔ a real JDT LS on a fixture project
```

`./harness/init.sh` is the full baseline gate. The integration tier is not optional here: three of
the four most likely causes of failure in the premortem (`harness/docs/design/critique.md`) live in
the seams *between* processes, where no unit test reaches.

## Where are we now? (current state)

Live status is in `harness/progress.md` and `harness/feature_list.json`. This section holds only the
stable architectural picture; day-to-day state does not belong here.

The build order is not arbitrary and is enforced as real feature dependencies, not just prose:
`jdtls-provisioner` → `project-router`/`lsp-client` → `workspace-pool` → `file-sync-watcher` +
`readiness-gate` (both **before** any capability tool — a tool built earlier returns confidently
wrong, well-formed answers, per spike C) → navigation tools (`java_hover`/`definition`/`references`)
→ `java_diagnostics` → `java_completion` → `java_rename` → `java_code_actions` +
`java_apply_code_action` **last** (the only tool with server-side state and a two-phase protocol).
`mcp-shim`/`daemon-supervisor` sit off to the side of that chain — they wrap the pool once it exists
but do not gate tool development, since `mcp-tool-layer` is a pure function of an injected
`LspFacade`. The Streamable HTTP front door (`A-003`) is confirmed for v1 but not yet cut into a
feature: its `Origin`/localhost/auth invariants (`docs/cross-cutting.md` X-010) are still open — see
`DECISIONS.md`.
