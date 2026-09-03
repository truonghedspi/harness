// diagnostics-cache — which holds the most recent publishDiagnostics report of each URI, per
// workspace (harness/docs/design/runtime-model.md, harness/docs/design/tool-surface.md).
//
// Immutable ownership here:
// INV-DIAG-1 readback always returns the closest payload, or an explicit "unreported" landmark; name
// Empty books never stand for "uncounted".
// INV-DIAG-2 a later publication for the same URI always COMPLETELY replaces the previous publication; problem no
// is never cumulative across publications.
// INV-DIAG-3 diagnostics are always referred to the workspace of the instance that pushed them; a URI does not
// is never served from another workspace's cache.
//
// Why does the cache exist: spike B (harness/docs/design/evidence.md) shows incoming diagnostics as
// push, unsolicited, even for client files that have never didOpen. There is no call to "ask again"
// diagnostics, so the only thing that answers java_diagnostics is the version that caught it when it arrived. Therefore
// the key is (workspaceId, uri), completely independent of the open/close lifecycle.
//
// The LspNotificationSource port is the boundary for lsp-client, the same syntax used by file-sync-watcher
// for LspNotificationSink: component declares narrow port in its own file, wiring daemon later.
// LspClient becomes structurally compatible as soon as it has an onNotification method with this signature;
// Currently LspClient does not route notifications (messages without id are ignored), so part
// the actual wiring belongs to the lsp-client feature, not this file.

import { realpathSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

/** LSP 3.17 method string for notification diagnostics pushed back from the server. */
export const PUBLISH_DIAGNOSTICS_METHOD = "textDocument/publishDiagnostics";

export interface Position {
  line: number;
  character: number;
}

export interface Range {
  start: Position;
  end: Position;
}

/** Minimum shape of a Diagnostic according to LSP; Other fields were kept intact. */
export interface Diagnostic {
  range: Range;
  message: string;
  severity?: number;
  source?: string;
  code?: string | number;
  [key: string]: unknown;
}export interface PublishDiagnosticsParams {
  uri: string;
  version?: number;
  diagnostics: Diagnostic[];
}

/** A report has been captured, with its arrival date. */
export interface DiagnosticsReport {
  readonly uri: string;
  readonly version?: number;
  readonly diagnostics: readonly Diagnostic[];
  readonly receivedAt: number;
}

/**
 * Re-read results. INV-DIAG-1: `reported: false` is an "unreported" milestone, which is different from a report
 * valid with empty `diagnostics`, i.e. "calculated and no more problems".
 */
export type DiagnosticsLookup =
  | ({ readonly reported: true } & DiagnosticsReport)
  | { readonly reported: false; readonly uri: string };

/**
 * Port to a workspace's notification source. LspClient responds to this port as soon as it becomes available
 * onNotification(method, handler); cache never parses the LSP frame itself.
 */
export interface LspNotificationSource {
  onNotification(method: string, handler: (params: unknown) => void): void;
}

export interface DiagnosticsCacheOptions {
  /** Clock injected to test deterministic time stamp. */
  now?: () => number;
}

export interface DiagnosticsCache {
  /**
   * Receives a raw publishDiagnostics payload for a workspace and completely SAVES the old entry of the URI
   * there. Returns false when the payload is malformed — then the cache remains in its previous state.
   */
  absorb(workspaceId: string, params: unknown): boolean;
  /** Read back the most recent report of a URI in a workspace. */
  get(workspaceId: string, uri: string): DiagnosticsLookup;
  /** All URIs reported for a workspace, including empty URIs. */
  list(workspaceId: string): readonly DiagnosticsReport[];
  /** Forgets a workspace (used when pool evicts it). */
  forget(workspaceId: string): void;
  /** Register cache as a notification subscriber of a workspace; returns the deregister function. */
  attach(workspaceId: string, source: LspNotificationSource): () => void;
}

class PushDiagnosticsCache implements DiagnosticsCache {
  readonly #byWorkspace = new Map<string, Map<string, DiagnosticsReport>>();
  readonly #now: () => number;

  public constructor(options: DiagnosticsCacheOptions = {}) {
    this.#now = options.now ?? Date.now;
  }public absorb(workspaceId: string, params: unknown): boolean {
    const payload = readPublishDiagnostics(params);
    if (payload === undefined) return false;

    const uri = canonicalFileUri(payload.uri);

    let workspace = this.#byWorkspace.get(workspaceId);
    if (workspace === undefined) {
      workspace = new Map<string, DiagnosticsReport>();
      this.#byWorkspace.set(workspaceId, workspace);
    }

    // INV-DIAG-2: LSP's publishing model is substitution, not append. Old entry of this URI
    // completely disappears here, even if the new payload is empty — no re-reading of the old item, no merging.
    workspace.set(uri, {
      uri,
      version: payload.version,
      diagnostics: freezeDeep(structuredClone(payload.diagnostics)),
      receivedAt: this.#now(),
    });
    return true;
  }

  public get(workspaceId: string, uri: string): DiagnosticsLookup {
    const canonicalUri = canonicalFileUri(uri);
    const report = this.#byWorkspace.get(workspaceId)?.get(canonicalUri);
    if (report === undefined) return { reported: false, uri };
    return { reported: true, ...report };
  }

  public list(workspaceId: string): readonly DiagnosticsReport[] {
    const workspace = this.#byWorkspace.get(workspaceId);
    if (workspace === undefined) return [];
    return [...workspace.values()];
  }

  public forget(workspaceId: string): void {
    this.#byWorkspace.delete(workspaceId);
  }

  public attach(workspaceId: string, source: LspNotificationSource): () => void {
    let live = true;
    source.onNotification(PUBLISH_DIAGNOSTICS_METHOD, (params: unknown) => {
      if (!live) return;
      this.absorb(workspaceId, params);
    });
    return () => {
      live = false;
    };
  }
}

/**
 * JDT LS reports canonical file URIs. On macOS that makes `/var/...` arrive as `/private/var/...`,
 * and a directory symlink lets a caller spell one existing file two ways on any POSIX host. Cache
 * identity follows filesystem identity so a live publish remains queryable through either spelling.
 *
 * Exported because the cache's key space IS the identity space of a diagnostics URI: any caller that* unions its own URI list with this cache's keys must fold both sides through this one function, or
 * one physical file lands in the union twice. There must be exactly one such function.
 */
export function canonicalFileUri(uri: string): string {
  try {
    return pathToFileURL(realpathSync(fileURLToPath(uri))).href;
  } catch {
    return uri;
  }
}

/**
 * Check the payload shape before it hits the cache. A failed notification is ignored instead
 * override a valid report: this is a one-way push, there is no one to return errors to.
 */
function readPublishDiagnostics(params: unknown): PublishDiagnosticsParams | undefined {
  if (typeof params !== "object" || params === null) return undefined;
  const candidate = params as Record<string, unknown>;
  if (typeof candidate.uri !== "string" || candidate.uri.length === 0) return undefined;
  if (!Array.isArray(candidate.diagnostics)) return undefined;
  return {
    uri: candidate.uri,
    version: typeof candidate.version === "number" ? candidate.version : undefined,
    diagnostics: candidate.diagnostics as Diagnostic[],
  };
}

/** Deep freeze the saved copy: no caller will cache via reference. */
function freezeDeep<T>(value: T): T {
  if (Array.isArray(value)) {
    for (const item of value) freezeDeep(item);
    return Object.freeze(value) as T;
  }
  if (typeof value === "object" && value !== null) {
    for (const item of Object.values(value)) freezeDeep(item);
    return Object.freeze(value) as T;
  }
  return value;
}

export function createDiagnosticsCache(options: DiagnosticsCacheOptions = {}): DiagnosticsCache {
  return new PushDiagnosticsCache(options);
}