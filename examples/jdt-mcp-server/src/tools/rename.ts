// rename — tool `java_rename` của tầng MCP (harness/docs/design/tool-surface.md, mục 6 thứ tự dựng).
//
// Đây là tool đột biến ĐẦU TIÊN, và nó gánh đúng một bất biến mà các tool đọc không có:
//
//   INV-TOOL-2  không tool nào ghi đĩa trừ khi lời gọi mang opt-in tường minh; kết quả mặc định của
//               một tool đột biến là edit được đề xuất dưới dạng dữ liệu.
//
// Vì vậy `apply` là GIÁ TRỊ `true`, không phải sự hiện diện của khoá: `apply` vắng mặt và
// `apply: false` cùng không ghi, và một lần `apply: true` không bao giờ đọng lại thành mặc định cho
// lời gọi sau (A-002: "apply must be opt-in per call, never a server-side default").
//
// Mọi thứ khác thừa hưởng nguyên vẹn từ tool-layer (xác thực workspace + vị trí trước mọi lời gọi
// LSP [INV-TOOL-5], chuyển đổi toạ độ qua đúng một ranh giới [INV-TOOL-1]) và từ workspace-edit
// (tạo hình + áp WorkspaceEdit).

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
  /** Opt-in GHI ĐĨA. Vắng mặt hoặc `false` đều chỉ trả edit dưới dạng dữ liệu. */
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
  /** `true` đúng khi lời gọi mang `apply: true` và các tệp đã được ghi. */
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

  // INV-TOOL-2: chỉ `apply === true` mới ghi. Vắng mặt và `false` đều là no-write.
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
