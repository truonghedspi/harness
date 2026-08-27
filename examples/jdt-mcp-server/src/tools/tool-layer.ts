// tool-layer — lõi của `mcp-tool-layer`: xác thực tham số, chuyển đổi toạ độ, tạo hình kết quả
// (harness/docs/design/architecture.md bảng thành phần, harness/docs/design/tool-surface.md).
//
// Bất biến sở hữu tại đây:
//   INV-TOOL-1  mọi vị trí trong mọi kết quả tool — bất kể method LSP nào sinh ra nó — nằm trong
//               MỘT hệ toạ độ đã tài liệu hoá, chuyển đổi tại ĐÚNG MỘT ranh giới; không kết quả
//               nào trộn hai cơ sở.
//   INV-TOOL-4  mọi thất bại được báo cáo dưới dạng structured error nêu đúng tên loại của nó;
//               không thất bại nào được mã hoá thành một kết quả thành công rỗng.
//   INV-TOOL-5  xác thực tham số từ chối line/column vượt giới hạn của nội dung HIỆN TẠI của tệp
//               TRƯỚC khi bất kỳ lời gọi LSP nào được phát ra.
//
// Tầng này là hàm thuần của một `LspFacade` được tiêm. Nó không sở hữu pool, router, readiness-gate
// hay watcher: nó nhận một facade đã gộp sẵn ba câu hỏi mà nó cần trả lời được, và không bao giờ tự
// mở tệp hay tự mở tiến trình. Việc nối dây thật với pool/router/readiness/sync do daemon làm và
// được chứng minh end-to-end ở feat-prove-cross-process-integration.
//
// Vì sao 1-based: X-007. Mọi thứ khác mà một LLM đọc về mã nguồn — lỗi biên dịch, `grep -n`, stack
// trace — đều 1-based; LSP thì 0-based và đếm bằng UTF-16 code unit. Trộn hai quy ước sinh ra lỗi
// lệch một dòng trông y hệt lỗi của mô hình. Vì vậy toàn bộ tệp này có đúng hai hàm chạm vào phép
// cộng trừ đó: `fromLspPosition` cho chiều lên, `toLspPosition` cho chiều xuống. Mọi range, mọi
// capability, mọi tool tương lai đều đi qua chúng — không có đường tắt nào tự cộng lấy.

/** Taxonomy đóng của X-003. Không có mã lỗi nào ngoài danh sách này rời khỏi tầng tool. */
export const TOOL_ERROR_CODES = [
  "unroutable",
  "not-ready",
  "resyncing",
  "workspace-crashed",
  "cap-exceeded",
  "invalid-position",
] as const;
export type ToolErrorCode = (typeof TOOL_ERROR_CODES)[number];

/** Vị trí trong hệ toạ độ công bố ra ngoài: 1-based, cột đếm bằng UTF-16 code unit (X-007). */
export interface SourcePosition {
  line: number;
  column: number;
}

export interface SourceRange {
  start: SourcePosition;
  end: SourcePosition;
}

/** Vị trí đúng như LSP nói: 0-based, `character` đếm bằng UTF-16 code unit. */
export interface LspPosition {
  line: number;
  character: number;
}

export interface LspRange {
  start: LspPosition;
  end: LspPosition;
}

/** Độ lệch giữa hai hệ. Hằng số này chỉ được đọc bởi hai hàm chuyển đổi bên dưới. */
const POSITION_BASE = 1;

// -------------------------------------------------------------------------------------------
// RANH GIỚI CHUYỂN ĐỔI DUY NHẤT (INV-TOOL-1)
// -------------------------------------------------------------------------------------------

/** LSP → hệ công bố. Đây là điểm duy nhất trong tầng tool cộng vào một chỉ số dòng hoặc cột. */
export function fromLspPosition(position: LspPosition): SourcePosition {
  return {
    line: position.line + POSITION_BASE,
    column: position.character + POSITION_BASE,
  };
}

