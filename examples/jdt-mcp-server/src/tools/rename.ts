// rename — `java_rename` tool in the MCP layer (harness/docs/design/tool-surface.md, section 6 build order).
//
// This is the FIRST mutating tool, and it carries one invariant that read-only tools do not:
//
//   INV-TOOL-2  no tool writes to disk unless a call carries explicit opt-in; a mutating tool's
//               default result is a proposed edit expressed as data.
//
// Therefore `apply` is the VALUE `true`, not the presence of the key: omitted `apply` and
// `apply: false` both avoid writes, and `apply: true` never becomes the default for the next call
// (A-002: "apply must be opt-in per call, never a server-side default").
//
// Everything else is inherited unchanged from tool-layer (workspace and position validation before
// every LSP call [INV-TOOL-5], coordinate conversion at exactly one boundary [INV-TOOL-1]) and
// workspace-edit (shaping and applying WorkspaceEdit).

import {
  callPositionalTool,
  toLspPosition,
  type LspFacade,
  type SourcePosition,
  type SourceRange,
  type ToolErrorCode,
  type ToolFailure,
  type ToolOutcome,
} from "./tool-layer.ts";
import {
  shapeWorkspaceEdit,
  toPublicFileEdits,
  writeWorkspaceEdits,
  type WorkspaceFileEdit,
} from "./workspace-edit.ts";

export const RENAME_METHOD = "textDocument/rename";

export interface JavaRenameArguments {
  path: string;
  line: number;
  column: number;
  newName: string;
  /** WRITE-TO-DISK opt-in. Omitted or `false` returns only the edit as data. */
  apply?: boolean;
}

export interface JavaRenameTextEdit {
  range: SourceRange;
  newText: string;
}

export interface JavaRenameFile extends WorkspaceFileEdit {}

export interface JavaRenameResult {
  path: string;
  workspaceId: string;
  position: SourcePosition;
  newName: string;
  /** `true` when the call supplied `apply: true` and files were written. */
  applied: boolean;
  files: JavaRenameFile[];
}

function fail(code: ToolErrorCode, message: string): ToolFailure {
  return { isError: true, code, message: `${code}: ${message}` };
}

export async function javaRename(
  facade: LspFacade,
  args: JavaRenameArguments,
): Promise<ToolOutcome<JavaRenameResult>> {
  const base = await callPositionalTool(facade, { path: args.path, line: args.line, column: args.column }, []);
  if (base.isError) return base;

  const lspPosition = toLspPosition(base.value.position);
  const params = { textDocument: { uri: args.path }, position: lspPosition, newName: args.newName };

  let raw: unknown;
  try {
    raw = await facade.request(RENAME_METHOD, params);
  } catch (error) {
    return fail("workspace-crashed", error instanceof Error ? error.message : String(error));
  }

  const rawFiles = shapeWorkspaceEdit(raw);
  const files: JavaRenameFile[] = toPublicFileEdits(rawFiles);

  // INV-TOOL-2: only `apply === true` writes. Omitted and `false` are both no-write.
  const applied = args.apply === true;
  if (applied) {
    try {
      writeWorkspaceEdits(rawFiles);
    } catch (error) {
      return fail("unroutable", `cannot apply the rename: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  return {
    isError: false,
    value: {
      path: base.value.path,
      workspaceId: base.value.workspaceId,
      position: base.value.position,
      newName: args.newName,
      applied,
      files,
    },
  };
}
