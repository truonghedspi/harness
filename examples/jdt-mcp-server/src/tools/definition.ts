// java_definition — tool mỏng trả về vị trí khai báo của symbol tại `path/line/column`
// (harness/docs/design/tool-surface.md, bảng tám tool, mục 3 của thứ tự dựng).
//
// Bất biến mà tệp này phải giữ, và cách nó giữ:
//   INV-TOOL-1  mọi vị trí trong kết quả đi qua ĐÚNG MỘT ranh giới chuyển đổi. Tệp này không chứa
//               một phép cộng hay trừ nào trên chỉ số dòng/cột: chiều xuống dùng `toLspPosition`,
//               chiều lên dùng `fromLspRange`, cả hai của tool-layer. Đó là toàn bộ lý do
//               `java_definition` không được phép tự đọc `range.start.line + 1`.
//   INV-TOOL-4  thất bại luôn là lỗi có tên theo taxonomy X-003; "không tìm thấy khai báo nào" là
//               một nhánh có tên (`resolved: false` kèm lý do), không phải một mảng rỗng mập mờ.
//   INV-TOOL-5  xác thực line/column xảy ra TRƯỚC lời gọi LSP — không lặp lại ở đây, mà thừa hưởng
//               nguyên vẹn từ `callPositionalTool`.
//
// Vì sao gọi `callPositionalTool(facade, request, [])`: đường đi chung của mọi tool nhận
// path/line/column — hỏi workspace, đọc nội dung hiện tại, xác thực vị trí — thuộc về
// feat-tool-layer-core. Danh sách capability rỗng chạy đúng ba bước đó và không phát request nào,
// nên `java_definition` tái dùng toàn bộ phần xác thực và phần đặt tên lỗi thay vì chép lại. Chỉ
// việc phát `textDocument/definition` và tạo hình location là phần riêng của tệp này.

import {
  callPositionalTool,
  fromLspRange,
  toLspPosition,
  type LspFacade,
  type LspRange,
  type PositionalRequest,
  type SourcePosition,
  type SourceRange,
  type ToolErrorCode,
  type ToolFailure,
  type ToolOutcome,
} from "./tool-layer.ts";

export const DEFINITION_METHOD = "textDocument/definition";

/** Một vị trí khai báo: tệp nào, và ở đâu trong tệp đó — cùng hệ toạ độ 1-based với mọi tool khác. */
export interface DefinitionLocation {
  path: string;
  range: SourceRange;
}

/**
 * `locations` luôn hiện diện, kể cả khi rỗng, nên người gọi không bao giờ phải phân biệt "trường bị
 * bỏ trống" với "không có khai báo". `resolved` là nhánh có tên cho trường hợp thứ hai: rỗng đi kèm
 * một lý do đọc được, đúng như hover làm với `resolved: false` (INV-TOOL-4).
 */
export type DefinitionAnswer = {
  path: string;
  workspaceId: string;
  /** Vị trí đã xác thực, echo lại trong cùng hệ toạ độ với mọi range bên dưới. */
  position: SourcePosition;
} & (
  | { resolved: true; locations: DefinitionLocation[] }
  | { resolved: false; locations: []; reason: string }
);

/**
 * Envelope lỗi của tầng tool. `fail` của tool-layer là hàm private của module đó, nên chỗ này dựng
 * lại đúng quy ước thông điệp `"<code>: <message>"`. Mã lỗi vẫn lấy từ `ToolErrorCode` nên taxonomy
 * X-003 vẫn đóng — không có mã nào mới ra đời ở đây.
 */
function fail(code: ToolErrorCode, message: string): ToolFailure {
  return { isError: true, code, message: `${code}: ${message}` };
}