/** Range chỉ là hai vị trí; nó không được phép biết cách chuyển đổi. */
export function fromLspRange(range: LspRange): SourceRange {
  return { start: fromLspPosition(range.start), end: fromLspPosition(range.end) };
}

/** Hệ công bố → LSP. Điểm duy nhất trong tầng tool trừ đi một chỉ số dòng hoặc cột. */
export function toLspPosition(position: SourcePosition): LspPosition {
  return {
    line: position.line - POSITION_BASE,
    character: position.column - POSITION_BASE,
  };
}

// -------------------------------------------------------------------------------------------
// Cổng tới một workspace
// -------------------------------------------------------------------------------------------

export interface WorkspaceReady {
  status: "ready";
  workspaceId: string;
}

/**
 * Mọi lý do khiến một workspace không trả lời được, đặt tên đúng bằng taxonomy X-003 trừ
 * `invalid-position` — mã đó thuộc về tham số của lời gọi, không thuộc về workspace.
 */
export interface WorkspaceUnavailable {
  status: Exclude<ToolErrorCode, "invalid-position">;
  detail: string;
  progress?: unknown;
}

export type WorkspaceAvailability = WorkspaceReady | WorkspaceUnavailable;

/**
 * Ba câu hỏi mà tầng tool cần một workspace trả lời, và không hơn. Daemon dựng facade này từ
 * project-router + workspace-pool + readiness-gate + file-sync-watcher; test dựng nó bằng đồ giả.
 */
export interface LspFacade {
  /** Workspace phục vụ đường dẫn này có đang trả lời được không, và nếu không thì vì sao. */
  workspace(filePath: string): WorkspaceAvailability | Promise<WorkspaceAvailability>;
  /** Nội dung HIỆN TẠI của tệp — cơ sở duy nhất hợp lệ để xác thực line/column (INV-TOOL-5). */
  readFile(filePath: string): string | undefined;
  /** Phát một LSP request tới workspace đó. Tầng tool không bao giờ chạm vào khung LSP. */
  request(method: string, params: unknown): Promise<unknown>;
}

// -------------------------------------------------------------------------------------------
// Envelope kết quả
// -------------------------------------------------------------------------------------------

export interface ToolFailure {
  isError: true;
  code: ToolErrorCode;
  message: string;
  detail?: unknown;
}

export type ToolOutcome<T> = { isError: false; value: T } | ToolFailure;

/**
 * Mọi lỗi rời khỏi tầng này đều đi qua đây, nên thông điệp luôn tự nêu tên loại của nó và không
 * envelope lỗi nào mang theo `value` (INV-TOOL-4).
 */
function fail(code: ToolErrorCode, message: string, detail?: unknown): ToolFailure {
  const failure: ToolFailure = { isError: true, code, message: `${code}: ${message}` };
  if (detail !== undefined) failure.detail = detail;
  return failure;
}

// -------------------------------------------------------------------------------------------
// Xác thực tham số (INV-TOOL-5)
// -------------------------------------------------------------------------------------------

/**
 * Tách nội dung thành dòng theo cả ba kiểu xuống dòng. Một tệp rỗng vẫn có đúng một dòng rỗng, nên
 * `line: 1, column: 1` luôn là một vị trí hợp lệ của một tệp tồn tại.
 */
function splitLines(content: string): string[] {
  return content.split(/\r\n|\n|\r/);
}

/**
 * Xác thực một vị trí 1-based so với nội dung hiện tại và hạ nó xuống 0-based. Trả về `ToolFailure`
 * mang mã `invalid-position` cho mọi vi phạm, kèm giới hạn thực tế để người gọi sửa được.
 *
 * Cột được so với `line.length`, tức UTF-16 code unit — cùng đơn vị LSP dùng — nên một ký tự
 * astral-plane chiếm hai cột, đúng như JDT LS sẽ hiểu. `length + 1` được chấp nhận: đó là điểm chèn
 * ngay cuối dòng, một vị trí có thật mà completion thường được gọi ở đó.
 */
