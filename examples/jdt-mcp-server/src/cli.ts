// cli — entry point vận hành: nối mcp-shim (stdio) với daemon (composition root) và 8 tool.
//
// Đây là phần nối dây sản phẩm còn thiếu trước đây (trước đó nó nằm trong
// test/integration/cross-process.integration.spec.ts). Một tiến trình vừa là shim (stdio front end)
// vừa là daemon (socket listener + tool routing) khi nó là kẻ đầu tiên giữ socket; các tiến trình sau
// nối vào daemon đó qua Unix socket.
//
// Chạy: node --experimental-strip-types src/cli.ts
// Client nói MCP qua stdio: mỗi message là một dòng JSON (newline-delimited).

import { readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { startShim } from "./shim/mcp-shim.ts";
import { createWorkspacePool, diagnosticsAttachment } from "./workspace/workspace-pool.ts";
import { resolveWorkspace } from "./workspace/project-router.ts";
import { createReadinessGate } from "./workspace/readiness-gate.ts";
import { attachFileSync } from "./workspace/file-sync-watcher.ts";
import { withSyncQuiescence } from "./workspace/sync-guard.ts";
import { createDiagnosticsCache } from "./lsp/diagnostics-cache.ts";
import { createCodeActionStore } from "./tools/code-action-store.ts";
import { definition } from "./tools/definition.ts";
import { javaHover } from "./tools/hover.ts";
import { references } from "./tools/references.ts";
import { javaCompletion } from "./tools/completion.ts";
import { javaDiagnostics } from "./tools/diagnostics.ts";
import { javaRename } from "./tools/rename.ts";
import { javaCodeActions } from "./tools/code-actions.ts";
import { javaApplyCodeAction } from "./tools/apply-code-action.ts";

const NEWLINE = "\n";
const READY_DEADLINE_MS = 120_000;
const SYNC_DEADLINE_MS = 20_000;
const cacheRoot = path.resolve(process.env.JDT_CACHE_ROOT ?? ".cache/jdt-mcp");

// -------------------------------------------------------------------------------------------
// Composition root — một lần cho toàn bộ tiến trình.
// -------------------------------------------------------------------------------------------

const watchers = new Map<string, ReturnType<typeof attachFileSync> extends never ? never : import("./workspace/file-sync-watcher.ts").FileSyncWatcher>();
const targets = new Map<string, { workspaceId: string; projectRoot: string; client: unknown }>();
const handshaken = new Set<string>();
const lastGeneration = new Map<string, number>();
const cache = createDiagnosticsCache();
const store = createCodeActionStore();

const pool = createWorkspacePool({
  cacheRoot,
  maxWorkspaces: 3,
  attachments: [
    attachFileSync({ onStarted: (ctx, watcher) => watchers.set(ctx.workspaceId, watcher) }),
    diagnosticsAttachment(cache),
  ],
});

const gate = createReadinessGate({ resolveTarget: (id) => targets.get(id) as never });

async function ensureHandshake(workspaceId: string, client: import("./lsp/lsp-client.ts").LspClient, projectRoot: string): Promise<void> {
  if (handshaken.has(workspaceId)) return;
  handshaken.add(workspaceId);
  client.onRequest("workspace/configuration", (params) => {
    const items = (params as { items?: unknown[] } | undefined)?.items;
    return Array.from({ length: Array.isArray(items) ? items.length : 0 }, () => ({}));
  });
  client.onRequest("client/registerCapability", () => null);
  client.onRequest("window/workDoneProgress/create", () => null);
  client.onNotification("language/status", (params) => {
    const note = params as { type?: unknown; message?: unknown };
    if (typeof note.type === "string") {
      gate.noteStatus(workspaceId, { type: note.type, message: typeof note.message === "string" ? note.message : undefined });
    }
  });
  const projectUri = pathToFileURL(projectRoot).href;
  await client.request("initialize", {
    processId: process.pid,
    rootUri: projectUri,
    workspaceFolders: [{ uri: projectUri, name: workspaceId }],
    capabilities: {
      workspace: { configuration: true, workspaceFolders: true },
      textDocument: {
        hover: { contentFormat: ["plaintext", "markdown"] },
        definition: {},
        references: {},
        completion: { completionItem: { snippetSupport: false } },
        rename: {},
        codeAction: { codeActionLiteralSupport: { codeActionKind: { valueSet: ["quickfix", "refactor"] } } },
        publishDiagnostics: {},
      },
    },
  });
  client.notify("initialized", {});
  targets.set(workspaceId, { workspaceId, projectRoot, client });
}

async function acquire(filePath: string) {
  const resolution = resolveWorkspace(filePath);
  if ("error" in resolution) return { error: resolution.error };
  const lease = await pool.acquire(resolution.projectRoot);
  try {
    await ensureHandshake(lease.workspaceId, lease.client!, resolution.projectRoot);
    await gate.awaitReady(lease.workspaceId, { withinMs: READY_DEADLINE_MS });
    return { lease, resolution };
  } catch (error) {
    await lease.release();
    throw error;
  }
}

function buildFacade(lease: { client?: import("./lsp/lsp-client.ts").LspClient }, workspaceId: string): import("./tools/tool-layer.ts").LspFacade {
  return {
    workspace: async () => ({ status: "ready", workspaceId }),
    readFile: (p: string) => {
      try {
        return readFileSync(p, "utf8");
      } catch {
        return undefined;
      }
    },
    request: async (method, params) => {
      const shaped = params as { textDocument: { uri: string } };
      return lease.client!.request(method, {
        ...shaped,
        textDocument: { ...shaped.textDocument, uri: pathToFileURL(shaped.textDocument.uri).href },
      });
    },
  };
}

function buildDiagnosticsFacade(filePath: string, workspaceId: string): import("./tools/diagnostics.ts").DiagnosticsFacade {
  return {
    workspace: async () => ({ status: "ready", workspaceId }),
    scopeOf: (p) => (p === filePath ? { kind: "file", uri: pathToFileURL(p).href } : undefined),
    projectFiles: () => [],
  };
}

/**
 * Bọc lời gọi tool bằng sync-guard khi watcher đã quan sát thay đổi mới (generation tăng) — "tool call
 * mang generation". `isStale` là câu hỏi "kết quả này còn mô tả thế giới trước khi sửa không?".
 */
async function guarded<T>(workspaceId: string, watcher: import("./workspace/file-sync-watcher.ts").FileSyncWatcher | undefined, run: () => Promise<T>, isStale: (r: T) => boolean): Promise<T> {
  const generation = watcher?.generation ?? 0;
  const previous = lastGeneration.get(workspaceId) ?? generation;
  lastGeneration.set(workspaceId, generation);
  if (generation === previous || watcher === undefined) return run();
  return withSyncQuiescence(watcher, { withinMs: SYNC_DEADLINE_MS }, run, isStale);
}

/** Kết quả resolve trả về "đã tìm thấy" — cơ sở `isStale` cho definition/hover (symbol còn resolve là stale). */
function resolvesStale(r: unknown): boolean {
  return !!r && typeof r === "object" && (r as { isError?: boolean; value?: { resolved?: boolean } }).isError === false && (r as { value?: { resolved?: boolean } }).value?.resolved === true;
}

// -------------------------------------------------------------------------------------------
// Route MCP tools/call -> 8 tool.
// -------------------------------------------------------------------------------------------

async function routeTool(name: string, args: Record<string, unknown>): Promise<unknown> {
  const filePath = typeof args.path === "string" ? args.path : "";
  const acquired = await acquire(filePath);
  if ("error" in acquired) return { isError: true, code: "unroutable", message: `unroutable: ${acquired.error}` };

  const { lease, resolution } = acquired;
  try {
    const workspaceId = lease.workspaceId;
    const watcher = watchers.get(workspaceId);
    const facade = buildFacade(lease, workspaceId);

    switch (name) {
      case "java_definition":
        return await guarded(workspaceId, watcher, () => definition(facade, { path: filePath, line: num(args.line), column: num(args.column) }), resolvesStale);
      case "java_hover":
        return await guarded(workspaceId, watcher, () => javaHover(facade, { path: filePath, line: num(args.line), column: num(args.column) }), resolvesStale);
      case "java_references":
        return await guarded(workspaceId, watcher, () => references(facade, { path: filePath, line: num(args.line), column: num(args.column), includeDeclaration: typeof args.includeDeclaration === "boolean" ? args.includeDeclaration : undefined }), () => false);
      case "java_completion":
        return await guarded(workspaceId, watcher, () => javaCompletion(facade, { path: filePath, line: num(args.line), column: num(args.column) }), () => false);
      case "java_diagnostics":
        return await guarded(workspaceId, watcher, () => javaDiagnostics(buildDiagnosticsFacade(filePath, workspaceId), cache, { path: filePath }), () => false);
      case "java_rename":
        return await guarded(workspaceId, watcher, () => javaRename(facade, { path: filePath, line: num(args.line), column: num(args.column), newName: str(args.newName), apply: args.apply === true }), () => false);
      case "java_code_actions":
        return await javaCodeActions(facade, store, watcher?.generation ?? 0, { path: filePath, line: num(args.line), column: num(args.column) });
      case "java_apply_code_action": {
        const handle = store.lookup(str(args.actionId));
        if (handle === undefined) return { isError: true, code: "unroutable", message: `unroutable: no such actionId: ${args.actionId}` };
        const handleWatcher = watchers.get(handle.workspaceId);
        const gen = handleWatcher?.generation ?? 0;
        const applyLease = await pool.acquire(resolution.projectRoot);
        try {
          return await javaApplyCodeAction(buildFacade(applyLease, handle.workspaceId), store, handle.workspaceId, gen, { actionId: str(args.actionId), apply: args.apply === true });
        } finally {
          await applyLease.release();
        }
      }
      default:
        return { isError: true, code: "unroutable", message: `unroutable: unknown tool ${name}` };
    }
  } catch (error) {
    const code = (error as { code?: string })?.code;
    if (code === "resyncing") return { isError: true, code: "resyncing", message: (error as Error).message };
    return { isError: true, code: "workspace-crashed", message: error instanceof Error ? error.message : String(error) };
  } finally {
    await lease.release();
  }
}

function num(value: unknown): number {
  return typeof value === "number" ? value : Number(value);
}
function str(value: unknown): string {
  return typeof value === "string" ? value : String(value ?? "");
}

const TOOL_LIST = [
  { name: "java_hover", description: "Hover signature + javadoc + range at path/line/column", inputSchema: { type: "object", properties: { path: { type: "string" }, line: { type: "number" }, column: { type: "number" } }, required: ["path", "line", "column"] } },
  { name: "java_definition", description: "Declaration location of the symbol at path/line/column", inputSchema: { type: "object", properties: { path: { type: "string" }, line: { type: "number" }, column: { type: "number" } }, required: ["path", "line", "column"] } },
  { name: "java_references", description: "Reference locations of the symbol, capped", inputSchema: { type: "object", properties: { path: { type: "string" }, line: { type: "number" }, column: { type: "number" }, includeDeclaration: { type: "boolean" } }, required: ["path", "line", "column"] } },
  { name: "java_completion", description: "Completion items at path/line/column, capped", inputSchema: { type: "object", properties: { path: { type: "string" }, line: { type: "number" }, column: { type: "number" } }, required: ["path", "line", "column"] } },
  { name: "java_diagnostics", description: "Latest publishDiagnostics for a file or project root", inputSchema: { type: "object", properties: { path: { type: "string" } }, required: ["path"] } },
  { name: "java_rename", description: "Proposed multi-file rename as data; apply:true writes", inputSchema: { type: "object", properties: { path: { type: "string" }, line: { type: "number" }, column: { type: "number" }, newName: { type: "string" }, apply: { type: "boolean" } }, required: ["path", "line", "column", "newName"] } },
  { name: "java_code_actions", description: "Available code actions as opaque actionId handles", inputSchema: { type: "object", properties: { path: { type: "string" }, line: { type: "number" }, column: { type: "number" } }, required: ["path", "line", "column"] } },
  { name: "java_apply_code_action", description: "Resolve an actionId's edit; apply:true writes", inputSchema: { type: "object", properties: { actionId: { type: "string" }, apply: { type: "boolean" } }, required: ["actionId"] } },
];

// -------------------------------------------------------------------------------------------
// MCP router + shim.
// -------------------------------------------------------------------------------------------

const shim = await startShim({
  shutdownOnSignals: ["SIGINT", "SIGTERM"],
  onConnection: (socket) => {
    let buffer = "";
    socket.on("data", (chunk: Buffer) => {
      buffer += chunk.toString("utf8");
      for (;;) {
        const index = buffer.indexOf(NEWLINE);
        if (index < 0) return;
        const line = buffer.slice(0, index).trim();
        buffer = buffer.slice(index + 1);
        if (!line) continue;
        let msg: { jsonrpc?: string; id?: unknown; method?: string; params?: { name?: string; arguments?: Record<string, unknown> } };
        try {
          msg = JSON.parse(line);
        } catch {
          continue;
        }
        void (async () => {
          const respond = (result: unknown): void => {
            socket.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result }) + NEWLINE);
          };
          try {
            if (msg.method === "initialize") {
              respond({ protocolVersion: "2024-11-05", capabilities: { tools: {} }, serverInfo: { name: "jdt-mcp-server", version: "0.0.0" } });
            } else if (msg.method === "tools/list") {
              respond({ tools: TOOL_LIST });
            } else if (msg.method === "tools/call") {
              const { name, arguments: args } = msg.params ?? {};
              const result = await routeTool(name ?? "", args ?? {});
              respond({ content: [{ type: "text", text: JSON.stringify(result) }], isError: (result as { isError?: boolean }).isError === true });
            } else if (msg.id !== undefined && msg.method) {
              respond({});
            }
          } catch (error) {
            respond({ content: [{ type: "text", text: JSON.stringify({ isError: true, code: "workspace-crashed", message: error instanceof Error ? error.message : String(error) }) }], isError: true });
          }
        })();
      }
    });
  },
});

process.stderr.write(`jdt-mcp-server ready (role=${shim.role}, socket=${shim.socketPath})${NEWLINE}`);
await shim.done;
