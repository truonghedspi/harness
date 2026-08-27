// references — tool `java_references`: các vị trí tham chiếu tới symbol tại `path/line/column`
// (harness/docs/design/tool-surface.md bảng tool, mục "Result shaping — Size").
//
// Bất biến sở hữu tại đây:
//   INV-TOOL-3  mọi danh sách vượt cap đã cấu hình luôn được trả về ở dạng đã cắt KÈM
//               `truncated: true` và tổng số THỰC — không bao giờ bị cắt im lặng, không bao giờ
//               trả về nguyên vẹn không giới hạn.
//
// Tệp này là một tool mỏng: nó không tự cộng trừ một chỉ số dòng hay cột nào. Mọi vị trí đi ra đều
// qua `fromLspRange` của tool-layer, và vị trí đi vào qua `validatePosition` — đúng một ranh giới
// chuyển đổi cho toàn hệ thống (INV-TOOL-1). Thứ tự các bước cũng lấy nguyên của tool-layer:
// hỏi workspace → đọc nội dung hiện tại → xác thực toạ độ → chỉ khi đó mới phát LSP request.
// `callPositionalTool` chưa nhận capability `references`, mà tệp tool-layer đang được checker xem
// xét nên không được sửa ở nhánh này; vì vậy đường đi được lắp lại từ chính các hàm nó xuất ra.
//
// Vì sao cap không phải một hằng số cứng trên đường cắt: X-008 CÒN MỞ. Con số 200 hiện chỉ là
// khuyến nghị, nên nó nằm ở đúng một chỗ có tên (`DEFAULT_REFERENCE_CAP`) và bị `ReferencesOptions.cap`
// ghi đè được. Khi X-008 chốt, chỉ một dòng đổi giá trị; không có nhánh logic nào phải đọc lại.

import {
  fromLspRange,
  validatePosition,
  type LspFacade,
  type LspRange,
  type SourcePosition,
  type SourceRange,
  type ToolErrorCode,
  type ToolFailure,
  type ToolOutcome,
} from "./tool-layer.ts";

export const REFERENCES_METHOD = "textDocument/references";

/**
 * Cap mặc định cho danh sách reference. Đây là khuyến nghị của X-008 khi quyết định đó còn mở —
 * điểm duy nhất trong tệp mang con số này. Logic cắt bên dưới chỉ đọc biến `cap`, không bao giờ đọc
 * hằng số này trực tiếp.
 */
export const DEFAULT_REFERENCE_CAP = 200;

export interface ReferencesRequest {
  path: string;
  line: number;
  column: number;
  includeDeclaration?: boolean;
}

export interface ReferenceLocation {
  path: string;
  range: SourceRange;
}

/**
 * `total` và `truncated` KHÔNG bao giờ là trường tuỳ chọn. Một trường vắng mặt khi danh sách vừa
 * đủ và có mặt khi bị cắt sẽ khiến người đọc phải suy đoán, và một lỗi cắt im lặng trông y hệt một
 * câu trả lời đầy đủ. Luôn có mặt, kể cả khi `truncated === false`.
 */
export interface ReferencesAnswer {
  path: string;
  workspaceId: string;
  position: SourcePosition;
  /** Cap thực sự đã áp dụng cho lời gọi này — người gọi đọc được mình đang bị giới hạn ở đâu. */
  cap: number;
  /** Tổng số reference TRƯỚC khi cắt. Bằng `references.length` khi và chỉ khi `truncated === false`. */
  total: number;
  truncated: boolean;
  references: ReferenceLocation[];
}

export interface ReferencesOptions {
  /** Ghi đè cap của lời gọi này. Bỏ trống thì dùng `DEFAULT_REFERENCE_CAP`. */
  cap?: number;
}

function fail(code: ToolErrorCode, message: string, detail?: unknown): ToolFailure {
  const failure: ToolFailure = { isError: true, code, message: `${code}: ${message}` };
  if (detail !== undefined) failure.detail = detail;
  return failure;
}

export async function references(
  facade: LspFacade,
  request: ReferencesRequest,
  options: ReferencesOptions = {},
): Promise<ToolOutcome<ReferencesAnswer>> {
  const cap = options.cap ?? DEFAULT_REFERENCE_CAP;

  const availability = await facade.workspace(request.path);
  if (availability.status !== "ready") {
    return fail(
      availability.status,
      `workspace serving ${request.path} cannot answer: ${availability.detail}`,
      availability.progress,
    );
  }

  const content = facade.readFile(request.path);
  if (content === undefined) {
    return fail(
      "unroutable",
      `cannot read the current content of ${request.path}; no position can be validated against it`,
    );
  }

  const position: SourcePosition = { line: request.line, column: request.column };
  const validated = validatePosition(content, position, request.path);
  if (validated.isError) return validated;

  const params: Record<string, unknown> = {
    textDocument: { uri: request.path },
    position: validated.value,
  };
  if (request.includeDeclaration !== undefined) {
    params.context = { includeDeclaration: request.includeDeclaration };
  }

  let raw: unknown;
  try {
    raw = await facade.request(REFERENCES_METHOD, params);
  } catch (error) {
    return fail("workspace-crashed", error instanceof Error ? error.message : String(error));
  }

  // INV-TOOL-3. `total` được chốt TRƯỚC khi cắt: sau `slice` thì tổng số thực không còn tồn tại ở
  // đâu nữa, nên đọc `references.length` ra làm tổng là cách hỏng kinh điển của bất biến này.
  // `truncated` so bằng `>` chứ không phải `>=`: đúng bằng cap là vừa đủ, chưa mất phần tử nào.
  const found = shapeLocations(raw);
  const total = found.length;
  const truncated = total > cap;
  const references = truncated ? found.slice(0, cap) : found;

  return {
    isError: false,
    value: {
      path: request.path,
      workspaceId: availability.workspaceId,
      position,
      cap,
      total,
      truncated,
      references,
    },
  };
}

function shapeLocations(raw: unknown): ReferenceLocation[] {
  if (!Array.isArray(raw)) return [];
  const shaped: ReferenceLocation[] = [];
  for (const entry of raw) {
    if (!isRecord(entry)) continue;
    const uri = typeof entry.uri === "string" ? entry.uri : undefined;
    const lspRange = readLspRange(entry.range);
    if (uri === undefined || lspRange === undefined) continue;
    shaped.push({ path: pathOfUri(uri), range: fromLspRange(lspRange) });
  }
  return shaped;
}

function pathOfUri(uri: string): string {
  if (!uri.startsWith("file://")) return uri;
  const withoutScheme = uri.slice("file://".length);
  const path = withoutScheme.startsWith("/") ? withoutScheme : `/${withoutScheme}`;
  try {
    return decodeURIComponent(path);
  } catch {
    return path;
  }
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
