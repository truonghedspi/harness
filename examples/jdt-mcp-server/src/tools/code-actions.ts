// code-actions — tool `java_code_actions` của tầng MCP (harness/docs/design/tool-surface.md, mục 7).
//
// JDT LS trả action ở dạng CHƯA giải (`edit`/`command` undefined, chỉ `data` mờ đục — spike D). Tool
// này KHÔNG đưa blob đó ra ngoài: nó đúc một `actionId` mờ đục trói vào (workspaceId, sync generation)
// hiện tại và giữ blob phía server trong `CodeActionStore` (INV-CA-2). Caller chỉ thấy `title` + `actionId`.
//
// Thứ tự xác thực thừa hưởng nguyên vẹn từ tool-layer (INV-TOOL-5 trước mọi lời gọi LSP).

import {
  callPositionalTool,
  toLspPosition,
  type LspFacade,
  type SourcePosition,
  type ToolErrorCode,
  type ToolFailure,
  type ToolOutcome,
} from "./tool-layer.ts";
import type { CodeActionStore } from "./code-action-store.ts";

export const CODE_ACTION_METHOD = "textDocument/codeAction";

export interface JavaCodeActionsArguments {
  path: string;
  line: number;
  column: number;
}

export interface JavaCodeActionHandle {
  title: string;
  actionId: string;
}

export interface JavaCodeActionsResult {
  path: string;
  workspaceId: string;
  position: SourcePosition;
  actions: JavaCodeActionHandle[];
}

function fail(code: ToolErrorCode, message: string): ToolFailure {
  return { isError: true, code, message: `${code}: ${message}` };
}

export async function javaCodeActions(
  facade: LspFacade,
  store: CodeActionStore,
  generation: number,
  args: JavaCodeActionsArguments,
): Promise<ToolOutcome<JavaCodeActionsResult>> {
  const base = await callPositionalTool(facade, { path: args.path, line: args.line, column: args.column }, []);
  if (base.isError) return base;

  const lspPosition = toLspPosition(base.value.position);
  const params = {
    textDocument: { uri: args.path },
    range: { start: lspPosition, end: lspPosition },
    context: { diagnostics: [] },
  };

  let raw: unknown;
  try {
    raw = await facade.request(CODE_ACTION_METHOD, params);
  } catch (error) {
    return fail("workspace-crashed", error instanceof Error ? error.message : String(error));
  }

  const actions: JavaCodeActionHandle[] = [];
  if (Array.isArray(raw)) {
    for (const action of raw) {
      if (!isRecord(action)) continue;
      const title = typeof action.title === "string" ? action.title : undefined;
      if (title === undefined) continue;
      const actionId = store.mint(base.value.workspaceId, generation, action);
      actions.push({ title, actionId });
    }
  }

  return {
    isError: false,
    value: {
      path: base.value.path,
      workspaceId: base.value.workspaceId,
      position: base.value.position,
      actions,
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
