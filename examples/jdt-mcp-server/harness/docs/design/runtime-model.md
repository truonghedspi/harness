# Design — runtime model: daemon, routing, pool, sync, readiness

How one daemon serves N Maven projects without lying to the agent. Facts cited in
`harness/docs/design/evidence.md`; option comparison in `harness/docs/design/architecture.md`.

## Process topology (Option A shape)

```
MCP client ──stdio──▶ jdt-mcp (shim, ~200 lines, one per client)
                          │  newline-delimited JSON-RPC over $XDG_RUNTIME_DIR/jdt-mcp.sock
                          ▼
                    jdt-mcp daemon (one per user)
                      ├── project-router · workspace-pool · readiness-gate
                      ├── file-sync-watcher · diagnostics-cache
                      └── lsp-client ×N ──Content-Length JSON-RPC over stdio──▶ JDT LS ×N
                                                                  (each: own -data dir, own JVM)
```

Two different framings meet in this picture and confusing them is the most likely early bug: the
**MCP** side is newline-delimited with no embedded newlines; the **LSP** side is `Content-Length`
headers. `lsp-client` owns the second, `mcp-shim` the first, and nothing else touches either.

## Workspace identity and routing

A "project" is **the directory of the nearest ancestor `pom.xml`** of the path in the tool call.
Not a caller-supplied session, and not "the last workspace used".

That is not a style preference. Spike B asked instance B about a file belonging to instance A and
got `[]` back — **an empty array, not an error**. A misroute is therefore indistinguishable from
"no references exist", and an agent will happily conclude the method is dead code and delete it.
Routing must be derived from the argument on every call so it cannot drift.

Multi-module Maven builds get one workspace at the **reactor root** (the outermost `pom.xml` with
`<modules>`), not one per module — JDT LS's own multi-root support is the known-weak path
(issue 1303: *"only one of them will work"*).

| Id | Component | Invariant — must hold for EVERY input | Observable seam |
|---|---|---|---|
| `INV-ROUTE-1` | `project-router` | A call is always answered by the instance whose project root is the nearest ancestor `pom.xml` directory of the path in that call — never by a sticky, cached or default instance | `resolveWorkspace(path)` return value compared against the pid that served the call |
| `INV-ROUTE-2` | `project-router` | A path with no ancestor `pom.xml` always yields an explicit error naming the path — never an empty successful result | tool result `isError` + message |
| `INV-ROUTE-3` | `project-router` | Two paths under the same reactor root always resolve to the same workspace id, and paths under different roots never do | `resolveWorkspace` over a fixture tree |

## The JDT LS pool

Measured floor: **434–952 MB resident per idle instance** on a *two-file* project, two instances
together **1766 MB**. Real repositories are commonly configured with 1–16 GB heaps. So the pool is
not an optimisation, it is the thing that stops the daemon from taking the machine down.

- One JDT LS process per workspace, each with its **own absolute `-data` directory** under a cache
  root, derived from a hash of the project root. `-data` is where the index lives; sharing one
  across workspaces corrupts both.
- A cap on live instances (`--max-workspaces`, default proposed in A-001). Over the cap, evict the
  least-recently-used **idle** workspace first.
- Eviction kills the process but **keeps** the `-data` directory: spike A measured warm restart at
  1.5 s versus 2.3 s cold on a trivial project, and the gap grows with project size. Deleting
  `-data` on eviction converts a 1.5 s resume into a possible 25-minute one.

| Id | Component | Invariant — must hold for EVERY input | Observable seam |
|---|---|---|---|
| `INV-POOL-1` | `workspace-pool` | Every live workspace has its own absolute `-data` directory and no two live workspaces ever share one | `pool.status()` `-data` paths + the spawned argv |
| `INV-POOL-2` | `workspace-pool` | The count of live JDT LS processes never exceeds the configured cap; a request beyond the cap always evicts an idle workspace first and never spawns over the cap | process count under a burst of calls across more projects than the cap |
| `INV-POOL-3` | `workspace-pool` | When a JDT LS process exits for any reason, every in-flight request routed to it completes with an error — it never hangs and never resolves with a partial answer | kill the child mid-request; assert every pending promise settles as an error within the deadline |
| `INV-POOL-4` | `workspace-pool` | Eviction never deletes the evicted workspace's `-data` directory | directory exists after `pool.status()` shows the workspace gone |
| `INV-POOL-5` | `workspace-pool` | A workspace is spawned at most once per identity: concurrent first calls for the same project produce one process, never two | pid count under N parallel first calls |

## Filesystem synchronisation — the correctness centre of this system

Spike C is the finding that most changes the design. Rewriting `Greeter.java` on disk to delete a
method, with no LSP notification, left JDT LS **still resolving the deleted method and reporting
zero errors**. One `workspace/didChangeWatchedFiles` and it corrected itself within 8 s.

**JDT LS does not watch the filesystem — the client does.** For an ordinary editor that is
invisible, because the editor is the thing making the edits. Here the editor is an AI agent writing
files directly, which is the exact case that produces a confidently wrong answer. A file watcher is
therefore a **v1-blocking component**, not a refinement.

Design: `file-sync-watcher` watches each workspace's source roots and `pom.xml`, debounces, emits
`workspace/didChangeWatchedFiles`, and publishes a `settledAt` marker. A tool call carries the
watcher's last-observed change generation; if the LSP view is behind it, the call waits for
quiescence within its deadline and otherwise fails as `resyncing` — it never answers from the old
model.

