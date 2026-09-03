// diagnostics — `java_diagnostics` tool (harness/docs/design/tool-surface.md, eight-tool table).
//
// Invariants owned here:
//   INV-DIAG-1  results always carry the queried URI's most recent publishDiagnostics payload, or an
//               explicit "not reported" marker; an empty list never stands for "not computed".
//   INV-TOOL-1  every result position crosses exactly one conversion boundary—tool-layer's
//               `fromLspRange`; this file performs no coordinate arithmetic.
//   INV-TOOL-4  an unavailable workspace or an unroutable path is always a named error; no failure
//               is encoded as an empty success result.
//
// Unlike the three navigation tools, which send an LSP request then shape its reply,
// java_diagnostics NEVER sends a request. Spike B showed diagnostics arrive as pushes and cannot be
// queried again, so only the copy captured by diagnostics-cache can answer (tool-surface.md, Build
// order, item 4). This layer therefore does not use `LspFacade.request` and has a narrower port:
// readiness, routing, and cache reads.
//
// Agents must distinguish these TWO shapes in code:
//   status: "not-reported"  — JDT LS has never pushed anything for this URI. No `problems` field.
//   status: "reported"      — a publish arrived, even if `problems` is empty: "computed and clean".
// The absence of `problems` in the first branch carries the load: if it were an empty array, callers
// reading `problems.length === 0` would mistake "not yet indexed" for "source is clean," exactly the
// answer INV-DIAG-1 forbids.

import {
  fromLspRange,
  type SourceRange,
  type ToolErrorCode,
  type ToolOutcome,
  type WorkspaceAvailability,
} from "./tool-layer.ts";
import {
  canonicalFileUri,
  type Diagnostic,
  type DiagnosticsLookup,
  type DiagnosticsReport,
} from "../lsp/diagnostics-cache.ts";

/** A shaped problem: an LSP Diagnostic with its range in the public coordinate system (X-007). */
export interface Problem {
  range: SourceRange;
  message: string;
  severity?: number;
  source?: string;
  code?: string | number;
}

/**
 * Diagnostics state for ONE URI. This union embodies INV-DIAG-1 at the tool layer: branches differ
 * by `status`, and only the `reported` branch has `problems`.
 */
export type FileDiagnostics =
  | {
      uri: string;
      status: "reported";
      problems: readonly Problem[];
      version?: number;
      /** Time the latest publish arrived, according to the cache clock. */
      receivedAt: number;
    }
  | { uri: string; status: "not-reported" };

export interface DiagnosticsAnswer {
  path: string;
  workspaceId: string;
  /** `file` when `path` points to a file; `project` when it points to a project root. */
  scope: "file" | "project";
  /** File scope has one item; project scope has one item per URI, ordered by URI. */
  files: readonly FileDiagnostics[];
}

/**
 * Result of classifying a path. The tool layer never touches disk itself, so its composition root
 * distinguishes a "file" from a "project root" and shapes the URI, just as tool-layer receives
 * file content from `LspFacade.readFile` instead of reading it itself.
 */
export type DiagnosticsScope = { kind: "file"; uri: string } | { kind: "project" };

/**
 * Narrow port to the rest of the daemon. Three questions and no more; notably no `request`, because
 * this tool is not permitted to issue LSP requests.
 */
export interface DiagnosticsFacade {
  /** Whether the workspace serving this path can answer, and why if it cannot. */
  workspace(path: string): WorkspaceAvailability | Promise<WorkspaceAvailability>;
  /** Whether this path is a file (with its URI) or a whole project; `undefined` when unroutable. */
  scopeOf(path: string): DiagnosticsScope | undefined;
  /**
   * URIs for EVERY project file, including files never published. The tool table says
   * java_diagnostics answers for "every file in the project", so cache keys are insufficient: an
   * unindexed file is absent from the cache, and omitting it reads exactly like "that file is clean".
   */
  projectFiles(workspaceId: string): readonly string[];
}

/** Cache-read port. `DiagnosticsCache` satisfies it structurally; tests inject a fake. */
export interface DiagnosticsReader {
  get(workspaceId: string, uri: string): DiagnosticsLookup;
  list(workspaceId: string): readonly DiagnosticsReport[];
}

export interface DiagnosticsRequest {
  /** A specific file OR a project root for all files (tool-surface.md, eight-tool table). */
  path: string;
}