export function validatePosition(
  content: string,
  position: SourcePosition,
  filePath: string,
): ToolOutcome<LspPosition> {
  if (!Number.isInteger(position.line)) {
    return fail("invalid-position", `line must be an integer, got ${String(position.line)} for ${filePath}`);
  }
  if (!Number.isInteger(position.column)) {
    return fail("invalid-position", `column must be an integer, got ${String(position.column)} for ${filePath}`);
  }

  const lines = splitLines(content);
  if (position.line < POSITION_BASE) {
    return fail(
      "invalid-position",
      `line ${position.line} is below the first line of ${filePath} (lines are 1-based)`,
    );
  }
  if (position.line > lines.length) {
    return fail(
      "invalid-position",
      `line ${position.line} is past the end of ${filePath}, which has ${lines.length} line(s)`,
    );
  }

  // Chỉ số đã được kẹp trong khoảng hợp lệ ngay bên trên, nên nhánh `?? ""` không bao giờ chạy; nó
  // có mặt để `noUncheckedIndexedAccess` được thoả bằng mã, không bằng một khẳng định kiểu.
  const text = lines[position.line - POSITION_BASE] ?? "";
  if (position.column < POSITION_BASE) {
    return fail(
      "invalid-position",
      `column ${position.column} is below the first column of ${filePath}:${position.line} (columns are 1-based)`,
    );
  }
  if (position.column > text.length + POSITION_BASE) {
    return fail(
      "invalid-position",
      `column ${position.column} is past the end of ${filePath}:${position.line}, ` +
        `which holds ${text.length} UTF-16 code unit(s)`,
    );
  }

  return { isError: false, value: toLspPosition(position) };
}

// -------------------------------------------------------------------------------------------
// Đúc range của một token từ nội dung tệp
// -------------------------------------------------------------------------------------------

const IDENTIFIER_PART = /[\p{L}\p{N}_$]/u;

function isIdentifierPart(codePointText: string): boolean {
  return IDENTIFIER_PART.test(codePointText);
}

/**
 * Range của token định danh phủ lên `character` trên `text`, tính bằng UTF-16 code unit. Đi theo
 * ranh giới code point nên một cặp surrogate không bao giờ bị cắt đôi. Khi vị trí không nằm trên
 * một định danh, range rỗng tại chính vị trí đó — vẫn là một range hợp lệ, không phải trường trống.
 */
function tokenBoundsAt(text: string, character: number): { start: number; end: number } {
  const clamped = Math.max(0, Math.min(character, text.length));

  let start = clamped;
  while (start > 0) {
    // Đi ngược thì không đọc được code point bằng `codePointAt(start - 1)`: ở đúng một cặp surrogate,
    // vị trí đó là nửa sau (trail), và `codePointAt` trả về chính nửa đó chứ không phải cả cặp. Nên
    // bề rộng phải suy ra từ dải trail surrogate, ngược lại token dừng sớm ngay trước một chữ cái
    // astral-plane và range trả về thiếu mất ký tự đầu của định danh.
    const previous = text.charCodeAt(start - 1);
    const isTrailSurrogate = start >= 2 && previous >= 0xdc00 && previous <= 0xdfff;
    const width = isTrailSurrogate ? 2 : 1;
    const candidate = text.slice(start - width, start);
    if (!isIdentifierPart(candidate)) break;
    start -= width;
  }

  let end = clamped;
  while (end < text.length) {
    const next = text.codePointAt(end);
    if (next === undefined) break;
    const width = next > 0xffff ? 2 : 1;
    if (!isIdentifierPart(String.fromCodePoint(next))) break;
    end += width;
  }

  return { start, end };
}

/** Range của token tại một vị trí LSP, trả về trong hệ LSP: người gọi vẫn phải đi qua ranh giới. */
function tokenLspRangeAt(content: string, position: LspPosition): LspRange {
  const lines = splitLines(content);
  const text = lines[position.line] ?? "";
  const bounds = tokenBoundsAt(text, position.character);
  return {
    start: { line: position.line, character: bounds.start },
    end: { line: position.line, character: bounds.end },
  };
}