| Id | Component | Invariant — must hold for EVERY input | Observable seam |
|---|---|---|---|
| `INV-SYNC-1` | `file-sync-watcher` | No tool result is ever computed from a JDT LS view older than the last on-disk change observed in that workspace: the call either reflects the change or fails explicitly, never silently answers from the pre-edit model | edit a file on disk, immediately call a tool, assert the answer is either post-edit or an explicit `resyncing` error — the spike-C `2_afterSilentDiskEdit` state must be unreachable |
| `INV-SYNC-2` | `file-sync-watcher` | Every observed create, modify, delete and rename under a watched source root produces a `workspace/didChangeWatchedFiles` notification with the matching change type — no event class is silently dropped | captured LSP notification log against a scripted filesystem sequence |
| `INV-SYNC-3` | `file-sync-watcher` | A change to `pom.xml` always triggers a project-configuration refresh, never only a source-file notification | notification log after touching `pom.xml` |

## Readiness

`ProjectStatus: OK` and `ServiceReady` fired 13 ms apart and **before** the final workspace-refresh
progress notes, so neither is proof the index can answer. The gate is a **semantic probe**: resolve
a known symbol from the workspace's own sources and require a non-empty result.

Cold start ranged from 1.5 s (warm `-data`) to 4.2 s (first ever, downloading Maven plugins from
`repo.maven.apache.org`) on a two-file project, against a reported 25 minutes on a real one. So the
gate must be honest rather than fast: never a successful empty result while warming.

| Id | Component | Invariant — must hold for EVERY input | Observable seam |
|---|---|---|---|
| `INV-READY-1` | `readiness-gate` | A call against a workspace that is not index-ready never returns a successful empty or partial result; it waits within its deadline or returns an explicit not-ready error carrying progress | call during warm-up; assert `isError` + progress payload, never `[]` |
| `INV-READY-2` | `readiness-gate` | Readiness is decided by a semantic probe answering non-empty, never by `ServiceReady` or `ProjectStatus` alone | probe call recorded before the gate opens |
| `INV-READY-3` | `readiness-gate` | Every waiting call is released or failed within its deadline — no call waits unbounded on a workspace that never becomes ready | hold a workspace permanently warming; assert every call settles |

## Daemon lifecycle and the shim

| Id | Component | Invariant — must hold for EVERY input | Observable seam |
|---|---|---|---|
| `INV-SHIM-1` | `mcp-shim` | Nothing but single-line valid MCP messages ever reaches stdout; every log, warning and daemon-side line goes to stderr or a file | capture stdout during a session containing daemon errors; every line parses as one MCP message |
| `INV-SHIM-2` | `daemon-supervisor` | At most one daemon ever exists per socket path; concurrent shim starts converge on one daemon, never two | N parallel `jdt-mcp` launches; assert one daemon pid |
| `INV-SHIM-3` | `mcp-shim` | A daemon restart is invisible to the client except as errors on calls in flight at the moment of the restart: subsequent calls succeed with no client-side re-initialisation | kill the daemon mid-session; assert the next call succeeds |
| `INV-SHIM-4` | `daemon-supervisor` | Daemon shutdown always terminates every JDT LS child it spawned — no orphaned JVM survives it | process table after shutdown |
| `INV-PROV-1` | `jdtls-provisioner` | The server refuses to start with a named error when no JVM ≥ 21 is resolvable, rather than spawning JDT LS and failing opaquely | run with `JAVA_HOME` pointing at a Java 17 JDK; assert the message names the version |
| `INV-PROV-2` | `jdtls-provisioner` | The JDT LS distribution actually used is always the pinned version the build recorded, or an explicit user override — never "whatever was already in the cache" | `resolveInstall()` version against the pin, with a tampered cache |
| `INV-PROV-3` | `jdtls-provisioner` | When `JDTLS_HOME` is set, resolution always uses that directory and issues **no** network request on any path, success or failure; if it holds no resolvable JDT LS launcher jar the call always fails with an error naming the path and what was missing, and never falls back to the cache or to a download | `resolveInstall()` with `JDTLS_HOME` set and all egress stubbed to throw: assert `installDir` is the override and the outbound-request count is 0, in **both** the valid-install and invalid-install cases |
| `INV-PROV-4` | `jdtls-provisioner` | When no valid pinned install is cached and the distribution cannot be fetched, `resolveInstall()` always settles within its deadline with an explicit error naming the pinned version, the host it could not reach, and the `JDTLS_HOME` escape hatch — never an unbounded wait, never an opaque stack trace | empty cache root + blackholed egress: assert the call settles as an error inside the deadline and the message carries the pin, the host, and `JDTLS_HOME` |

**Why `INV-PROV-3` fails closed rather than falling back to the network.** The override exists for
exactly the machines that cannot fetch — air-gapped, or behind the corporate proxy that is premortem
cause 3 in `harness/docs/design/critique.md` §2. A silent fallback would fire precisely there,
converting a one-line configuration error into the opaque first-run failure the override was added
to prevent, and would make the effective install "whatever was already in the cache" — the thing
`INV-PROV-2` forbids. It also matches how this design treats every other ambiguous state:
`INV-ROUTE-2`, `INV-READY-1`, `INV-TOOL-4` and `INV-DIAG-1` all refuse to substitute a quiet
fallback for an explicit failure. Validity is the launcher jar being resolvable under `plugins/`
(`org.eclipse.jdt.ls.core_*`), the layout recorded in `harness/docs/design/evidence.md`.

`INV-PROV-4`'s "clear, actionable" is not a new error convention: naming the specific fact the user
must act on is `INV-PROV-1`'s named version, `INV-ROUTE-2`'s named path and `INV-TOOL-4`'s structured
taxonomy; settling inside a deadline instead of hanging is `INV-POOL-3` and `INV-READY-3`.
