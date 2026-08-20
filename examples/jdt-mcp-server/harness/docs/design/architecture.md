# Design — JDT MCP Server architecture

Every factual claim below is cited in `harness/docs/design/evidence.md`; nothing here restates a
fact that is not in that table. The self-critique that stress-tests this design is in
`harness/docs/design/critique.md`, the runtime/concurrency detail in
`harness/docs/design/runtime-model.md`, the tool catalogue in `harness/docs/design/tool-surface.md`.

**Status: not approved.** Only a human writes `harness/loop/design-approval.json`.

## PrOACT frame

**Problem.** An MCP-capable agent working on Java has no semantic model of the code. JDT LS has one
but speaks LSP. Build the bridge, as a general-purpose OSS tool, with **all seven capabilities in
v1** (diagnostics, hover, completion, references, definition, rename, code actions), serving
**multiple Maven projects concurrently from one long-running daemon**. Gradle is deferred, recorded
not dropped. These four are settled constraints from the elicitation session on 2026-08-19, not
open questions.

**Objectives — yours to state and rank.** I have deliberately not weighted these. The candidates
this design exposes: first-run friction for a stranger installing the tool; answer *correctness*
under concurrent agent edits; memory ceiling on a developer laptop; contributor reach; how fast v1
ships; how much bespoke protocol plumbing you are willing to own.

**Alternatives — mine to generate.** Three below, argument-mapped. They separate along two axes
that are genuinely independent, and I want to be explicit that the axis you named (Node vs Java) is
**not** the one that decides the shape of this system.

| | Axis 1 — MCP-facing runtime | Axis 2 — how the client reaches the daemon |
|---|---|---|
| **A** | Node / TypeScript | thin stdio shim → Unix domain socket → shared daemon |
| **B** | Java / LSP4J + MCP Java SDK | Streamable HTTP daemon |
| **C** | Node / TypeScript | Streamable HTTP daemon |

**Consequences — mine, cited.** Below and in `evidence.md`.

**Tradeoffs — yours.** Named at the end of each option; I weigh them only in `critique.md` §Phase 5,
after the critique has earned it.

## Why axis 2 is the real decision

The requirement says *one daemon, many projects*. MCP stdio says *"the client launches the MCP
server as a subprocess"*. Those two sentences are in direct tension: a stdio server is, by
definition, per-client and per-launch. Streamable HTTP is the spec's own answer — *"the server
operates as an independent process that can handle multiple client connections"* — but it makes the
user start and address a daemon before anything works.

The escape hatch is in the spec itself: *"Custom transports that run over a reliable bidirectional
byte stream (e.g., Unix domain sockets or TCP) SHOULD reuse the stdio framing … only its
process-lifecycle rules are specific to standard streams."* A ~200-line stdio process that copies
frames to a socket is therefore a *sanctioned* transport, not a hack.

Axis 1 matters much less than it looks, for one measured reason: **JDT LS runs as a separate
subprocess either way.** It is an Equinox/OSGi product launched through a launcher jar, and both
Java prior-art projects subprocess it rather than embedding it. Writing the server in Java buys
LSP4J's typed LSP bindings — real, but a typing convenience, not co-location. And a Node server
still requires a JVM ≥ 21 on the machine, because JDT LS requires one. Neither runtime escapes the
JVM dependency.

## Option A — Node/TS daemon, stdio shim over a Unix socket

`npx jdt-mcp` is what the user configures, exactly like any stdio MCP server. That process is a
shim: it connects to `$XDG_RUNTIME_DIR/jdt-mcp.sock`, auto-spawning the daemon under a lock if
absent, and copies newline-delimited frames both ways. The daemon holds the JDT LS pool.

**Supports.** (a) It is the only one of the three that satisfies both hard constraints at once —
one shared daemon *and* a zero-configuration stdio install. (b) The socket framing is spec-endorsed
(evidence: transports overview). (c) `@modelcontextprotocol/sdk@1.30.0` ships `StdioServerTransport`
*and* `StreamableHTTPServerTransport`, so a real HTTP front door is additive later, not a rewrite.
(d) `npx` distribution is the lowest-friction install for a stranger; the 51 MB JDT LS payload is
fetched on first run rather than bundled. (e) The daemon outlives any one agent session, so the
2.3 s–25 min index warm-up is paid once per project, not once per session — which is the entire
economic argument for the daemon.

**Objections.** (a) It is a bespoke two-process topology nobody else in this ecosystem runs; you own
the reconnect, the single-instance lock, and the "daemon died mid-call" story yourself
(`INV-SHIM-2`, `INV-SHIM-3`). (b) Unix sockets mean **Windows needs a named pipe variant** — Node's
`net` API covers it, but the test matrix doubles (A-004). (c) Node has no LSP4J: the LSP client,
`Content-Length` framing and server→client request handling are hand-written — though spike A shows
that is ~120 lines, not a subsystem. (d) The SDK is one protocol revision behind the current spec
(`LATEST_PROTOCOL_VERSION = 2025-11-25`), so the shim must not build on session semantics that the
2026-07-28 revision already removed.

**Tradeoff axis it wins on:** first-run friction, while still meeting the daemon constraint.
**Axis it loses on:** bespoke plumbing you must maintain.

## Option B — Java daemon (LSP4J + MCP Java SDK), Streamable HTTP

The architecture `stephanj/LSP4J-MCP` already ships, scaled to N workspaces and all seven tools.

