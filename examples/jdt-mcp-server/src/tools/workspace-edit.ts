// workspace-edit — creates and applies WorkspaceEdit, shared with java_rename and java_apply_code_action.
//
// Both mutants receive a WorkspaceEdit from JDT LS (`changes`: URI -> TextEdit[]) and must
// (1) convert it to published data with 1-based coordinates, (2) when `apply:true`, apply it back to disk.
// They are here so that two tools do not have two different versions of the same offset change — an offset error
// coordinates here are a misplaced disk write error, much worse than a display error.

import { readFileSync, writeFileSync } from "node:fs";

import { fromLspRange, type LspRange, type SourceRange } from "./tool-layer.ts";

/** Original shape, keeping range LSP 0-based — correct units needed to convert offset when burning disc. */
export interface RawWorkspaceFileEdit {
  path: string;
  edits: { range: LspRange; newText: string }[];
}

/** Published shape, 1-based coordinates — valid for all results used by the tool. */
export interface WorkspaceTextEdit {
  range: SourceRange;
  newText: string;
}

export interface WorkspaceFileEdit {
  path: string;
  edits: WorkspaceTextEdit[];
}

/** Shape `changes` (URI -> TextEdit[]) to file list, removing broken elements. Keep range LSP. */
export function shapeWorkspaceEdit(raw: unknown): RawWorkspaceFileEdit[] {
  const changes = isRecord(raw) && isRecord(raw.changes) ? raw.changes : undefined;
  if (changes === undefined) return [];

  const files: RawWorkspaceFileEdit[] = [];
  for (const [uri, edits] of Object.entries(changes)) {
    if (!Array.isArray(edits)) continue;
    const shaped: RawWorkspaceFileEdit["edits"] = [];
    for (const edit of edits) {
      if (!isRecord(edit)) continue;
      const range = readLspRange(edit.range);
      if (range === undefined || typeof edit.newText !== "string") continue;
      shaped.push({ range, newText: edit.newText });
    }
    if (shaped.length > 0) files.push({ path: pathOfUri(uri), edits: shaped });
  }
  return files;
}

/** Converts the original shape to a 1-based published shape — passing through exactly one boundary (INV-TOOL-1). */
export function toPublicFileEdits(files: RawWorkspaceFileEdit[]): WorkspaceFileEdit[] {
  return files.map((file) => ({
    path: file.path,edits: file.edits.map((edit) => ({ range: fromLspRange(edit.range), newText: edit.newText })),
  }));
}

/** Writes edits back to disk — uses the original range LSP to change the exact offset. */
export function writeWorkspaceEdits(files: RawWorkspaceFileEdit[]): void {
  for (const file of files) {
    const current = readFileSync(file.path, "utf8");
    const next = applyTextEdits(current, file.edits);
    writeFileSync(file.path, next, "utf8");
  }
}

/**
 * Apply TextEdit to content in REVERSE order of starting position, so that an edit at the beginning does not move
 * offset of rear edit. Offset in UTF-16 code units — the correct unit used by LSP `character`.
 */
export function applyTextEdits(content: string, edits: { range: LspRange; newText: string }[]): string {
  const lines = content.split("\n");
  const offsetOf = (line: number, character: number): number => {
    let offset = 0;
    for (let i = 0; i < line; i += 1) offset += lines[i]!.length + 1;
    return offset + character;
  };

  const sorted = [...edits].sort(
    (a, b) => offsetOf(b.range.start.line, b.range.start.character) - offsetOf(a.range.start.line, a.range.start.character),
  );

  let result = content;
  for (const edit of sorted) {
    const start = offsetOf(edit.range.start.line, edit.range.start.character);
    const end = offsetOf(edit.range.end.line, edit.range.end.character);
    result = result.slice(0, start) + edit.newText + result.slice(end);
  }
  return result;
}

export function pathOfUri(uri: string): string {
  if (!uri.startsWith("file://")) return uri;
  const withoutScheme = uri.slice("file://".length);
  const path = withoutScheme.startsWith("/") ? withoutScheme : `/${withoutScheme}`;
  try {
    return decodeURIComponent(path);
  } catch {
    return path;
  }
}

export function readLspRange(value: unknown): LspRange | undefined {
  if (!isRecord(value)) return undefined;
  const start = readLspPosition(value.start);
  const end = readLspPosition(value.end);
  if (start === undefined || end === undefined) return undefined;
  return { start, end };
}

function readLspPosition(value: unknown): { line: number; character: number } | undefined {
  if (!isRecord(value)) return undefined;  if (typeof value.line !== "number" || typeof value.character !== "number") return undefined;
  return { line: value.line, character: value.character };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
