// completion — the MCP-layer `java_completion` tool (tool table in harness/docs/design/tool-surface.md).
//
// This is a THIN wrapper. All difficult work belongs to `tool-layer.ts`: query the workspace → read
// current content → validate line/column before every LSP call (INV-TOOL-5), translate coordinates
// through exactly one boundary (INV-TOOL-1), and shape completion items (`shapeCompletion`). This
// file owns the one intentional omission from tool-layer: the size policy for an agent-facing tool:
//
//   INV-TOOL-3  every list over its configured cap is returned truncated WITH `truncated: true` and
//               the REAL total—it is never silently cut and never returned unbounded.
//
// The cap is not a hard-coded truncation-path constant because X-008 is still OPEN. The current 200
// is only a recommendation, so it lives at one named location (`DEFAULT_COMPLETION_CAP`) and can be
// overridden by `JavaCompletionOptions.cap`, matching `references.ts` for `java_references`.

import {
  completion as completionThroughToolLayer,
  type LspFacade,
  type SourcePosition,
  type SourceRange,
  type ToolOutcome,
} from "./tool-layer.ts";

/** Default completion-item-list cap—the X-008 recommendation while that decision remains open. */
export const DEFAULT_COMPLETION_CAP = 200;

/** `java_completion` parameters from the tool table: `path`, `line`, `column` (1-based, X-007). */
export interface JavaCompletionArguments {
  path: string;
  line: number;
  column: number;
}

/** A published completion item, in the same 1-based coordinate system as every other tool. */
export interface JavaCompletionItem {
  label: string;
  detail?: string;
  range: SourceRange;
}

/**
 * `total` and `truncated` are NEVER optional: a field absent when the list fits and present when it
 * is cut forces readers to infer its meaning, while a silent truncation looks exactly like a full
 * answer. They are always present, including when `truncated === false`.
 */
export interface JavaCompletionResult {
  path: string;
  workspaceId: string;
  position: SourcePosition;
  /** Cap actually applied to this call. */
  cap: number;
  /** Item count BEFORE truncation. Equals `items.length` if and only if `truncated === false`. */
  total: number;
  truncated: boolean;
  items: JavaCompletionItem[];
}

export interface JavaCompletionOptions {
  /** Override this call's cap. Omit it to use `DEFAULT_COMPLETION_CAP`. */
  cap?: number;
}

export async function javaCompletion(
  facade: LspFacade,
  args: JavaCompletionArguments,
  options: JavaCompletionOptions = {},
): Promise<ToolOutcome<JavaCompletionResult>> {
  const cap = options.cap ?? DEFAULT_COMPLETION_CAP;

  // tool-layer performs steps 1–4 (workspace, content, position validation, LSP request, and item shaping).
  const outcome = await completionThroughToolLayer(facade, {
    path: args.path,
    line: args.line,
    column: args.column,
  });
  if (outcome.isError) return outcome;

  const answer = outcome.value;
  const items = answer.completion?.items ?? [];

  // INV-TOOL-3. Capture `total` BEFORE truncation; after `slice`, the true total no longer exists.
  // Compare `truncated` with `>`, not `>=`: exactly at cap fits and has lost no item.
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