// -------------------------------------------------------------------------------------------
// Đường gọi tool theo vị trí
// -------------------------------------------------------------------------------------------

export const HOVER_METHOD = "textDocument/hover";
export const COMPLETION_METHOD = "textDocument/completion";

export type PositionCapability = "hover" | "completion";

/**
 * INV-TOOL-6 rút gọn cho lõi: hover thành công LUÔN mang `range`, và "không giải được phần tử nào"
 * là một nhánh có tên chứ không phải một trường bị bỏ trống. Việc nhánh `resolved: false` được ánh
 * xạ ra envelope MCP thế nào là chuyện của feat-tool-hover.
 */
export type HoverAnswer =
  | { resolved: true; contents: string; range: SourceRange }
  | { resolved: false; reason: string };

export interface CompletionItemAnswer {
  label: string;
  detail?: string;
  range: SourceRange;
}

export interface CompletionAnswer {
  items: CompletionItemAnswer[];
}

export interface PositionalRequest {
  path: string;
  /** 1-based, theo X-007 — đúng hệ mà mọi kết quả cũng dùng. */
  line: number;
  column: number;
}

export interface PositionalAnswer {
  path: string;
  workspaceId: string;
  /** Vị trí đã được xác thực, echo lại trong cùng hệ toạ độ với mọi range bên dưới. */
  position: SourcePosition;
  hover?: HoverAnswer;
  completion?: CompletionAnswer;
}

/**
 * Đường đi chung của mọi tool nhận `path/line/column`. Thứ tự các bước là nội dung của hai bất biến,
 * không phải sở thích:
 *
 *   1. hỏi workspace có trả lời được không — chưa sẵn sàng thì dừng ngay với lỗi có tên (INV-TOOL-4);
 *   2. đọc nội dung HIỆN TẠI của tệp;
 *   3. xác thực line/column so với nội dung đó — hỏng thì dừng, và facade chưa hề bị gọi (INV-TOOL-5);
 *   4. chỉ đến đây mới phát LSP request, và mọi vị trí trả về đi qua đúng một ranh giới (INV-TOOL-1).
 */