export async function definition(
  facade: LspFacade,
  request: PositionalRequest,
): Promise<ToolOutcome<DefinitionAnswer>> {
  // Bước 1-3 (workspace sẵn sàng, nội dung hiện tại, xác thực vị trí) do tool-layer làm. Mọi lỗi
  // rời khỏi đây đã mang sẵn đúng tên của nó và chưa lời gọi LSP nào được phát ra.
  const base = await callPositionalTool(facade, request, []);
  if (base.isError) return base;

  // Chiều xuống của ranh giới chuyển đổi duy nhất: 1-based đã xác thực → 0-based của LSP.
  const lspPosition = toLspPosition(base.value.position);
  const params = { textDocument: { uri: request.path }, position: lspPosition };

  let raw: unknown;
  try {
    raw = await facade.request(DEFINITION_METHOD, params);
  } catch (error) {
    return fail("workspace-crashed", messageOf(error));
  }

  const locations = shapeLocations(raw);
  const answered = {
    path: base.value.path,
    workspaceId: base.value.workspaceId,
    position: base.value.position,
  };

  if (locations.length === 0) {
    return {
      isError: false,
      value: {
        ...answered,
        resolved: false,
        locations: [],
        reason:
          `${DEFINITION_METHOD} found no declaration for the symbol at ` +
          `${request.path}:${base.value.position.line}:${base.value.position.column}`,
      },
    };
  }

  return { isError: false, value: { ...answered, resolved: true, locations } };
}

// -------------------------------------------------------------------------------------------
// Tạo hình kết quả — mọi range đi qua fromLspRange, cho MỌI phần tử, không có ngoại lệ
// -------------------------------------------------------------------------------------------

/**
 * LSP cho phép `textDocument/definition` trả về `Location`, `Location[]`, `LocationLink[]` hoặc
 * `null`. Cả bốn hình dạng được chuẩn hoá về đúng một mảng, nên người gọi chỉ gặp một shape.
 *
 * Phần tử không nêu đủ `uri` + `range` bị bỏ qua, cùng cách `shapeCompletion` của tool-layer xử lý
 * item hỏng: một phần tử không đọc được không có vị trí nào để chuyển đổi, và bịa ra một vị trí cho
 * nó là đúng thứ INV-TOOL-1 cấm.
 */
function shapeLocations(raw: unknown): DefinitionLocation[] {
  const entries = Array.isArray(raw) ? raw : raw === null || raw === undefined ? [] : [raw];

  const locations: DefinitionLocation[] = [];
  for (const entry of entries) {
    const location = shapeLocation(entry);
    if (location !== undefined) locations.push(location);
  }
  return locations;
}

function shapeLocation(entry: unknown): DefinitionLocation | undefined {
  if (!isRecord(entry)) return undefined;

  const path = readUri(entry);
  const lspRange = readTargetRange(entry);
  if (path === undefined || lspRange === undefined) return undefined;

  // Cùng một hàm, cùng một hằng số, cùng một phép cộng như hover và completion. Đó là INV-TOOL-1.
  return { path, range: fromLspRange(lspRange) };
}

/** `Location.uri` cho hình dạng thứ nhất, `LocationLink.targetUri` cho hình dạng thứ hai. */
function readUri(entry: Record<string, unknown>): string | undefined {
  if (typeof entry.uri === "string") return entry.uri;
  if (typeof entry.targetUri === "string") return entry.targetUri;
  return undefined;
}

/**
 * Với `LocationLink`, `targetSelectionRange` là range của chính định danh được khai báo còn
 * `targetRange` phủ cả thân khai báo. Câu hỏi mà agent đặt ra là "khai báo nằm ở đâu", nên định
 * danh là câu trả lời hẹp và đúng hơn; `targetRange` chỉ là phương án dự phòng khi server không gửi
 * `targetSelectionRange`.
 */
function readTargetRange(entry: Record<string, unknown>): LspRange | undefined {
  return (
    readLspRange(entry.range) ??
    readLspRange(entry.targetSelectionRange) ??
    readLspRange(entry.targetRange)
  );
}

function readLspRange(value: unknown): LspRange | undefined {
  if (!isRecord(value)) return undefined;
  const start = readLspPosition(value.start);
  const end = readLspPosition(value.end);
  if (start === undefined || end === undefined) return undefined;
  return { start, end };
}

function readLspPosition(value: unknown): { line: number; character: number } | undefined {
  if (!isRecord(value)) return undefined;
  if (typeof value.line !== "number" || typeof value.character !== "number") return undefined;
  return { line: value.line, character: value.character };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
