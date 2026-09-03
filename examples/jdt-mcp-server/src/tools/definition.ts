// java_definition — thin tool returning the declaration position for a symbol at `path/line/column`
// (harness/docs/design/tool-surface.md, eight-tool table, build-order item 3).
//
// Invariants this file must maintain, and how it does so:
//   INV-TOOL-1  every result position crosses EXACTLY ONE conversion boundary. This file has no
//               line/column arithmetic: the downward direction uses `toLspPosition`, upward uses
//               tool-layer's `fromLspRange`. That is why `java_definition` may not read
//               `range.start.line + 1` itself.
//   INV-TOOL-4  failure is always a named X-003-taxonomy error; "no declaration found" is a named
//               branch (`resolved: false` with a reason), not an ambiguous empty array.
//   INV-TOOL-5  line/column validation happens BEFORE the LSP call—not repeated here, but inherited
//               unchanged from `callPositionalTool`.
//
// Why call `callPositionalTool(facade, request, [])`: the common flow for tools receiving
// path/line/column—ask the workspace, read current content, validate position—belongs to
// feat-tool-layer-core. An empty capability list runs exactly those three steps and sends no request,
// so `java_definition` reuses all validation and error naming rather than copying them. Only sending
// `textDocument/definition` and shaping locations belongs to this file.

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

/** A declaration location: which file and where in it—1-based like every other tool. */
export interface DefinitionLocation {
  path: string;
  range: SourceRange;
}

/**
 * `locations` is always present, even when empty, so callers never distinguish "omitted field" from
 * "no declaration." `resolved` is the named branch for the latter: emptiness has a readable reason,
 * just as hover uses `resolved: false` (INV-TOOL-4).
 */
export type DefinitionAnswer = {
  path: string;
  workspaceId: string;
  /** Validated position, echoed in the same coordinate system as every range below. */
  position: SourcePosition;
} & (
  | { resolved: true; locations: DefinitionLocation[] }
  | { resolved: false; locations: []; reason: string }
);

/**
 * Tool-layer error envelope. tool-layer's `fail` is private to that module, so this recreates its
 * `"<code>: <message>"` convention. Error codes still come from `ToolErrorCode`, leaving the X-003
 * taxonomy closed—no new code is created here.
 */
function fail(code: ToolErrorCode, message: string): ToolFailure {
  return { isError: true, code, message: `${code}: ${message}` };
}

export async function definition(
  facade: LspFacade,
  request: PositionalRequest,
): Promise<ToolOutcome<DefinitionAnswer>> {
  // Steps 1–3 (workspace readiness, current content, position validation) belong to tool-layer.
  // Every error leaving here already has its proper name and no LSP request has been issued.
  const base = await callPositionalTool(facade, request, []);
  if (base.isError) return base;

  // Downward direction of the sole conversion boundary: validated 1-based → LSP 0-based.
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
// Result shaping — every range crosses fromLspRange for EVERY element, without exception
// -------------------------------------------------------------------------------------------

/**
 * LSP permits `textDocument/definition` to return `Location`, `Location[]`, `LocationLink[]`, or
 * `null`. Normalize all four shapes to one array, so callers see one shape only.
 *
 * Ignore an item without both `uri` and `range`, as tool-layer's `shapeCompletion` handles malformed
 * items: an unreadable item has no position to convert, and inventing one is exactly what
 * INV-TOOL-1 forbids.
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

  // Same function, constant, and addition as hover and completion. That is INV-TOOL-1.
  return { path, range: fromLspRange(lspRange) };
}

/** `Location.uri` for the first shape, `LocationLink.targetUri` for the second. */
function readUri(entry: Record<string, unknown>): string | undefined {
  if (typeof entry.uri === "string") return entry.uri;
  if (typeof entry.targetUri === "string") return entry.targetUri;
  return undefined;
}

/**
 * For `LocationLink`, `targetSelectionRange` is the range of the declared identifier itself, while
 * `targetRange` covers the entire declaration body. The agent asks "where is the declaration?", so
 * the identifier is the narrower and more accurate answer; use `targetRange` only if the server
 * omits `targetSelectionRange`.
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