/** Same error-envelope shape as tool-layer: its message always names its error code. */
function fail(code: ToolErrorCode, message: string, detail?: unknown): ToolOutcome<never> {
  const failure = { isError: true as const, code, message: `${code}: ${message}` };
  return detail === undefined ? failure : { ...failure, detail };
}

/**
 * Step order is the substance of two invariants, not a preference:
 *
 *   1. ask whether the workspace can answer—if not ready, stop immediately with a named error
 *      (INV-TOOL-4). This must precede every cache access: an indexing workspace has an empty cache,
 *      and an empty cache reads exactly like "the project has no errors";
 *   2. classify the path—if unroutable, stop without touching the cache;
 *   3. only then read the cache. Shape every URI independently, retaining the distinction between
 *      "not reported" and "reported empty" for each URI (INV-DIAG-1).
 */
export async function javaDiagnostics(
  facade: DiagnosticsFacade,
  reader: DiagnosticsReader,
  request: DiagnosticsRequest,
): Promise<ToolOutcome<DiagnosticsAnswer>> {
  const availability = await facade.workspace(request.path);
  if (availability.status !== "ready") {
    return fail(
      availability.status,
      `workspace serving ${request.path} cannot answer: ${availability.detail}`,
      availability.progress,
    );
  }

  const scope = facade.scopeOf(request.path);
  if (scope === undefined) {
    return fail("unroutable", `no workspace file or project root matches ${request.path}`);
  }

  const workspaceId = availability.workspaceId;
  const uris = scope.kind === "file" ? [scope.uri] : projectUris(facade, reader, workspaceId);

  return {
    isError: false,
    value: {
      path: request.path,
      workspaceId,
      scope: scope.kind,
      files: uris.map((uri) => shapeLookup(reader.get(workspaceId, uri))),
    },
  };
}

/**
 * Union of two sets: files in the project and URIs published to the cache. The first keeps an
 * unindexed file present as "not reported" rather than making it disappear; the second preserves a
 * real problem at a URI absent from the file list—generated code or a file outside source roots.
 * Sort to make result order deterministic, independent of publish order.
 *
 * The union receives two spellings for the same file: `projectFiles` uses caller spelling while
 * cache keys are normalized by filesystem identity. A Set cannot deduplicate different strings
 * pointing to one file, so both sides must use EXACTLY the cache normalizer. Otherwise ONE physical
 * file produces TWO items, breaking the java_diagnostics table's "one item per file" shape
 * (INV-DIAG-1). The union retains its meaning: unindexed project files and published unnamed URIs
 * both remain present.
 */
function projectUris(
  facade: DiagnosticsFacade,
  reader: DiagnosticsReader,
  workspaceId: string,
): string[] {
  const uris = new Set(facade.projectFiles(workspaceId).map(canonicalFileUri));
  for (const report of reader.list(workspaceId)) uris.add(canonicalFileUri(report.uri));
  return [...uris].sort();
}

/**
 * Maps a cache read into public shape. This is where INV-DIAG-1 lives or dies: the `reported: false`
 * branch must NOT produce `problems`, not even an empty array.
 */
function shapeLookup(lookup: DiagnosticsLookup): FileDiagnostics {
  if (!lookup.reported) return { uri: lookup.uri, status: "not-reported" };

  const entry: FileDiagnostics = {
    uri: lookup.uri,
    status: "reported",
    problems: lookup.diagnostics.map(toProblem),
    receivedAt: lookup.receivedAt,
  };
  if (lookup.version !== undefined) entry.version = lookup.version;
  return entry;
}

/**
 * A raw LSP Diagnostic carries a 0-based range. The only permitted conversion is tool-layer's
 * `fromLspRange`; this file must not add or subtract a line or column index anywhere (INV-TOOL-1).
 */
function toProblem(diagnostic: Diagnostic): Problem {
  const problem: Problem = {
    range: fromLspRange({
      start: { line: diagnostic.range.start.line, character: diagnostic.range.start.character },
      end: { line: diagnostic.range.end.line, character: diagnostic.range.end.character },
    }),
    message: diagnostic.message,
  };
  if (diagnostic.severity !== undefined) problem.severity = diagnostic.severity;
  if (diagnostic.source !== undefined) problem.source = diagnostic.source;
  if (diagnostic.code !== undefined) problem.code = diagnostic.code;
  return problem;
}