export async function callPositionalTool(
  facade: LspFacade,
  request: PositionalRequest,
  capabilities: readonly PositionCapability[],
): Promise<ToolOutcome<PositionalAnswer>> {
  const availability = await facade.workspace(request.path);
  if (availability.status !== "ready") {
    // INV-TOOL-4: spike B cho thấy JDT LS trả `[]` thay vì lỗi khi bị hỏi sai chỗ, nên một kết quả
    // rỗng ở đây sẽ được agent đọc là "không có gì cả" và hành động theo. Không bao giờ.
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
  const lspPosition = validated.value;

  const answer: PositionalAnswer = {
    path: request.path,
    workspaceId: availability.workspaceId,
    position,
  };
  const params = { textDocument: { uri: request.path }, position: lspPosition };

  for (const capability of capabilities) {
    if (capability === "hover") {
      let raw: unknown;
      try {
        raw = await facade.request(HOVER_METHOD, params);
      } catch (error) {
        return fail("workspace-crashed", messageOf(error));
      }
      answer.hover = shapeHover(raw, content, lspPosition);
      continue;
    }

    let raw: unknown;
    try {
      raw = await facade.request(COMPLETION_METHOD, params);
    } catch (error) {
      return fail("workspace-crashed", messageOf(error));
    }
    answer.completion = shapeCompletion(raw, content, lspPosition);
  }

  return { isError: false, value: answer };
}

/** Tiện ích một-capability. Chúng tồn tại để không tool nào có lý do dựng đường đi riêng. */
export function hover(
  facade: LspFacade,
  request: PositionalRequest,
): Promise<ToolOutcome<PositionalAnswer>> {
  return callPositionalTool(facade, request, ["hover"]);
}

export function completion(
  facade: LspFacade,
  request: PositionalRequest,
): Promise<ToolOutcome<PositionalAnswer>> {
  return callPositionalTool(facade, request, ["completion"]);
}

// -------------------------------------------------------------------------------------------
// Tạo hình kết quả — mọi range ở đây đều đi qua fromLspRange, không có ngoại lệ
// -------------------------------------------------------------------------------------------

function shapeHover(raw: unknown, content: string, position: LspPosition): HoverAnswer {
  const contents = readHoverContents(raw);
  if (contents === undefined || contents.length === 0) {
    // `reason` chở một toạ độ ra khỏi tầng tool y như `range`, chỉ khác là dưới dạng văn xuôi mà
    // agent đọc. Vì vậy nó đi qua đúng ranh giới chung; tự cộng `POSITION_BASE` tại đây sẽ là ranh
    // giới chuyển đổi thứ ba, và INV-TOOL-1 không còn được một chỗ duy nhất bảo đảm.
    const reported = fromLspPosition(position);
    return {
      resolved: false,
      reason: `${HOVER_METHOD} resolved no element at line ${reported.line}, column ${reported.column}`,
    };
  }
  // JDT LS không bao giờ đặt `Hover.range` (HoverHandler.hover() chỉ setContents), nên range được
  // đúc từ chính nội dung tệp mà bước xác thực đã đọc. Dù nguồn nào, nó vẫn đi qua ranh giới chung.
  const lspRange = readRange(raw) ?? tokenLspRangeAt(content, position);
  return { resolved: true, contents, range: fromLspRange(lspRange) };
}

function shapeCompletion(raw: unknown, content: string, position: LspPosition): CompletionAnswer {
  const rawItems = Array.isArray(raw)
    ? raw
    : isRecord(raw) && Array.isArray(raw.items)
      ? raw.items
      : [];
  const fallback = tokenLspRangeAt(content, position);

  const items: CompletionItemAnswer[] = [];
  for (const rawItem of rawItems) {
    if (!isRecord(rawItem)) continue;
    const label = typeof rawItem.label === "string" ? rawItem.label : undefined;
    if (label === undefined) continue;
    const item: CompletionItemAnswer = {
      label,
      // Cùng một hàm, cùng một hằng số, cùng một phép cộng như hover. Đó là toàn bộ INV-TOOL-1.
      range: fromLspRange(readCompletionRange(rawItem) ?? fallback),
    };
    if (typeof rawItem.detail === "string") item.detail = rawItem.detail;
    items.push(item);
  }
  return { items };
}

function readCompletionRange(item: Record<string, unknown>): LspRange | undefined {
  const direct = readRange(item);
  if (direct !== undefined) return direct;
  const textEdit = item.textEdit;
  if (!isRecord(textEdit)) return undefined;
  return readRange(textEdit) ?? readLspRange(textEdit.replace) ?? readLspRange(textEdit.insert);
}

function readRange(value: unknown): LspRange | undefined {
  if (!isRecord(value)) return undefined;
  return readLspRange(value.range);
}

function readLspRange(value: unknown): LspRange | undefined {
  if (!isRecord(value)) return undefined;
  const start = readLspPosition(value.start);
  const end = readLspPosition(value.end);
  if (start === undefined || end === undefined) return undefined;
  return { start, end };
}

function readLspPosition(value: unknown): LspPosition | undefined {
  if (!isRecord(value)) return undefined;
  if (typeof value.line !== "number" || typeof value.character !== "number") return undefined;
  return { line: value.line, character: value.character };
}

/** LSP cho phép `contents` là string, MarkupContent, MarkedString hoặc mảng của chúng. */
function readHoverContents(raw: unknown): string | undefined {
  if (!isRecord(raw)) return undefined;
  return readMarkup(raw.contents);
}

function readMarkup(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    const parts = value.map(readMarkup).filter((part): part is string => part !== undefined);
    return parts.length === 0 ? undefined : parts.join("\n");
  }
  if (isRecord(value) && typeof value.value === "string") return value.value;
  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
