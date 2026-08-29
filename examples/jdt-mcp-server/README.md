# JDT MCP Server

MCP server bọc **Eclipse JDT Language Server**, phơi bày trí tuệ mã nguồn Java (diagnostics, hover,
completion, references, definition, rename, code actions) dưới dạng **MCP tools** cho AI coding agent.

> **Trạng thái:** 36/36 feature đã hoàn tất và qua kiểm chứng (unit + integration + mutant). Xem mục
> [Trạng thái](#trạng-thái) về việc phần nối dây CLI còn là việc còn lại.

## Mục lục

- [Kiến trúc](#kiến-trúc)
- [Sử dụng qua MCP](#sử-dụng-qua-mcp)
- [Các tool](#các-tool)
- [Hình dạng kết quả](#hình-dạng-kết-quả)
- [Mã lỗi](#mã-lỗi)
- [Hành vi cốt lõi](#hành-vi-cốt-lõi)
- [Yêu cầu hệ thống](#yêu-cầu-hệ-thống)
- [Cấu hình](#cấu-hình)
- [Chạy thử](#chạy-thử)
- [Bố cục mã nguồn](#bố-cục-mã-nguồn)
- [Phát triển](#phát-triển)
- [Trạng thái](#trạng-thái)

## Kiến trúc

```
MCP client ──stdio──▶ mcp-shim ──unix socket──▶ daemon ──▶ per-workspace JDT LS pool
                         │                        │
                         └─ connect-or-spawn ─────┘ (single instance, auto-spawn)
```

- **`mcp-shim`** — front end stdio. Chỉ những message MCP hợp lệ được phép ra stdout; mọi thứ khác đi
  stderr. Nếu chưa có daemon phục vụ socket, shim tự sinh daemon (vai `daemon`); nếu đã có, nó nối vào
  (vai `delegated`).
- **`daemon`** — lắng nghe Unix socket, giữ **một tiến trình JDT LS cho mỗi workspace** (pool, LRU-idle,
  cap mặc định 3).
- **`file-sync-watcher`** — theo dõi `src/main/java`, `src/test/java` và `pom.xml`; đẩy
  `workspace/didChangeWatchedFiles` cho JDT LS. Đây là thứ JDT LS không tự làm (spike C: nó trả lời từ
  model cũ tới khi được báo).
- **`readiness-gate`** — cổng sẵn sàng bằng **semantic probe** (resolve một symbol có thật từ chính
  nguồn của workspace), không tin `ServiceReady`/`ProjectStatus`.

## Sử dụng qua MCP

Server nói **MCP qua stdio**, mỗi message là **một dòng JSON** (newline-delimited). Vòng đời chuẩn:

1. `initialize` — bắt tay, client khai báo capability.
2. `tools/list` — khám phá 8 tool.
3. `tools/call` — gọi một tool với `{ name, arguments }`; kết quả nằm trong
   `content[0].text` (chuỗi JSON), kèm cờ `isError`.

```jsonc
// → client gửi
{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"my-agent","version":"0"}}}

// → client gọi java_definition
{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"java_definition","arguments":{"path":"src/main/java/com/acme/Greeter.java","line":5,"column":10}}}

// ← server trả lời
{"jsonrpc":"2.0","id":2,"result":{"content":[{"type":"text","text":"{\"path\":\"...\",\"workspaceId\":\"...\",\"position\":{\"line\":5,\"column\":10},\"resolved\":true,\"locations\":[{\"path\":\"...\",\"range\":{\"start\":{\"line\":3,\"column\":19},\"end\":{\"line\":3,\"column\":24}}}]}"}],"isError":false}}
```

## Các tool

Mọi vị trí `path/line/column` đều ở hệ toạ độ **1-based** (dòng 1 là dòng đầu tiên, cột 1 là ký tự
đầu tiên; cột đếm bằng UTF-16 code unit — X-007). `path` nhận đường dẫn tệp thật trên đĩa.

| Tool | Tham số | Trả về |
|---|---|---|
| `java_hover` | `path`, `line`, `column` | signature + javadoc + `range` định vị token đã giải |
| `java_definition` | `path`, `line`, `column` | vị trí khai báo (có thể nhiều) |
| `java_references` | `path`, `line`, `column`, `includeDeclaration?` | danh sách vị trí tham chiếu, **capped** |
| `java_completion` | `path`, `line`, `column` | danh sách completion item, **capped** |
| `java_diagnostics` | `path` (tệp **hoặc** gốc project) | payload `publishDiagnostics` gần nhất |
| `java_rename` | `path`, `line`, `column`, `newName`, `apply?` | WorkspaceEdit đề xuất **dưới dạng dữ liệu** |
| `java_code_actions` | `path`, `line`, `column` | các action dạng **handle mờ đục** (`actionId`) |
| `java_apply_code_action` | `actionId`, `apply?` | edit đã resolve của action đó |

## Hình dạng kết quả

Kết quả mỗi tool là một object JSON (được chuỗi hoá vào `content[0].text`). `range` luôn là
`{ start: { line, column }, end: { line, column } }` ở hệ 1-based.

**`java_hover`**
```jsonc
{ "path": "...", "workspaceId": "...", "position": { "line": 5, "column": 10 },
  "resolved": true,
  "signature": "String greet(String)", "javadoc": "...", "contents": "...",
  "range": { "start": { "line": 3, "column": 19 }, "end": { "line": 3, "column": 24 } } }
// hoặc khi không giải được phần tử nào:
{ "path": "...", "workspaceId": "...", "position": { "line": 5, "column": 10 }, "resolved": false, "reason": "..." }
```

**`java_definition`**
```jsonc
{ "path": "...", "workspaceId": "...", "position": { "line": 5, "column": 10 },
  "resolved": true,
  "locations": [ { "path": "...", "range": { "start": { "line": 3, "column": 19 }, "end": { "line": 3, "column": 24 } } } ] }
// hoặc { "resolved": false, "locations": [], "reason": "..." }
```

**`java_references` / `java_completion`** — cùng bộ `cap` / `total` / `truncated`:
```jsonc
{ "path": "...", "workspaceId": "...", "position": { "line": 5, "column": 10 },
  "cap": 200, "total": 512, "truncated": true,
  "references": [ { "path": "...", "range": { "start": { "line": 1, "column": 5 }, "end": { "line": 1, "column": 10 } } } ] }
// java_completion thay `references` bằng:
  "items": [ { "label": "someMethod", "detail": "...", "range": { "start": { "line": 1, "column": 1 }, "end": { "line": 1, "column": 5 } } } ]
```

**`java_diagnostics`** — nhánh `reported` có `problems`, nhánh `not-reported` **không có** `problems`:
```jsonc
{ "path": "...", "workspaceId": "...", "scope": "file",
  "files": [ { "uri": "file:///...", "status": "reported",
               "problems": [ { "range": { "start": { "line": 4, "column": 13 }, "end": { "line": 4, "column": 19 } }, "message": "Type mismatch: cannot convert from String to int", "severity": 1 } ],
               "receivedAt": 1730000000000 } ] }
// tệp chưa từng có publish:
  "files": [ { "uri": "file:///...", "status": "not-reported" } ]
```

**`java_rename` / `java_apply_code_action`** — `applied` là `true` đúng khi `apply: true` được truyền:
```jsonc
{ "path": "...", "workspaceId": "...", "position": { "line": 3, "column": 19 }, "newName": "salute",
  "applied": false,
  "files": [ { "path": "...", "edits": [ { "range": { "start": { "line": 3, "column": 19 }, "end": { "line": 3, "column": 24 } }, "newText": "salute" } ] } ] }
```

**`java_code_actions`** — caller chỉ thấy `title` + `actionId` (blob nội bộ của JDT LS không lọt ra ngoài):
```jsonc
{ "path": "...", "workspaceId": "...", "position": { "line": 4, "column": 13 },
  "actions": [ { "title": "Organize imports", "actionId": "ca-1" }, { "title": "Generate toString()", "actionId": "ca-2" } ] }
```

## Mã lỗi

Mọi thất bại là một envelope có cấu trúc — không bao giờ bị mã hoá thành kết quả rỗng thành công
(INV-TOOL-4). Taxonomy đóng (X-003):

```jsonc
{ "isError": true, "code": "not-ready", "message": "not-ready: workspace ... cannot answer: ..." }
```

| `code` | Nghĩa | Khi nào gặp |
|---|---|---|
| `unroutable` | đường dẫn không thuộc workspace nào / không đọc được | path sai, tệp không đọc được |
| `not-ready` | workspace chưa index xong | gọi ngay sau khi workspace mở (warm-up) |
| `resyncing` | workspace đang cập nhật sau khi file đổi trên đĩa | gọi quá sớm sau khi sửa file — thử lại sau |
| `workspace-crashed` | tiến trình JDT LS đã chết | JDT LS process exit giữa chừng |
| `cap-exceeded` | vượt cap workspace đồng thời (mặc định 3) | quá nhiều workspace cùng lúc |
| `invalid-position` | `line`/`column` ngoài phạm vi file | toạ độ vượt số dòng/cột thật |

## Hành vi cốt lõi

- **Không bao giờ trả lời từ view cũ (INV-SYNC-1).** Sau khi agent sửa file trên đĩa, lời gọi tool
  tiếp theo hoặc phản ánh thay đổi, hoặc trả lỗi `resyncing` — không bao giờ âm thầm trả lời từ model
  cũ. Cơ chế: tool call mang generation của watcher; nếu LSP view đi sau, nó chờ quiescence rồi mới
  trả lời.
- **Mọi danh sách bị cắt đều tự khai (INV-TOOL-3).** `references`/`completion` vượt cap (mặc định 200,
  X-008) trả về `truncated: true` + `total` là tổng **thực trước khi cắt** — không cắt im lặng.
- **Tool đột biến mặc định KHÔNG ghi đĩa (INV-TOOL-2 / A-002).** `java_rename` và
  `java_apply_code_action` trả edit dưới dạng dữ liệu; chỉ ghi khi lời gọi mang `apply: true` (opt-in
  theo từng lời gọi, không phải sự hiện diện của khoá).
- **Handle code action bị trói vào sync generation (INV-CA-1).** `actionId` đúc trước một lần sửa sẽ
  lỗi khi resolve sau lần sửa — không bao giờ áp edit tính trên mã nguồn đã đổi.
- **Diagnostics không lẫn giữa các workspace (INV-DIAG-3).** Cache khoá theo `(workspaceId, URI)`.

## Yêu cầu hệ thống

- **Node.js ≥ 22.6.0** (dùng `--experimental-strip-types` để chạy TypeScript trực tiếp).
- **Java 21+** (yêu cầu của JDT LS). `JAVA_HOME` trỏ tới JDK ≥ 21.
- Lần chạy đầu tiên **tải và ghim** bản JDT LS (`download.eclipse.org`); có thể trỏ sẵn qua
  `JDTLS_HOME` để bỏ qua mạng (xem [Cấu hình](#cấu-hình)).

## Cấu hình

Biến môi trường:

| Biến | Ý nghĩa |
|---|---|
| `JAVA_HOME` | JDK ≥ 21 dùng để chạy JDT LS |
| `JDTLS_HOME` | Thư mục JDT LS đã cài sẵn (bỏ qua download; phải có `plugins/org.eclipse.jdt.ls.core_<version>.jar`) |
| `XDG_RUNTIME_DIR` | Thư mục chứa Unix socket (`jdt-mcp.sock`) |

**Cap danh sách** (`references`/`completion`) là **cấu hình phía server** (trường `cap` trong options
của tool, mặc định 200) — không phải tham số mà MCP caller truyền theo từng lời gọi. X-008 vẫn mở nên
200 là khuyến nghị, không phải hằng số chốt.

## Bố cục mã nguồn

| Đường dẫn | Vai trò |
|---|---|
| `src/shim/` | front end stdio (`mcp-shim`) |
| `src/daemon/` | socket listener + single-instance lock (`daemon-supervisor`) |
| `src/workspace/` | `project-router`, `workspace-pool`, `readiness-gate`, `file-sync-watcher`, `sync-guard` |
| `src/lsp/` | `lsp-client` (Content-Length framing + notification), `diagnostics-cache` |
| `src/tools/` | 8 tool + `tool-layer` (xác thực, chuyển toạ độ, taxonomy lỗi), `code-action-store` |
| `src/provision/` | tải/ghim JDT LS + kiểm checksum (`jdtls-provisioner`, `resolve-install`) |
| `test/` | oracle unit + integration (Level 1/3) |
| `harness/` | vòng lặp maker–checker, thiết kế, tài liệu thiết kế |

## Chạy thử

```bash
# 1. Cài dependencies (chỉ @types/node + typescript cho dev)
npm install

# 2. Trỏ JDT LS đã cài sẵn (bỏ qua download lần đầu)
export JDTLS_HOME=/path/to/jdtls   # thư mục chứa plugins/org.eclipse.jdt.ls.core_*.jar
export JAVA_HOME=/path/to/jdk21    # JDK ≥ 21

# 3. Chạy server (stdio MCP)
npm start
```

Server in `jdt-mcp-server ready (role=daemon, socket=...)` ra stderr; client nói MCP qua stdin/stdout.
Để nối vào Claude Code / MCP client, thêm vào cấu hình MCP:

```json
{ "mcpServers": { "jdt-mcp-server": { "command": "node", "args": ["--experimental-strip-types", "/đường/dẫn/src/cli.ts"] } } }
```

Ví dụ gọi `java_definition` (xem [Sử dụng qua MCP](#sử-dụng-qua-mcp)):

```jsonc
{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"java_definition","arguments":{"path":"src/main/java/com/acme/App.java","line":5,"column":10}}}
```

## Phát triển

```bash
npm test                                          # unit suite (lsp + workspace + tools)
npm run test:integration                          # toàn bộ test, kể cả integration Level 3
node harness/init.mjs                             # baseline gate (install fixture + baseline test)
```

> Trên macOS, test `daemon-lifecycle` đọc bảng tiến trình bằng `ps`; nếu chạy trong sandbox chặn `ps`
> (lỗi `EPERM`), hãy chạy với quyền đầy đủ — `TCON-SHIM-0003` khi đó xanh, và đó là giới hạn môi
> trường chứ không phải lỗi dự án.

## Trạng thái

- **36/36 feature hoàn tất** (`done`), router trả `exit`.
- Unit **159/159**, integration+unit đầy đủ **249/249** (với quyền đầy đủ cho `ps`).
- Mỗi tool/oracle đều có bằng chứng **mutant đỏ** (implementation sai bị oracle bắt) kèm trong
  `harness/feature_list.json`.
- **Entry point CLI đã có** (`src/cli.ts`, `npm start`, `bin.jdt-mcp-server`) — nối shim → daemon →
  8 tool, đã smoke-test `java_definition` end-to-end.

**Việc còn lại nếu muốn ship `npx`** — đóng gói npm: hiện chạy TypeScript trực tiếp qua
`node --experimental-strip-types` (không cần build), nên chưa có bước `tsc` → `dist/` cho một gói
publish. Hành vi đã được kiểm chứng end-to-end; chỉ còn phần đóng gói/distribution.
