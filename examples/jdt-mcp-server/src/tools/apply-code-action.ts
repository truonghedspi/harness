// apply-code-action — the MCP-layer `java_apply_code_action` tool (harness/docs/design/tool-surface.md).
//
// The second half of the two-phase protocol: `java_code_actions` mints an opaque `actionId` (bound
// to sync generation), and this tool resolves it through `codeAction/resolve`. The pair's two
// specific invariants converge here:
//
//   INV-CA-1  an actionId resolves only when the workspace sync generation still matches its mint;
//             a change ALWAYS fails instead of silently returning an edit for changed source (stale).
//   INV-CA-2  every issued actionId either resolves or expires with an error; it never resolves to
//             another action.
//
// `apply:true` remains opt-in disk writing under INV-TOOL-2 (A-002), as with java_rename.

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
  // INV-CA-1/2: the handle must resolve in the correct workspace and generation; otherwise use a named error.
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
