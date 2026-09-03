// tool-layer — core of `mcp-tool-layer`: parameter validation, coordinate conversion, result shaping
// (harness/docs/design/architecture.md component table, harness/docs/design/tool-surface.md).
//
// Invariants owned here:
//   INV-TOOL-1  every position in every tool result—regardless of its generating LSP method—uses
//               ONE documented coordinate system, converted at EXACTLY ONE boundary; no result
//               mixes the two bases.
//   INV-TOOL-4  every failure is reported as a structured error naming its correct kind; no failure
//               is encoded as an empty success result.
//   INV-TOOL-5  parameter validation rejects line/column outside CURRENT file content limits BEFORE
//               any LSP request is issued.
//
// This layer is a pure function of injected `LspFacade`. It owns no pool, router, readiness gate, or
// watcher: it receives a facade bundling the three questions it must answer and never opens a file
// or process itself. The daemon wires pool/router/readiness/sync and proves it end-to-end in
// feat-prove-cross-process-integration.
//
// Why 1-based: X-007. Everything else an LLM reads about source—compiler errors, `grep -n`, stack
// traces—is 1-based; LSP is 0-based and counts UTF-16 code units. Mixing conventions creates
// off-by-one errors that look like model failures. This file therefore has exactly two functions
// performing that arithmetic: `fromLspPosition` upward and `toLspPosition` downward. Every range,
// capability, and future tool crosses them; no shortcut adds on its own.

/** Closed X-003 taxonomy. No error code outside this list leaves the tool layer. */
export const TOOL_ERROR_CODES = [
  "unroutable",
  "not-ready",
  "resyncing",
  "workspace-crashed",
  "cap-exceeded",
  "invalid-position",
] as const;
export type ToolErrorCode = (typeof TOOL_ERROR_CODES)[number];

/** Position in the public coordinate system: 1-based with UTF-16-code-unit columns (X-007). */
export interface SourcePosition {
  line: number;
  column: number;
}

export interface SourceRange {
  start: SourcePosition;
  end: SourcePosition;
}

/** Position as LSP expresses it: 0-based, with `character` counted in UTF-16 code units. */
export interface LspPosition {
  line: number;
  character: number;
}

export interface LspRange {
  start: LspPosition;
  end: LspPosition;
}

/** Offset between the two systems. Only the two conversion functions below read this constant. */
const POSITION_BASE = 1;

// -------------------------------------------------------------------------------------------
// THE ONLY CONVERSION BOUNDARY (INV-TOOL-1)
// -------------------------------------------------------------------------------------------

/** LSP → public system. The only point in the tool layer that adds to a line or column index. */
export function fromLspPosition(position: LspPosition): SourcePosition {
  return {
    line: position.line + POSITION_BASE,
    column: position.character + POSITION_BASE,
  };
}

/** A range is only two positions; it must not know how conversion works. */
export function fromLspRange(range: LspRange): SourceRange {
  return { start: fromLspPosition(range.start), end: fromLspPosition(range.end) };
}

/** Public system → LSP. The only point in the tool layer that subtracts a line or column index. */
export function toLspPosition(position: SourcePosition): LspPosition {
  return {
    line: position.line - POSITION_BASE,
    character: position.column - POSITION_BASE,
  };
}

// -------------------------------------------------------------------------------------------
// Port to a workspace
// -------------------------------------------------------------------------------------------

export interface WorkspaceReady {
  status: "ready";
  workspaceId: string;
}

/**
 * Every reason a workspace cannot answer is named by the X-003 taxonomy except `invalid-position`:
 * that code belongs to call parameters, not the workspace.
 */
export interface WorkspaceUnavailable {
  status: Exclude<ToolErrorCode, "invalid-position">;
  detail: string;
  progress?: unknown;
}

export type WorkspaceAvailability = WorkspaceReady | WorkspaceUnavailable;

/**
 * The three questions, and no more, that the tool layer needs a workspace to answer. The daemon
 * builds this facade from project-router + workspace-pool + readiness-gate + file-sync-watcher;
 * tests build it with fakes.
 */
export interface LspFacade {
  /** Whether the workspace serving this path can answer, and why if not. */
  workspace(filePath: string): WorkspaceAvailability | Promise<WorkspaceAvailability>;
  /** CURRENT file content—the only valid basis for line/column validation (INV-TOOL-5). */
  readFile(filePath: string): string | undefined;
  /** Sends an LSP request to that workspace. The tool layer never touches the LSP framing. */
  request(method: string, params: unknown): Promise<unknown>;
}

// -------------------------------------------------------------------------------------------
// Result envelope
// -------------------------------------------------------------------------------------------

export interface ToolFailure {
  isError: true;
  code: ToolErrorCode;
  message: string;
  detail?: unknown;
}

export type ToolOutcome<T> = { isError: false; value: T } | ToolFailure;

/**
 * Every error leaving this layer passes here, so its message always names its kind and no error
 * envelope carries `value` (INV-TOOL-4).
 */
function fail(code: ToolErrorCode, message: string, detail?: unknown): ToolFailure {
  const failure: ToolFailure = { isError: true, code, message: `${code}: ${message}` };
  if (detail !== undefined) failure.detail = detail;
  return failure;
}

