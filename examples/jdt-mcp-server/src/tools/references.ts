// references — `java_references` tool: positions referencing the symbol at `path/line/column`
// (harness/docs/design/tool-surface.md tool table, "Result shaping — Size").
//
// Invariant owned here:
//   INV-TOOL-3  every list exceeding its configured cap is returned truncated WITH
//               `truncated: true` and its REAL total—never silently truncated and never returned
//               unbounded in full.
//
// This is a thin tool: it performs no line or column arithmetic. Every outgoing position crosses
// tool-layer's `fromLspRange`, and every incoming position crosses `validatePosition`—one conversion
// boundary for the whole system (INV-TOOL-1). Step order is inherited from tool-layer: ask workspace
// → read current content → validate coordinates → only then send an LSP request. `callPositionalTool`
// does not yet accept `references`, and tool-layer is under checker review and must not change on this
// branch, so this flow is assembled from the functions it exports.
//
// Why the cap is not a hard-coded cutoff: X-008 remains OPEN. The current value, 200, is only a
// recommendation, so it lives in one named location (`DEFAULT_REFERENCE_CAP`) and can be overridden
// by `ReferencesOptions.cap`. When X-008 closes, one line changes value; no logic branch must be revisited.

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
 * Default cap for reference lists. This is X-008's recommendation while that decision remains open:
 * the only place in this file that carries this number. The cutoff logic below reads only `cap`,
 * never this constant directly.
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
 * `total` and `truncated` are NEVER optional fields. A field absent when a list fits but present
 * when truncated forces readers to infer state, and a silent truncation looks exactly like a full
 * answer. They are always present, even when `truncated === false`.
 */
export interface ReferencesAnswer {
  path: string;
  workspaceId: string;
  position: SourcePosition;
  /** The cap actually applied to this call—callers can see where they are limited. */
  cap: number;
  /** Total references BEFORE truncation; equals `references.length` exactly when `truncated === false`. */
  total: number;
  truncated: boolean;
  references: ReferenceLocation[];
}

export interface ReferencesOptions {
  /** Override the cap for this call. Omit it to use `DEFAULT_REFERENCE_CAP`. */
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

  // INV-TOOL-3. Fix `total` BEFORE truncation: after `slice`, the real total no longer exists, so
  // reading `references.length` as total is the classic failure of this invariant.
  // Compare `truncated` with `>`, not `>=`: exactly the cap fits and loses no item.
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
