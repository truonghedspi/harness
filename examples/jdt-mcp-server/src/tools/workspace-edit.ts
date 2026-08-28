// workspace-edit — tạo hình và áp WorkspaceEdit, dùng chung cho java_rename và java_apply_code_action.
//
// Cả hai tool đột biến đều nhận một WorkspaceEdit từ JDT LS (`changes`: URI -> TextEdit[]) và phải
// (1) chuyển nó thành dữ liệu công bố với toạ độ 1-based, (2) khi `apply:true`, áp ngược lên đĩa.
// Chúng nằm ở đây để hai tool không có hai bản khác nhau của cùng một phép đổi offset — một lỗi lệch
// toạ độ ở đây là một lỗi ghi đĩa sai chỗ, tệ hơn nhiều so với một lỗi hiển thị.

import { readFileSync, writeFileSync } from "node:fs";

import { fromLspRange, type LspRange, type SourceRange } from "./tool-layer.ts";

/** Shape gốc, giữ range LSP 0-based — đúng đơn vị cần để đổi offset khi ghi đĩa. */
export interface RawWorkspaceFileEdit {
  path: string;
  edits: { range: LspRange; newText: string }[];
}

/** Shape công bố, toạ độ 1-based — đúng hệ mọi kết quả tool dùng. */
export interface WorkspaceTextEdit {
  range: SourceRange;
  newText: string;
}

export interface WorkspaceFileEdit {
  path: string;
  edits: WorkspaceTextEdit[];
}

/** Shape `changes` (URI -> TextEdit[]) thành danh sách tệp, bỏ phần tử hỏng. Giữ range LSP. */
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

/** Chuyển shape gốc sang shape công bố 1-based — đi qua đúng một ranh giới (INV-TOOL-1). */
export function toPublicFileEdits(files: RawWorkspaceFileEdit[]): WorkspaceFileEdit[] {
  return files.map((file) => ({
    path: file.path,
    edits: file.edits.map((edit) => ({ range: fromLspRange(edit.range), newText: edit.newText })),
  }));
}

/** Ghi ngược các edit lên đĩa — dùng range LSP gốc để đổi offset chính xác. */
export function writeWorkspaceEdits(files: RawWorkspaceFileEdit[]): void {
  for (const file of files) {
    const current = readFileSync(file.path, "utf8");
    const next = applyTextEdits(current, file.edits);
    writeFileSync(file.path, next, "utf8");
  }
}

/**
 * Áp TextEdit lên nội dung theo thứ tự NGƯỢC vị trí bắt đầu, để một edit ở đầu không dịch chuyển
 * offset của edit phía sau. Offset tính bằng UTF-16 code unit — đúng đơn vị LSP `character` dùng.
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
  if (!isRecord(value)) return undefined;
  if (typeof value.line !== "number" || typeof value.character !== "number") return undefined;
  return { line: value.line, character: value.character };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
