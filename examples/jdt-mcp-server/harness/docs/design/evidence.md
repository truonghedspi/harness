# Evidence — claims table and spike index

Every factual claim the design rests on, with how it was checked. **Nothing here is "I recall
that…"** — each row is a quoted upstream document, a file in a real checkout on this machine, or a
spike that ran and whose output is reproduced. Contract: `harness/docs/reference/design-engineering.md`.

The spikes are throwaway (`spikes/`, never imported by production code). Reproduce with the commands
in [Spike index](#spike-index) below.

## Claims about Eclipse JDT LS

| Claim | Evidence |
|---|---|
| JDT LS requires a **Java 21+** runtime to run the server itself | upstream README, quoted: *"The language server requires a runtime environment of Java 21 (at a minimum) to run."* — https://github.com/eclipse-jdtls/eclipse.jdt.ls |
| Launch is `java … -jar plugins/org.eclipse.equinox.launcher_*.jar -configuration <dir> -data <abs path>`; `-data` is *"An absolute path to your data directory. eclipse.jdt.ls stores workspace specific information in it."* | upstream README + wiki *Running the JAVA LS server from the command line* |
| The distribution ships **platform-specific** `-configuration` directories and a separate lightweight syntax-server config | extracted snapshot lists `config_mac_arm config_mac config_linux config_linux_arm config_win` **and** `config_ss_*` (syntax server) — spike A install dir |
| Distribution size: **51 MB** compressed, **64 MB** extracted; version tested `org.eclipse.jdt.ls.core_1.61.0.202608141332` | `ls -la jdtls.tar.gz` → 51 030 767 bytes; `du -sh` → 64M; `ls plugins` |
| LSP over stdio frames messages with HTTP-style **`Content-Length:` headers** — *not* the framing MCP stdio uses | `spikes/jdtls-coldstart.mjs` implements `Content-Length` framing by hand and JDT LS answers; MCP stdio requires newline-delimited messages that *"MUST NOT contain embedded newlines"* (MCP spec, stdio binding) |
| JDT LS supports hover, completion, references, definition, rename, codeAction and publishDiagnostics | wiki *Language Server Protocol support* table (all ✔) **and** proven live in spike A — see the next four rows |
| All seven v1 capabilities answer correctly on a real Maven project | spike A output: hover `String spike.Greeter.greet(String name)`; definition → `Greeter.java:4`; `referenceCount: 2`; rename `greet`→`salute` produced a WorkspaceEdit touching **2 files**; `codeActionTitles: ["Inline Method"]`; spike B: `completionItemCount: 2`, `isIncomplete: false`; spike B diagnostics `"Type mismatch: cannot convert from String to int"` |
| **Code actions come back unresolved.** JDT LS returns actions with `edit: undefined`, `command: undefined`, `data: <opaque>`; a second `codeAction/resolve` round-trip fills in the edit | spike D output: every action had `hasEdit:false, hasCommand:false, hasData:true`; `RESOLVE gave edit: true` |
| **Diagnostics arrive as an unsolicited `textDocument/publishDiagnostics` notification**, including for files the client never `didOpen`ed | spike B planted `Broken.java` and never opened it; `diagnosticsB_forNeverOpenedBrokenFile: [["Type mismatch: cannot convert from String to int"]]` |
| **JDT LS does not watch the filesystem.** After rewriting `Greeter.java` on disk with no LSP notification, it still resolved the deleted method and reported **zero** errors; after one `workspace/didChangeWatchedFiles` it corrected within 8 s | spike C: `2_afterSilentDiskEdit_resolves: true`, `2_afterSilentDiskEdit_appErrors: []` → `3_afterDidChangeWatchedFiles_resolves: false`, `["The method greet(String) is undefined for the type Greeter"]` |
| Two instances with **separate `-data` dirs run concurrently and are isolated**; asking instance B about a file owned by instance A returns `[]` — **an empty result, not an error** | spike B: `definitionFromA: true`, `definitionFromB_aboutAsFile: "[]"` |
| Idle resident memory per instance at `-Xmx1G` on a **two-file** project: 434–952 MB; two concurrent instances = **1766 MB combined** | spike A `rssMbAtIdle` 952 (cold) / 434 (warm); spike B `rssMb {a:853, b:913, combined:1766}` |
| Start-to-usable on a two-file Maven project (M-series mac, warm `~/.m2`): `ProjectStatus: OK` at **2.3 s**, first correct project-symbol answer +0.5 s; warm restart reusing `-data` **1.5 s**; first-ever run (cold `~/.m2`) **4.2 s** and it downloads Maven plugins from `repo.maven.apache.org` during startup | spike A three runs; `statusNotes` show `…maven-resources-plugin-3.4.0.jar` fetches |
| Real-world cold starts are far worse: a **25-minute** startup report, and a *"Refreshing workspace"* job timing out after ~5 minutes on a project of *"several dozen plugins"* | https://github.com/redhat-developer/vscode-java/issues/4034 (closed); https://github.com/eclipse-jdtls/eclipse.jdt.ls/issues/2071 (closed) |
| Readiness signalling is the `language/status` extension; `ServiceStatus` = `Starting, Started, Message, Error, ServiceReady, ProjectStatus` | `org.eclipse.jdt.ls.core/src/org/eclipse/jdt/ls/core/internal/ServiceStatus.java` (upstream master) |
| `ProjectStatus: OK` and `ServiceReady` fire **13 ms apart and before** the final workspace-refresh progress notes | spike A cold run: `projectStatusOkMs: 2293`, `serviceReadyMs: 2306`, then `statusNotes` still show `100% … Refreshing '/spike-a/src/test/java'` |
| Multi-root workspaces are a known weak spot: *"When there are multiple invisible projects in a multi-root workspace, only one of them will work."* — open since 2019 | https://github.com/eclipse-jdtls/eclipse.jdt.ls/issues/1303 |
| **JDT LS's hover response never carries a `range`.** `HoverHandler.hover()` builds the reply as `Hover $ = new Hover(); $.setContents(content); return $;` — no `setRange` call exists anywhere on the path, and `JDTLanguageServer.hover()` only delegates (`return computeAsync((monitor) -> handler.hover(position, monitor));`), so nothing post-processes it. LSP4J leaves the unset `range` null and it is omitted on the wire. Raw LSP allows this: `Hover.range` is optional | `org.eclipse.jdt.ls.core/src/org/eclipse/jdt/ls/core/internal/handlers/HoverHandler.java:50-52` and `.../handlers/JDTLanguageServer.java:686-690`, read at tag `v1.60.0` (nearest tag to the pinned `1.61.0.202608141332` build) and **byte-identical to `master`** — `diff` reports no change, so this is not version drift. Spike A could not answer this: it printed only `hover.result.contents` and discarded the rest of the object |
| Hover content is only ever produced when an element actually resolved at that position: `computeHover` calls `JDTUtils.findElementsAtSelection(...)` and returns empty when it yields `null` or zero elements | `org.eclipse.jdt.ls.core/src/org/eclipse/jdt/ls/core/internal/HoverInfoProvider.java:104-107` at `v1.60.0` |
| JDT LS custom extensions are `language/status`, `java/classFileContents`, `language/actionableNotification`, `java/projectConfigurationUpdate` | wiki *Language Server Protocol Extensions* |

## Claims about MCP

| Claim | Evidence |
|---|---|
| **stdio**: *"the client launches the MCP server as a subprocess"*; messages are newline-delimited and *"MUST NOT contain embedded newlines"*; the server *"MUST NOT write anything to its stdout that is not a valid MCP message"* | MCP spec 2026-07-28, stdio binding |
| **Streamable HTTP**: *"the server operates as an independent process that can handle multiple client connections"* | MCP spec 2026-07-28, Streamable HTTP binding |
| The spec **blesses a Unix-socket daemon channel**: *"Custom transports that run over a reliable bidirectional byte stream (e.g., Unix domain sockets or TCP) SHOULD reuse the stdio framing … only its process-lifecycle rules are specific to standard streams."* | MCP spec 2026-07-28, transports overview |
| Streamable HTTP servers **MUST** validate `Origin` (403 otherwise) and **SHOULD** bind only to localhost | MCP spec 2026-07-28, Streamable HTTP §Security |
| Revision 2026-07-28 **removed protocol-level sessions and the GET stream** from Streamable HTTP | MCP spec 2026-07-28 changelog box on the Streamable HTTP page |
| **The TypeScript SDK has not caught up to that revision.** `@modelcontextprotocol/sdk@1.30.0` reports `LATEST_PROTOCOL_VERSION = "2025-11-25"`, `SUPPORTED = [2025-11-25, 2025-06-18, 2025-03-26, 2024-11-05, 2024-10-07]` | `node -p` against the installed package — spike E |
| The TS SDK ships **both** `StdioServerTransport` and `StreamableHTTPServerTransport`, the latter with a stateless mode (`sessionIdGenerator: undefined`) | `dist/esm/server/stdio.d.ts`, `dist/esm/server/streamableHttp.d.ts` in the installed 1.30.0 package |
| MCP **Java** SDK is `io.modelcontextprotocol.sdk`, latest **2.0.1**; HTTP server transports are `server-servlet`, `mcp-spring-webflux`, `mcp-spring-webmvc`; stdio is in core; requires Java 17+ | https://repo1.maven.org/maven2/io/modelcontextprotocol/sdk/ listing + `mcp/maven-metadata.xml` (2.0.1) + SDK README |
| LSP4J latest is **1.0.0** (`org.eclipse.lsp4j`, Feb 2026) | https://repo1.maven.org/maven2/org/eclipse/lsp4j/org.eclipse.lsp4j/maven-metadata.xml |
| **Node has an LSP4J equivalent.** `vscode-jsonrpc@9.0.1` supplies `createMessageConnection`, `StreamMessageReader`, `StreamMessageWriter` (the `Content-Length` framing); `vscode-languageserver-protocol@3.18.2` supplies typed request objects for **every** method this design needs — `InitializeRequest, HoverRequest, CompletionRequest, ReferencesRequest, DefinitionRequest, RenameRequest, CodeActionRequest, CodeActionResolveRequest, PublishDiagnosticsNotification, DidChangeWatchedFilesNotification, ExecuteCommandRequest` — with **none missing** | spike E: installed both, enumerated exports; `missing: (none)` |

## Claims about prior art

| Claim | Evidence |
|---|---|
| `stephanj/LSP4J-MCP` — Java 21 + Maven + LSP4J + MCP Java SDK, 36 stars. Tools: `find_symbols`, `find_references`, `find_definition`, `document_symbols`, `find_interfaces_with_method`. **No** diagnostics, hover, completion, rename or code actions. Runs *"JDTLS as a subprocess"*, one instance | repo README, https://github.com/stephanj/LSP4J-MCP |
| `sunix/java-lsp-mcp-server` — Java 25 + Quarkus MCP + LSP4J, **HTTP** transport, explicitly WIP. Auto-installs JDT LS to `~/.local/share/…`. *"Single workspace support currently; the implementation tracks one active workspace path per JDTLS instance"* | repo README, https://github.com/sunix/java-lsp-mcp-server |
| **No prior art found covers the v1 scope** (all seven capabilities) or serves multiple projects concurrently from one daemon | the two rows above, plus `SachieWang/java-jdtls-mcp-server`, `Kicey/jdtls-mcp`, and the generic bridges `jonrad/lsp-mcp`, `ProfessioneIT/lsp-mcp-server`, `Tritlo/lsp-mcp` — none advertise the full set |
| **Even the Java implementations run JDT LS as a separate subprocess.** Writing the server in Java does not co-locate it with JDT LS | `stephanj/LSP4J-MCP` README ("Starts JDTLS as a subprocess"); `sunix/java-lsp-mcp-server` README ("process lifecycle management — start, monitor status, graceful shutdown") |

## Environment this was measured on

Apple silicon (`arm64`), macOS 26.5.2, 32 GB RAM, `openjdk 25.0.3 Temurin`, `node v22.14.0`,
**no `mvn` on PATH** (JDT LS resolved the Maven model itself via its embedded m2e).

## Spike index

| Spike | File | Question it settles |
|---|---|---|
| A | `spikes/jdtls-coldstart.mjs` | cold/warm start latency, idle RSS, and that all of hover/definition/references/rename/codeAction answer correctly |
| B | `spikes/jdtls-two-projects.mjs` | two concurrent instances are isolated; combined memory; diagnostics arrive as push notifications for never-opened files; completion works |
| C | `spikes/jdtls-disk-sync.mjs` | **the staleness question** — JDT LS ignores on-disk edits until told |
| D | ad-hoc (reproduce by adding `codeAction/resolve` to spike A) | code actions come back unresolved and need a second round-trip |
| E | `npm i @modelcontextprotocol/sdk` + `node -p` | SDK version, transports, protocol revision lag |

```bash
# fetch a JDT LS distribution, then:
node spikes/jdtls-coldstart.mjs  <jdtls-dir> <maven-project> --data /tmp/d1
node spikes/jdtls-two-projects.mjs <jdtls-dir> <projA> <projB> /tmp/dtwo
node spikes/jdtls-disk-sync.mjs  <jdtls-dir> <maven-project> /tmp/dsync
```