// -------------------------------------------------------------------------------------------
// Parameter validation (INV-TOOL-5)
// -------------------------------------------------------------------------------------------

/**
 * Splits content into lines for all three newline styles. An empty file still has exactly one empty
 * line, so `line: 1, column: 1` is always a valid position in an existing file.
 */
function splitLines(content: string): string[] {
  return content.split(/\r\n|\n|\r/);
}

/**
 * Validates a 1-based position against current content and lowers it to 0-based. Returns a
 * `ToolFailure` with `invalid-position` for every violation, including actual limits callers need.
 *
 * Columns are compared with `line.length`, in UTF-16 code units like LSP, so an astral-plane
 * character takes two columns as JDT LS understands it. `length + 1` is accepted: it is the real
 * insertion point immediately after a line, where completion is often called.
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

  // The index was constrained to a valid range just above, so `?? ""` never executes; it exists to
  // satisfy `noUncheckedIndexedAccess` in code rather than with a type assertion.
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
// Shape a token range from file content
// -------------------------------------------------------------------------------------------

const IDENTIFIER_PART = /[\p{L}\p{N}_$]/u;

function isIdentifierPart(codePointText: string): boolean {
  return IDENTIFIER_PART.test(codePointText);
}

/**
 * An identifier-token range covers `character` in `text`, measured in UTF-16 code units. It follows
 * code-point boundaries so a surrogate pair is never split. When the position is not on an
 * identifier, the range is empty at that position—still a valid range, not an omitted field.
 */
function tokenBoundsAt(text: string, character: number): { start: number; end: number } {
  const clamped = Math.max(0, Math.min(character, text.length));

  let start = clamped;
  while (start > 0) {
    // Walking backward cannot read a code point with `codePointAt(start - 1)`: in a surrogate pair,
    // that position is its trailing half and `codePointAt` returns that half, not the full pair.
    // Infer width from the trailing-surrogate range instead, or the token stops before an astral
    // character and the returned range omits the identifier's first character.
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

/** Token range at an LSP position, returned in the LSP system; callers still cross the boundary. */
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
// Positional tool call path
// -------------------------------------------------------------------------------------------

export const HOVER_METHOD = "textDocument/hover";
export const COMPLETION_METHOD = "textDocument/completion";

export type PositionCapability = "hover" | "completion";

/**
 * Core form of INV-TOOL-6: successful hover ALWAYS carries `range`, and "no element resolved" is a
 * named branch rather than an omitted field. How `resolved: false` maps to the MCP envelope belongs
 * to feat-tool-hover.
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
  /** 1-based per X-007—the same system every result uses. */
  line: number;
  column: number;
}

export interface PositionalAnswer {
  path: string;
  workspaceId: string;
  /** Validated position, echoed in the same coordinate system as every range below. */
  position: SourcePosition;
  hover?: HoverAnswer;
  completion?: CompletionAnswer;
}

/**
 * Common path for every tool receiving `path/line/column`. Step order is the substance of two
 * invariants, not a preference:
 *
 *   1. ask whether the workspace can answer—if not ready, stop with a named error (INV-TOOL-4);
 *   2. read CURRENT file content;
 *   3. validate line/column against it—on failure stop before calling the facade (INV-TOOL-5);
 *   4. only now send the LSP request, and every returned position crosses exactly one boundary (INV-TOOL-1).
 */
export async function callPositionalTool(
  facade: LspFacade,
  request: PositionalRequest,
  capabilities: readonly PositionCapability[],
): Promise<ToolOutcome<PositionalAnswer>> {
  const availability = await facade.workspace(request.path);
  if (availability.status !== "ready") {
    // INV-TOOL-4: spike B showed JDT LS returns `[]`, not an error, when asked in the wrong place;
    // an empty result here would mean "there is nothing" to the agent, which would act on it. Never.
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

/** Single-capability helpers. They exist so no tool has a reason to construct its own path. */
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
// Result shaping — every range here crosses fromLspRange, without exception
// -------------------------------------------------------------------------------------------

function shapeHover(raw: unknown, content: string, position: LspPosition): HoverAnswer {
  const contents = readHoverContents(raw);
  if (contents === undefined || contents.length === 0) {
    // `reason` carries a coordinate out of tool-layer just like `range`, except as prose the agent
    // reads. It therefore crosses the shared boundary; adding `POSITION_BASE` here would create a
    // third conversion boundary and no single place would guarantee INV-TOOL-1.
    const reported = fromLspPosition(position);
    return {
      resolved: false,
      reason: `${HOVER_METHOD} resolved no element at line ${reported.line}, column ${reported.column}`,
    };
  }
  // JDT LS never sets `Hover.range` (HoverHandler.hover() only setsContents), so range is shaped
  // from the file content read by validation. Whatever its source, it still crosses the shared boundary.
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
      // Same function, constant, and addition as hover. That is all of INV-TOOL-1.
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

/** LSP allows `contents` to be string, MarkupContent, MarkedString, or an array of them. */
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
