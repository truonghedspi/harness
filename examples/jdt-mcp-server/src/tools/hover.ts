// hover — `java_hover` tool in the MCP layer (tool table in harness/docs/design/tool-surface.md).
//
// This is a THIN wrapper. All difficult work belongs to `tool-layer.ts` and must not be repeated here:
//
//   * 1-based ↔ 0-based coordinate conversion crosses EXACTLY one tool-layer boundary [INV-TOOL-1];
//     no `line`/`column` arithmetic occurs here—positions and ranges are forwarded unchanged;
//   * line/column validation against CURRENT file content happens before every LSP call [INV-TOOL-5];
//   * closed X-003 error taxonomy [INV-TOOL-4]: every failure leaving here is a tool-layer error
//     envelope, retaining its code and message;
//   * shape the resolved token's `range` when JDT LS omits `Hover.range`, which it always does
//     (`HoverHandler.hover()` only calls `setContents`; see harness/docs/design/evidence.md).
//
// Invariant owned by this tool: INV-TOOL-6—a SUCCESSFUL `java_hover` result always has a `range`
// locating the source token that hover resolved, in the same coordinate system as every other
// position. The field is never optional: `JavaHoverResolved` requires it, and the only branch with
// no range is the named no-result branch, `resolved: false`. Therefore "success without a range"
// is not a state this source can represent.
//
// Why "no element resolved" is NOT an X-003 error: that closed taxonomy describes system failures
// (unroutable, not ready, process dead, quota exceeded, invalid position). "No symbol here" is a
// correct source-code answer, not a failure, so it is an EXPLICIT no-result with a reason, as
// INV-TOOL-4 requires: no failure is encoded as an empty result and no answer as an omitted field.

import {
  hover as hoverThroughToolLayer,
  type LspFacade,
  type SourcePosition,
  type SourceRange,
  type ToolOutcome,
} from "./tool-layer.ts";

/** `java_hover` arguments, per the tool table: `path`, `line`, `column` (1-based, X-007). */
export interface JavaHoverArguments {
  path: string;
  line: number;
  column: number;
}

/** Shared part of both branches: they always identify the file and position of this result. */
interface JavaHoverBase {
  path: string;
  workspaceId: string;
  /** Validated position, echoed in the SAME coordinate system as the `range` below. */
  position: SourcePosition;
}

export interface JavaHoverResolved extends JavaHoverBase {
  resolved: true;
  /** First content block emitted by JDT LS: the resolved element label. */
  signature: string;
  /** Remaining hover content. Absent when the element has no Javadoc. */
  javadoc?: string;
  /** Raw joined hover content—retained intact so nothing is lost from JDT LS's reply. */
  contents: string;
  /** INV-TOOL-6: required, 1-based, and locates the token resolved by hover. */
  range: SourceRange;
}

export interface JavaHoverUnresolved extends JavaHoverBase {
  resolved: false;
  /** Why there is no answer. Never empty; this branch carries no `range`. */
  reason: string;
}

export type JavaHoverResult = JavaHoverResolved | JavaHoverUnresolved;

/**
 * Calls `textDocument/hover` for the symbol at `path/line/column` and shapes the `java_hover` reply.
 *
 * Flow: all work is in `hoverThroughToolLayer`. This file only reads the converted result and
 * renames fields to the tool's public surface.
 */
export async function javaHover(
  facade: LspFacade,
  args: JavaHoverArguments,
): Promise<ToolOutcome<JavaHoverResult>> {
  const outcome = await hoverThroughToolLayer(facade, {
    path: args.path,
    line: args.line,
    column: args.column,
  });
  // Errors pass directly out: code and message belong to tool-layer; the wrapper does not rename them (X-003).
  if (outcome.isError) return outcome;

  const answer = outcome.value;
  const base: JavaHoverBase = {
    path: answer.path,
    workspaceId: answer.workspaceId,
    // Unchanged from tool-layer. No arithmetic occurs here—that is all of INV-TOOL-1.
    position: answer.position,
  };

  const shaped = answer.hover;
  if (shaped === undefined) {
    // Unreachable when the "hover" capability was requested; if the tool-layer contract changes,
    // this branch remains a named no-result, never a success missing a range.
    return {
      isError: false,
      value: {
        ...base,
        resolved: false,
        reason: `tool layer returned no hover section for ${args.path}`,
      },
    };
  }

  if (!shaped.resolved) {
    return { isError: false, value: { ...base, resolved: false, reason: shaped.reason } };
  }

  const { signature, javadoc } = splitHoverContents(shaped.contents);
  const value: JavaHoverResolved = {
    ...base,
    resolved: true,
    signature,
    contents: shaped.contents,
    // `range` is already 1-based when it leaves tool-layer; forwarding it unchanged is the only
    // way to retain "exactly one conversion boundary."
    range: shaped.range,
  };
  if (javadoc !== undefined) value.javadoc = javadoc;
  return { isError: false, value };
}

/**
 * Splits hover content into the element label and remaining Javadoc.
 *
 * JDT LS emits hover content in a fixed order: element label first, then Javadoc
 * (`HoverInfoProvider`), and tool-layer joins parts with a newline. The first block is therefore
 * the signature. Two block forms are accepted: a bare line or a fenced Markdown code block; the
 * latter occurs when the client negotiates `MarkupContent` rather than `MarkedString`.
 *
 * This is presentation splitting, not data transformation: raw `contents` remains intact in the
 * result, so no wording from JDT LS is lost here.
 */
function splitHoverContents(contents: string): { signature: string; javadoc?: string } {
  const fenced = readFencedBlock(contents);
  const split = fenced ?? readFirstLine(contents);
  const javadoc = split.rest.trim();
  return javadoc.length === 0
    ? { signature: split.signature }
    : { signature: split.signature, javadoc };
}

function readFirstLine(contents: string): { signature: string; rest: string } {
  const breakAt = contents.indexOf("\n");
  if (breakAt < 0) return { signature: contents.trim(), rest: "" };
  return { signature: contents.slice(0, breakAt).trim(), rest: contents.slice(breakAt + 1) };
}

/** A Markdown code block opening the content, for example "```java\n<label>\n```". */
function readFencedBlock(contents: string): { signature: string; rest: string } | undefined {
  const opening = /^\s*```[^\n]*\n/.exec(contents);
  if (opening === null) return undefined;
  const bodyStart = opening[0].length;
  const closing = contents.indexOf("\n```", bodyStart - 1);
  if (closing < 0) return undefined;
  const body = contents.slice(bodyStart, closing).trim();
  const afterFence = contents.indexOf("\n", closing + 1);
  const rest = afterFence < 0 ? "" : contents.slice(afterFence + 1);
  return { signature: body, rest };
}
