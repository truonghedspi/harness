# JDT MCP Server

MCP server bọc **Eclipse JDT Language Server**, phơi bày trí tuệ mã nguồn Java (diagnostics, hover,
completion, references, definition, rename, code actions) dưới dạng **MCP tools** cho AI coding agent.

> **Trạng thái:** 36/36 feature đã hoàn tất và qua kiểm chứng (unit + integration + mutant). Xem mục
> [Trạng thái](#trạng-thái) về việc phần nối dây CLI còn là việc còn lại.

## Mục lục

- [Kiến trúc](#kiến-trúc)
- [Các tool](#các-tool)
- [Hành vi cốt lõi](#hành-vi-cốt-lõi)
- [Yêu cầu hệ thống](#yêu-cầu-hệ-thống)
- [Cấu hình](#cấu-hình)
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

## Các tool

Mọi vị trí `path/line/column` đều ở hệ toạ độ **1-based** (dòng 1 là dòng đầu tiên, cột 1 là ký tự
đầu tiên; cột đếm bằng UTF-16 code unit — X-007).

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

Cap danh sách (references/completion) đọc từ tuỳ chọn lời gọi (`cap`), mặc định 200 — X-008 vẫn mở nên
đây là khuyến nghị, không phải hằng số chốt.

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

**Việc còn lại duy nhất** — phần nối dây CLI vận hành: bộ 8 tool đã đầy đủ và được chứng minh, nhưng
composition root sản phẩm (nối `mcp-shim` → `daemon` → `pool/router/readiness/sync` → các tool) hiện
được dựng trong oracle integration `test/integration/cross-process.integration.spec.ts`, chưa phải một
entry point `npm start` / `npx` đóng gói. Khi cần ship, việc còn lại là đưa chính đoạn nối dây đó vào
một CLI thật (`bin`) — hành vi của nó đã được kiểm chứng end-to-end.
