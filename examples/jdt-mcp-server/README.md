# JDT MCP Server

MCP server wraps **Eclipse JDT Language Server**, exposing Java source code intelligence (diagnostics, hover,
completion, references, definition, rename, code actions) as **MCP tools** for AI coding agents.

> **Status:** 37/37 features are completed and tested (unit + integration + mutant). See entry
> [Status](#status) about whether the `npx` packaging is remaining.

## Table of contents

- [Architecture](#architecture)
- [Use via MCP](#use-via-mcp)
- [Tools](#tools)
- [Result shape](#result-shape)
- [Error code](#error-code)
- [Core behavior](#core-behavior)
- [System requirements](#system-requirements)
- [Configuration](#configuration)
- [Test run](#test-run)
- [MCP configuration for agent](#config-mcp-for-agent)
- [Source code layout](#source-code-layout)
- [Development](#development)
- [Status](#status)

## Architecture

```
MCP client ──stdio──▶ mcp-shim ──unix socket──▶ daemon ──▶ per-workspace JDT LS pool
                         │ │
                         └─ connect-or-spawn ─────┘ (single instance, auto-spawn)
```

- **`mcp-shim`** — front end stdio. Only valid MCP messages are allowed to stdout; everything is different
  stderr. If there is no daemon serving the socket, shim will automatically generate the daemon (as `daemon`); If it exists, it connects
  (role `delegated`).
- **`daemon`** — listens to Unix sockets, keeps **one JDT LS process per workspace** (pool, LRU-idle,
  default cap 3).
- **`file-sync-watcher`** — monitor `src/main/java`, `src/test/java` and `pom.xml`; push
  `workspace/didChangeWatchedFiles` for JDT LS. This is something JDT LS doesn't do on its own (spike C: it answers from
  old model until notified).
- **`readiness-gate`** — ready gate by **semantic probe** (resolves a real symbol from main
  workspace source), does not trust `ServiceReady`/`ProjectStatus`.

## Use via MCP

The server speaks **MCP via stdio**, each message is **a line of JSON** (newline-delimited). Standard life cycle:

1. `initialize` — handshake, client declares capability.
2. `tools/list` — explore 8 tools.
3. `tools/call` — call a tool with `{ name, arguments }`; The results are in
   `content[0].text` (JSON string), with `isError` flag.

```jsonc
// → client sends{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"my-agent","version":"0"}}}

// → client calls java_definition
{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"java_definition","arguments":{"path":"src/main/java/com/acme/Greeter.java","line":5,"column":10}}}

// ← server responds
{"jsonrpc":"2.0","id":2,"result":{"content":[{"type":"text","text":"{\"path\":\"...\",\"workspaceId\":\"...\",\"position\":{\"line\":5,\"column\":10},\"re solved\":true,\"locations\":[{\"path\":\"...\",\"range\":{\"start\":{\"line\":3,\"column\":19},\"end\":{\"line\":3,\"column\":24}}}]}"}],"isError":false}}
```

## Tools

All `path/line/column` positions are in **1-based** coordinate system (line 1 is the first line, column 1 is the character
first; count column in UTF-16 code unit — X-007). `path` gets the actual file path on disk.

| Tools | Parameters | Return |
|---|---|---|
| `java_hover` | `path`, `line`, `column` | signature + javadoc + `range` locate solved token |
| `java_definition` | `path`, `line`, `column` | declaration location (can be multiple) |
| `java_references` | `path`, `line`, `column`, `includeDeclaration?` | list of reference locations, **capped** |
| `java_completion` | `path`, `line`, `column` | completion item list, **capped** |
| `java_diagnostics` | `path` (project root **or** file) | payload `publishDiagnostics` closest |
| `java_rename` | `path`, `line`, `column`, `newName`, `apply?` | WorkspaceEdit recommends **as data** |
| `java_code_actions` | `path`, `line`, `column` | **opaque handle** (`actionId`) |
| `java_apply_code_action` | `actionId`, `apply?` | resolved edit of that action |

## Result shape

The result of each tool is a JSON object (serialized into `content[0].text`). `range` is always
`{ start: { line, column }, end: { line, column } }` in 1-based system.

**`java_hover`**
```jsonc
{ "path": "...", "workspaceId": "...", "position": { "line": 5, "column": 10 },
  "resolved": true,
  "signature": "String greet(String)", "javadoc": "...", "contents": "...",
  "range": { "start": { "line": 3, "column": 19 }, "end": { "line": 3, "column": 24 } } }// or when no element can be resolved:
{ "path": "...", "workspaceId": "...", "position": { "line": 5, "column": 10 }, "resolved": false, "reason": "..." }
```

**`java_definition`**
```jsonc
{ "path": "...", "workspaceId": "...", "position": { "line": 5, "column": 10 },
  "resolved": true,
  "locations": [ { "path": "...", "range": { "start": { "line": 3, "column": 19 }, "end": { "line": 3, "column": 24 } } } ] }
// or { "resolved": false, "locations": [], "reason": "..." }
```

**`java_references` / `java_completion`** — same set of `cap` / `total` / `truncated`:
```jsonc
{ "path": "...", "workspaceId": "...", "position": { "line": 5, "column": 10 },
  "cap": 200, "total": 512, "truncated": true,
  "references": [ { "path": "...", "range": { "start": { "line": 1, "column": 5 }, "end": { "line": 1, "column": 10 } } } ] }
// java_completion replace `references` with:
  "items": [ { "label": "someMethod", "detail": "...", "range": { "start": { "line": 1, "column": 1 }, "end": { "line": 1, "column": 5 } } } ]
```

**`java_diagnostics`** — branch `reported` has `problems`, branch `not-reported` **does not have** `problems`:
```jsonc
{ "path": "...", "workspaceId": "...", "scope": "file",
  "files": [ { "uri": "file:///...", "status": "reported",
               "problems": [ { "range": { "start": { "line": 4, "column": 13 }, "end": { "line": 4, "column": 19 } }, "message": "Type mismatch: cannot convert from String to int", "severity": 1 } ],
               "receivedAt": 1730000000000 } ] }
// file never exists publish:
  "files": [ { "uri": "file:///...", "status": "not-reported" } ]
```

**`java_rename` / `java_apply_code_action`** — `applied` is `true` true when `apply: true` is passed:
```jsonc
{ "path": "...", "workspaceId": "...", "position": { "line": 3, "column": 19 }, "newName": "salute",
  "applied": false,
  "files": [ { "path": "...", "edits": [ { "range": { "start": { "line": 3, "column": 19 }, "end": { "line": 3, "column": 24 } }, "newText": "salute" } ] } ] }
```

**`java_code_actions`** — caller only sees `title` + `actionId` (JDT LS internal blob does not leak out):
```jsonc
{ "path": "...", "workspaceId": "...", "position": { "line": 4, "column": 13 },"actions": [ { "title": "Organize imports", "actionId": "ca-1" }, { "title": "Generate toString()", "actionId": "ca-2" } ] }
```

## Error code

Every failure is a structured envelope — never encoded as an empty success
(INV-TOOL-4). Closed Taxonomy (X-003):

```jsonc
{ "isError": true, "code": "not-ready", "message": "not-ready: workspace ... cannot answer: ..." }
```

| `code` | Meaning | When to meet |
|---|---|---|
| `unroutable` | path does not belong to any workspace / cannot be read | path is wrong, file cannot be read |
| `not-ready` | workspace has not been indexed yet | Call immediately after the workspace opens (warm-up) |
| `resyncing` | workspace updating after file changes on disk | called too soon after editing the file — try again later |
| `workspace-crashed` | JDT LS process is dead | JDT LS process exits midway |
| `cap-exceeded` | exceed concurrent workspace cap (default 3) | too many workspaces at once |
| `invalid-position` | `line`/`column` outside file scope | coordinates exceed the actual number of rows/columns |

## Core behavior

- **Never respond from the old view (INV-SYNC-1).** After the agent edits the file on disk, the tool call
  next either reflects the change, or returns a `resyncing` error — never respond silently from the model
  old. Mechanism: tool call brings watcher generation; If the LSP view comes later, it waits for quiescence before proceeding
  reply.
- **All truncated lists are self-declared (INV-TOOL-3).** `references`/`completion` exceeds the cap (default 200,
  X-008) returns `truncated: true` + `total` is the **real total before truncation** — no silent truncation.
- **Default Mutation Tool DOES NOT write to disk (INV-TOOL-2 / A-002).** `java_rename` and
  `java_apply_code_action` returns edit as data; write only when the call carries `apply: true` (opt-in
  per call, not the presence of the key).
- **Handle code action is tied to sync generation (INV-CA-1).** `actionId` cast before a fix will
  Error when resolving after edit — never apply edit on changed source code.
- **Diagnostics does not mix between workspaces (INV-DIAG-3).** Cache key by `(workspaceId, URI)`.

## System requirements

- **Node.js ≥ 22.6.0** (use `--experimental-strip-types` to run TypeScript directly).- **Java 21+** (required by JDT LS). `JAVA_HOME` points to JDK ≥ 21.
- First run **download and pin** JDT LS version (`download.eclipse.org`); can be pointed to
  `JDTLS_HOME` to bypass the network (see [Configuration](#configuration)).

## Configuration

Environment variables:

| Variable | Meaning |
|---|---|
| `JAVA_HOME` | JDK ≥ 21 is used to run JDT LS |
| `JDTLS_HOME` | Pre-installed JDT LS folder (skip download; must have `plugins/org.eclipse.jdt.ls.core_<version>.jar`) |
| `XDG_RUNTIME_DIR` | Directory containing Unix socket (`jdt-mcp.sock`) |

**Cap list** (`references`/`completion`) is **server-side configuration** (`cap` field in options
of the tool, default 200) — not a parameter that the MCP caller passes with each call. X-008 is still open
200 is a recommendation, not a closing constant.

## Source code layout

| Path | Role |
|---|---|
| `src/shim/` | front end stdio (`mcp-shim`) |
| `src/daemon/` | socket listener + single-instance lock (`daemon-supervisor`) |
| `src/workspace/` | `project-router`, `workspace-pool`, `readiness-gate`, `file-sync-watcher`, `sync-guard` |
| `src/lsp/` | `lsp-client` (Content-Length framing + notification), `diagnostics-cache` |
| `src/tools/` | 8 tools + `tool-layer` (validation, coordinate conversion, error taxonomy), `code-action-store` |
| `src/provision/` | load/pin JDT LS + checksum (`jdtls-provisioner`, `resolve-install`) |
| `test/` | oracle unit + integration (Level 1/3) |
| `harness/` | maker–checker loop, design, design documentation |

## Test run

```bash
# 1. Install dependencies (only @types/node + typescript for dev)
npm install

#2a. Use JDT LS already vendored in the project (no network required)
export JDTLS_HOME="$PWD/jdtls"
#2b. Or point to a version installed elsewhere
# export JDTLS_HOME=/path/to/jdtls # directory containing plugins/org.eclipse.jdt.ls.core_*.jar
export JAVA_HOME=/path/to/jdk21 # JDK ≥ 21

# 3. Run the server (stdio MCP)
npm start
```

The preloaded JDT LS is located at `./jdtls/` (64 MB, gitignored). If you don't have one (new clone), run
`node harness/init.mjs` once to load + checksum into `.cache/`, then copy to `jdtls/` — or
Just leave `JDTLS_HOME` blank so that the server will load itself the first time it runs.Server prints `jdt-mcp-server ready (role=daemon, socket=...)` to stderr; client speaks to MCP via stdin/stdout.

## Configure MCP for agent

Three configuration files are available in the (committed) repo — each runtime reads one file, and all three must match
each other (gate `mcp-runtime-skew`):

| Runtime | File | Notes |
|---|---|---|
| Kiro | `.kiro/settings/mcp.json` | `mcpServers` form `{command, args, env}` |
| Claude Code | `.mcp.json` | add `"type": "stdio"` |
| Codex | `.codex/config.toml` | table `[mcp_servers.jdt-mcp-server]` (TOML) |

All three point to the same server:

```jsonc
// .kiro/settings/mcp.json and .mcp.json (Codex written in TOML, see .codex/config.toml)
{
  "mcpServers": {
    "jdt-mcp-server": {
      "command": "node",
      "args": ["--experimental-strip-types", "src/cli.ts"],
      "env": { "JDTLS_HOME": "./jdtls" }
    }
  }
}
```

`JDTLS_HOME: "./jdtls"` is a relative path — correct because MCP client spawn server with CWD = root
project (where the configuration file is located). If `env` is omitted, the server will automatically download JDT LS to `.cache/` the first time it is run.

**Codex needs one more line** (because `codex exec` non-interactive defaults to `approval_policy = never`,
while MCP tool defaults to "requires approval" → all calls are blocked):

```toml
# .codex/config.toml
[mcp_servers.jdt-mcp-server]
command = "node"
args = ["--experimental-strip-types", "src/cli.ts"]
env = { JDTLS_HOME = "./jdtls" }
default_tools_approval_mode = "approve" # 8 tools are all read-only by default (apply:true is written)
```

How to use: run the agent from the project root, it automatically loads the server according to its runtime configuration file.

```bash
cd examples/jdt-mcp-server
kiro # Kiro reads .kiro/settings/mcp.json
codex exec "run java_diagnostics for..." # Codex reads .codex/config.toml
```

Example calling `java_definition` (see [Using via MCP](#using-via-mcp)):

```jsonc
{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"java_definition","arguments":{"path":"src/main/java/com/acme/App.java","line":5,"column":10}}}
```

## Development

```bash
npm test # unit suite (lsp + workspace + tools)
npm run test:integration # all tests, including Level 3 integrationnode harness/init.mjs # baseline gate (install fixture + baseline test)
```

> On macOS, test `daemon-lifecycle` reading the progress table with `ps`; if run in a sandbox block `ps`
> (error `EPERM`), run with full permissions — `TCON-SHIM-0003` will appear, and that is the environmental limit
> field, not project error.

## Status

- **37/37 feature completed** (`done`), router returns `exit`.
- Unit **159/159**, full integration+unit **250/250** (with full permissions for `ps`).
- Each tool/oracle has **mutant red** evidence (wrong implementation caught by oracle) included
  `harness/feature_list.json`.
- **Entry point CLI already exists** (`src/cli.ts`, `npm start`, `bin.jdt-mcp-server`) — connect shim → daemon →
  8 tools, smoke-tested `java_definition` end-to-end.

**The rest if you want to ship `npx`** — npm packaging: now runs TypeScript directly through
`node --experimental-strip-types` (no build needed), so there is no `tsc` → `dist/` step for a package
publish. End-to-end proven behavior; Only packaging/distribution remains.