**Supports.** (a) LSP4J 1.0.0 gives typed LSP bindings and a JSON-RPC launcher — the library JDT LS
itself is built against, so protocol drift is absorbed upstream rather than by you. (b) MCP Java SDK
2.0.1 is current and, unlike the TS SDK, not a revision behind. (c) One language for a codebase
whose audience is Java developers — the contributor pool for an OSS Java tool is plausibly Java
people. (d) Streamable HTTP is the spec's sanctioned multi-client shape; no bespoke transport at all.
(e) Prior art proves the JDT-LS-driving half works in this stack.

**Objections.** (a) The Java runtime buys no co-location: both Java prior-art projects still
subprocess JDT LS, so your daemon JVM becomes a *third* JVM alongside N JDT LS JVMs, each already
holding 434–952 MB idle for a two-file project. (b) HTTP server transport means `server-servlet` or
Spring WebFlux/WebMVC — a container dependency for what is a localhost IPC channel. (c) The user
must start a daemon out-of-band and paste a URL into their client config: the highest first-run
friction of the three, against an explicit "general-purpose OSS tool for others" objective. (d) The
spec adds MUSTs you now own: `Origin` validation with 403, localhost-only binding, and
authentication. (e) Distribution is a JAR plus a JVM the user must already have.

**Tradeoff axis it wins on:** protocol-library maturity and contributor fit.
**Axis it loses on:** first-run friction and process weight.

## Option C — Node/TS daemon, Streamable HTTP only

Same daemon as A, minus the shim; clients connect over HTTP.

**Supports.** (a) Least bespoke code of the three — the daemon is an HTTP server and the SDK's
`StreamableHTTPServerTransport` already does the work, including a stateless mode. (b) Portable to
Windows with no named-pipe work. (c) Naturally extends to a remote/shared team daemon, which neither
A nor B does without redesign.

**Objections.** (a) It inherits B's worst property — the user must run a daemon before their agent
works. For an OSS tool aimed at strangers, a first run that fails until you read the README is the
single most common reason a tool is abandoned. (b) You own `Origin` validation, localhost binding
and auth (spec MUSTs). (c) Port selection and collision become user-visible configuration.

**Tradeoff axis it wins on:** least code, most standard.
**Axis it loses on:** first-run friction, which is the objective the OSS-audience constraint elevates.

## Components

Ten, each with an observable seam. Detail and invariants in `runtime-model.md` (routing, pool, sync,
readiness, provisioning) and `tool-surface.md` (tool layer, code actions).

| Component | Responsibility | Observable seam |
|---|---|---|
| `mcp-shim` | stdio front end; connect-or-spawn the daemon; copy frames | bytes on stdin/stdout — drive with recorded fixtures, assert bytes out |
| `daemon-supervisor` | socket listener, single-instance lock, idle self-shutdown | `jdt-mcp daemon status` → JSON; socket path existence |
| `mcp-tool-layer` | tool registration, argument validation, result shaping | `tools/list` output + `tools/call` results, as a pure function of an injected `LspFacade` |
| `project-router` | absolute path → workspace id (nearest ancestor `pom.xml`) | pure `resolveWorkspace(path) → {workspaceId, projectRoot} \| error` |
| `workspace-pool` | per-workspace JDT LS lifecycle, `-data` allocation, LRU eviction, cap | `pool.status()` → per-workspace `{state, pid, rssMb, lastUsed}` |
| `lsp-client` | `Content-Length` framing, id correlation, server→client requests | the framed byte stream, against a scripted fake LSP server |
| `diagnostics-cache` | absorb `publishDiagnostics`, key by URI per workspace | `getDiagnostics(uri \| projectRoot)` |
| `file-sync-watcher` | watch source trees, emit `workspace/didChangeWatchedFiles`, expose a quiescence point | emitted LSP notifications + `settledAt` timestamp |
| `readiness-gate` | hold tool calls until a semantic probe succeeds; report progress | `awaitReady(workspaceId, deadline)` result |
| `jdtls-provisioner` | locate/fetch/pin the JDT LS distribution; verify JVM ≥ 21 | `resolveInstall() → {installDir, version, javaPath}` |

## Feature impact

| Feature | Impact | Why |
|---|---|---|
| `feat-001` Baseline green | keep | still the baseline gate; needs Node deps + a JDT LS fixture download step added to `init.mjs` |
| `feat-002` (placeholder) | change | replaced by real features cut from the components above — the placeholder never described this system |
| `feat-003` (placeholder) | change | replaced; there is no microservice boundary here, but there **is** a cross-process one (shim ↔ daemon ↔ JDT LS) that deserves the same integration-level treatment |
| *(new)* `mcp-shim`, `daemon-supervisor`, `project-router`, `workspace-pool`, `lsp-client`, `diagnostics-cache`, `file-sync-watcher`, `readiness-gate`, `jdtls-provisioner`, `mcp-tool-layer` | new | one or more features each; the feature-planner owns the cut, and every `falsifier` must cite an `INV-` id from `runtime-model.md` or `tool-surface.md` |

The feature-planner owns `harness/feature_list.json`; this design does not edit it.

## Blast radius

Anything that changes **Axis 2** (shim+socket vs HTTP) rewrites `mcp-shim` and `daemon-supervisor`
and changes the install instructions, but leaves the seven components below the tool layer intact —
that is the point of putting the transport decision at the edge. Anything that changes **Axis 1**
(Node vs Java) rewrites everything. The `-data`-per-workspace decision is inherited by
`workspace-pool`, `jdtls-provisioner` and every disk-retention policy. The "return edits, do not
apply them" decision (A-002) is inherited by `java_rename` and every code-action tool.

Rejected alternatives are recorded in `harness/DECISIONS.md`.
