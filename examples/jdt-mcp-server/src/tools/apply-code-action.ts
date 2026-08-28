// apply-code-action — tool `java_apply_code_action` của tầng MCP (harness/docs/design/tool-surface.md).
//
// Nửa thứ hai của giao thức hai pha: `java_code_actions` đúc `actionId` mờ đục (trói vào sync
// generation), còn tool này giải nó bằng một vòng `codeAction/resolve`. Hai bất biến riêng của cặp
// tool này đều đổ dồn về đây:
//
//   INV-CA-1  một actionId chỉ giải được khi sync generation của workspace vẫn khớp lúc đúc; đổi thì
//             LUÔN lỗi thay vì âm thầm trả edit tính trên mã nguồn đã đổi (stale).
//   INV-CA-2  mọi actionId trao ra hoặc giải được, hoặc hết hạn kèm lỗi — không bao giờ giải nhầm
//             sang action khác.
//
// `apply:true` vẫn là opt-in ghi đĩa theo INV-TOOL-2 (A-002), giống java_rename.

import {
  type LspFacade,
  type ToolErrorCode,
  type ToolFailure,
  type ToolOutcome,
} from "./tool-layer.ts";
import type { CodeActionStore } from "./code-action-store.ts";
import { shapeWorkspaceEdit, toPublicFileEdits, writeWorkspaceEdits, type WorkspaceFileEdit } from "./workspace-edit.ts";

export const CODE_ACTION_RESOLVE_METHOD = "codeAction/resolve";

export interface JavaApplyCodeActionArguments {
  actionId: string;
  apply?: boolean;
}

export interface JavaApplyCodeActionResult {
  workspaceId: string;
  actionId: string;
  applied: boolean;
  files: WorkspaceFileEdit[];
}

function fail(code: ToolErrorCode, message: string): ToolFailure {
  return { isError: true, code, message: `${code}: ${message}` };
}

export async function javaApplyCodeAction(
  facade: LspFacade,
  store: CodeActionStore,
  workspaceId: string,
  generation: number,
  args: JavaApplyCodeActionArguments,
): Promise<ToolOutcome<JavaApplyCodeActionResult>> {
  // INV-CA-1/2: handle phải giải được ở đúng workspace và đúng generation; không thì lỗi có tên.
  const resolved = store.resolve(workspaceId, generation, args.actionId);
  if (!resolved.ok) {
    return resolved.reason === "expired"
      ? fail("resyncing", `actionId ${args.actionId} is stale: the workspace changed since the handle was minted`)
      : fail("unroutable", `no such actionId: ${args.actionId}`);
  }

  let raw: unknown;
  try {
    raw = await facade.request(CODE_ACTION_RESOLVE_METHOD, resolved.action);
  } catch (error) {
    return fail("workspace-crashed", error instanceof Error ? error.message : String(error));
  }

  const rawFiles = shapeWorkspaceEdit(raw);
  const files: WorkspaceFileEdit[] = toPublicFileEdits(rawFiles);

  const applied = args.apply === true;
  if (applied) {
    try {
      writeWorkspaceEdits(rawFiles);
    } catch (error) {
      return fail("unroutable", `cannot apply the code action: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  return {
    isError: false,
    value: { workspaceId, actionId: args.actionId, applied, files },
  };
}
