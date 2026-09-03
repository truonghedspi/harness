// code-actions — the MCP-layer `java_code_actions` tool (harness/docs/design/tool-surface.md, item 7).
//
// JDT LS returns unresolved actions (`edit`/`command` undefined, with only opaque `data`—spike D).
// This tool does NOT expose that blob: it mints an opaque `actionId` bound to the current
// (workspaceId, sync generation) and retains the blob server-side in `CodeActionStore` (INV-CA-2).
// The caller sees only `title` and `actionId`.
//
// It inherits tool-layer's validation order unchanged (INV-TOOL-5 before every LSP call).

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
