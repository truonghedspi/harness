// completion — tool `java_completion` của tầng MCP (bảng tool trong harness/docs/design/tool-surface.md).
//
// Đây là wrapper MỎNG. Mọi thứ khó nằm ở `tool-layer.ts`: hỏi workspace → đọc nội dung hiện tại →
// xác thực line/column trước mọi lời gọi LSP (INV-TOOL-5), chuyển đổi toạ độ qua đúng một ranh giới
// (INV-TOOL-1), và tạo hình item completion (`shapeCompletion`). Tệp này chỉ gánh đúng một việc mà
// tool-layer cố ý không làm — chính sách kích thước của một tool dùng cho tác tử:
//
//   INV-TOOL-3  mọi danh sách vượt cap đã cấu hình luôn được trả về ở dạng đã cắt KÈM
//               `truncated: true` và tổng số THỰC — không bao giờ bị cắt im lặng, không bao giờ
//               trả về nguyên vẹn không giới hạn.
//
// Vì sao cap không phải một hằng số cứng trên đường cắt: X-008 CÒN MỞ. Con số 200 hiện chỉ là
// khuyến nghị, nên nó nằm ở đúng một chỗ có tên (`DEFAULT_COMPLETION_CAP`) và bị
// `JavaCompletionOptions.cap` ghi đè được — cùng quy ước `references.ts` đã dùng cho `java_references`.

import {
  completion as completionThroughToolLayer,
  type LspFacade,
  type SourcePosition,
  type SourceRange,
  type ToolOutcome,
} from "./tool-layer.ts";

/** Cap mặc định cho danh sách completion item — khuyến nghị của X-008 khi quyết định đó còn mở. */
export const DEFAULT_COMPLETION_CAP = 200;

/** Tham số của `java_completion`, đúng bảng tool: `path`, `line`, `column` (1-based, X-007). */
export interface JavaCompletionArguments {
  path: string;
  line: number;
  column: number;
}

/** Một item completion công bố ra ngoài, trong cùng hệ toạ độ 1-based với mọi tool khác. */
export interface JavaCompletionItem {
  label: string;
  detail?: string;
  range: SourceRange;
}

/**
 * `total` và `truncated` KHÔNG bao giờ là trường tuỳ chọn: một trường vắng mặt khi danh sách vừa đủ
 * và có mặt khi bị cắt sẽ khiến người đọc phải suy đoán, và một lỗi cắt im lặng trông y hệt một câu
 * trả lời đầy đủ. Luôn có mặt, kể cả khi `truncated === false`.
 */
export interface JavaCompletionResult {
  path: string;
  workspaceId: string;
  position: SourcePosition;
  /** Cap thực sự đã áp dụng cho lời gọi này. */
  cap: number;
  /** Tổng số item TRƯỚC khi cắt. Bằng `items.length` khi và chỉ khi `truncated === false`. */
  total: number;
  truncated: boolean;
  items: JavaCompletionItem[];
}

export interface JavaCompletionOptions {
  /** Ghi đè cap của lời gọi này. Bỏ trống thì dùng `DEFAULT_COMPLETION_CAP`. */
  cap?: number;
}

export async function javaCompletion(
  facade: LspFacade,
  args: JavaCompletionArguments,
  options: JavaCompletionOptions = {},
): Promise<ToolOutcome<JavaCompletionResult>> {
  const cap = options.cap ?? DEFAULT_COMPLETION_CAP;

  // Bước 1-4 (workspace, nội dung, xác thực vị trí, LSP request + tạo hình item) do tool-layer làm.
  const outcome = await completionThroughToolLayer(facade, {
    path: args.path,
    line: args.line,
    column: args.column,
  });
  if (outcome.isError) return outcome;

  const answer = outcome.value;
  const items = answer.completion?.items ?? [];

  // INV-TOOL-3. `total` được chốt TRƯỚC khi cắt: sau `slice` thì tổng số thực không còn tồn tại.
  // `truncated` so bằng `>` chứ không phải `>=`: đúng bằng cap là vừa đủ, chưa mất phần tử nào.
  const total = items.length;
  const truncated = total > cap;

  return {
    isError: false,
    value: {
      path: answer.path,
      workspaceId: answer.workspaceId,
      position: answer.position,
      cap,
      total,
      truncated,
      items: truncated ? items.slice(0, cap) : items,
    },
  };
}
