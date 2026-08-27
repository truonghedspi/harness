// readiness-gate — decides when a workspace may answer a question (harness/docs/design/runtime-model.md).
//
// Invariants owned here:
//   INV-READY-1  a call against a workspace that is not index-ready never returns a successful empty
//                or partial result; it waits within its deadline or fails with an explicit not-ready
//                error carrying progress.
//   INV-READY-2  readiness is decided by a semantic probe answering non-empty, NEVER by ServiceReady
//                or ProjectStatus alone.
//   INV-READY-3  every waiting call is released or failed within its deadline — no call ever waits
//                unbounded on a workspace that never becomes ready.
//
// Why the status notifications are not trusted. Spike A measured `ProjectStatus: OK` at 2293 ms and
// `ServiceReady` at 2306 ms — 13 ms apart, and BEFORE the final workspace-refresh progress notes,
// which still read `100% ... Refreshing '/spike-a/src/test/java'` (harness/docs/design/evidence.md).
// A gate built on either signal opens on a half-built index, and JDT LS answers a query against a
// half-built index with `[]` rather than an error (spike B). The agent then reads "no references
// exist" and deletes live code. So the only thing this gate trusts is a real semantic answer: ask
// the server to resolve a symbol this component just read off the workspace's own disk, and require
// the answer to point back at that same file. `noteStatus` exists to WAKE the probe loop early, and
// deliberately cannot open the gate.
//
// Deadlines are a parameter, never a constant: X-001 (the per-call deadline budget) is still an open
// cross-cutting decision (harness/docs/cross-cutting.md), and a default baked in here would decide it
// by accident for every caller that inherits it.

import { readdirSync, realpathSync, type Dirent } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** The probe request. Spike A: the first correct project-symbol answer lands ~0.5 s AFTER ProjectStatus:OK. */
export const WORKSPACE_SYMBOL = "workspace/symbol";
/** Gap between probe attempts while warming. Not a deadline — the caller always owns that. */
export const DEFAULT_POLL_INTERVAL_MS = 250;
/** Ceiling on one probe request, so a wedged server cannot consume a whole caller budget in one shot. */
export const DEFAULT_PROBE_TIMEOUT_MS = 5_000;

/** The half of `LspClient` this component needs; kept structural so a lease or a fake both fit. */
export interface LspRequester {
  request(method: string, params?: unknown): Promise<unknown>;
}

/**
 * X-001 is open, so the shape stays explicit rather than picking a unit by convention: `at` is an
 * absolute instant (`Date.now()` scale), `withinMs` a duration from now. There is no default.
 */
export type Deadline = { at: number } | { withinMs: number };

export type ReadinessPhase = "unknown" | "probing" | "ready";

/** JDT LS `language/status`; `ServiceStatus` = Starting, Started, Message, Error, ServiceReady, ProjectStatus. */
export interface StatusNote {
  type: string;
  message?: string;
}

/**
 * The observable progress state. `java_workspace_status` (a separate, later tool) turns this into a
 * first-class question an agent can ask; nothing here builds an MCP surface.
 */
export interface ReadinessProgress {
  workspaceId: string;
  phase: ReadinessPhase;
  probeAttempts: number;
  elapsedMs: number;
  /** When ServiceReady arrived — recorded as a hint and as evidence, never as the open signal. */
  serviceReadyAt?: number;
  projectStatusAt?: number;
  lastStatusMessage?: string;
  /** Why the last probe was not accepted; the actionable half of a not-ready error. */
  lastProbeReason?: string;
  readyAt?: number;
}

export interface SemanticProbeResult {
  ok: boolean;
  method: string;
  /** The symbol read off the workspace's own sources, so "known" means known to this process. */
  query: string;
  /** Results that resolved back into this workspace. `ok` requires this to be > 0. */
  matchCount: number;
  sampleUri?: string;
  reason?: string;
}

export interface ReadyTicket {
  workspaceId: string;
  readyAt: number;
  waitedMs: number;
  /** The probe answer the gate opened on — INV-READY-2's "probe recorded before the gate opens". */
  probe: SemanticProbeResult;
}

export interface ReadinessTarget {
  workspaceId: string;
  projectRoot: string;
  client: LspRequester;
}

export interface ReadinessGateOptions {
  /** Normally backed by workspace-pool leases; the gate never spawns or routes anything itself. */
  resolveTarget: (workspaceId: string) => ReadinessTarget | undefined;
  pollIntervalMs?: number;
  probeTimeoutMs?: number;
  /** Injectable so a caller can probe through something other than workspace/symbol. */
  probe?: (target: ProbeTarget, options?: ProbeOptions) => Promise<SemanticProbeResult>;
}

export interface ReadinessGate {
  awaitReady(workspaceId: string, deadline: Deadline): Promise<ReadyTicket>;
  /** Records a `language/status` note and wakes the probe loop. It can never open the gate. */
  noteStatus(workspaceId: string, note: StatusNote): void;
  progress(workspaceId: string): ReadinessProgress;
  /** Forget a workspace's readiness — the daemon calls this when its process dies and is respawned. */
  reset(workspaceId: string): void;
  close(): void;
}

/**
 * X-003's `not-ready`. `isError` is carried here because INV-READY-1's seam is exactly "isError plus
 * a progress payload"; the tool layer maps this object onto its own error envelope.
 */
export class WorkspaceNotReadyError extends Error {
  public readonly code = "not-ready";
  public readonly isError = true;
  public readonly workspaceId: string;
  public readonly progress: ReadinessProgress;

  public constructor(progress: ReadinessProgress, detail: string) {
    super(
      `not-ready: workspace ${progress.workspaceId} is still warming up after ${progress.elapsedMs}ms ` +
        `(${progress.probeAttempts} semantic probe attempt(s); ${detail})`,
    );
    this.name = "WorkspaceNotReadyError";
    this.workspaceId = progress.workspaceId;
    this.progress = progress;
  }
}

// -------------------------------------------------------------------------------------------
// The semantic probe. Exported on its own because it is a seam other components use directly:
// feat-prove-sync demonstrates INV-SYNC-1 through this function, before any capability tool exists.
// -------------------------------------------------------------------------------------------

export interface ProbeTarget {
  projectRoot: string;
  client: LspRequester;
}

export interface ProbeOptions {
  timeoutMs?: number;
  /** Override the discovered symbol — a caller that already knows what it wants resolved. */
  known?: KnownSymbol;
}

export interface KnownSymbol {
  name: string;
  filePath: string;
}

/** Standard Maven layout, in the order a probe should prefer. */
const SOURCE_ROOT_ORDER = ["src/main/java", "src/test/java"];
const EXCLUDED_DIRECTORIES = new Set(["target", "node_modules", "bin"]);
/** Neither declares a type the index can resolve by simple name. */
const NON_TYPE_FILES = new Set(["package-info.java", "module-info.java"]);

/**
 * Pick a symbol that provably exists in this workspace: a top-level Java type, named by its own
 * file. Reading it off disk is what makes it "known" — no fixture, no configuration, and it works on
 * the first call against a project this process has never seen.
 */
export function findKnownSymbol(projectRoot: string): KnownSymbol | undefined {
  const root = canonicalPath(projectRoot);
  const found: string[] = [];
  const walk = (directory: string): void => {
    let entries: Dirent[];
    try {
      entries = readdirSync(directory, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        if (!EXCLUDED_DIRECTORIES.has(entry.name) && !entry.name.startsWith(".")) walk(absolute);
        continue;
      }
      if (!entry.isFile()) continue;
      if (!entry.name.endsWith(".java") || NON_TYPE_FILES.has(entry.name)) continue;
      found.push(absolute);
    }
  };
  walk(root);
  if (found.length === 0) return undefined;

  const rank = (filePath: string): number => {
    const relative = path.relative(root, filePath).split(path.sep).join("/");
    const index = SOURCE_ROOT_ORDER.findIndex(
      (pattern) => relative.startsWith(`${pattern}/`) || relative.includes(`/${pattern}/`),
    );
    return index < 0 ? SOURCE_ROOT_ORDER.length : index;
  };
  // Deterministic: the same workspace always probes with the same symbol, so a failing probe is
  // reproducible rather than depending on directory iteration order.
  found.sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
  const filePath = found.at(0);
  if (filePath === undefined) return undefined;
  return { name: path.basename(filePath, ".java"), filePath };
}

/**
 * Ask the server to resolve a known symbol and judge the answer. Non-empty is necessary but not
 * sufficient: at least one result must resolve back to the very file the symbol was read from.
 * Spike B showed a workspace answering about a file it does not own with `[]`, and a warming index
 * answering with results that point anywhere but here is the same class of lie.
 */
export async function probeSemanticIndex(
  target: ProbeTarget,
  options: ProbeOptions = {},
): Promise<SemanticProbeResult> {
  const known = options.known ?? findKnownSymbol(target.projectRoot);
  if (known === undefined) {
    return {
      ok: false,
      method: WORKSPACE_SYMBOL,
      query: "",
      matchCount: 0,
      reason: `no Java source under ${target.projectRoot} to resolve a known symbol from`,
    };
  }

  const timeoutMs = options.timeoutMs ?? DEFAULT_PROBE_TIMEOUT_MS;
  let raw: unknown;
  try {
    raw = await withTimeout(target.client.request(WORKSPACE_SYMBOL, { query: known.name }), timeoutMs);
  } catch (error) {
    return {
      ok: false,
      method: WORKSPACE_SYMBOL,
      query: known.name,
      matchCount: 0,
      reason: error instanceof Error ? error.message : String(error),
    };
  }

  const entries = Array.isArray(raw) ? raw : [];
  if (entries.length === 0) {
    return {
      ok: false,
      method: WORKSPACE_SYMBOL,
      query: known.name,
      matchCount: 0,
      reason: `${WORKSPACE_SYMBOL} returned 0 results for ${known.name}: the index cannot answer yet`,
    };
  }

  const owned = entries.filter((entry) => resolvesToFile(entry, known.filePath));
  if (owned.length === 0) {
    return {
      ok: false,
      method: WORKSPACE_SYMBOL,
      query: known.name,
      matchCount: 0,
      reason:
        `${WORKSPACE_SYMBOL} answered ${entries.length} result(s) for ${known.name}, but every one ` +
        `resolved outside this workspace (expected ${known.filePath})`,
    };
  }
  return {
    ok: true,
    method: WORKSPACE_SYMBOL,
    query: known.name,
    matchCount: owned.length,
    sampleUri: uriOf(owned[0]),
  };
}

function uriOf(entry: unknown): string | undefined {
  if (typeof entry !== "object" || entry === null) return undefined;
  const location = (entry as { location?: unknown }).location;
  if (typeof location !== "object" || location === null) return undefined;
  const uri = (location as { uri?: unknown }).uri;
  return typeof uri === "string" ? uri : undefined;
}

function resolvesToFile(entry: unknown, filePath: string): boolean {
  const uri = uriOf(entry);
  if (uri === undefined || !uri.startsWith("file:")) return false;
  try {
    // Canonicalised on both sides: X-005 resolves symlinks before deciding identity, and on macOS a
    // tmpdir path reaches us as /var/... on one side and /private/var/... on the other.
    return canonicalPath(fileURLToPath(uri)) === canonicalPath(filePath);
  } catch {
    return false;
  }
}

function canonicalPath(target: string): string {
  const absolute = path.resolve(target);
  try {
    return realpathSync(absolute);
  } catch {
    return absolute;
  }
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () => reject(new Error(`${WORKSPACE_SYMBOL} did not answer within ${timeoutMs}ms`)),
          Math.max(1, timeoutMs),
        );
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

// -------------------------------------------------------------------------------------------
// The gate.
// -------------------------------------------------------------------------------------------

interface GateState {
  workspaceId: string;
  phase: ReadinessPhase;
  probeAttempts: number;
  firstWaitAt: number;
  serviceReadyAt?: number;
  projectStatusAt?: number;
  lastStatusMessage?: string;
  lastProbeReason?: string;
  ticket?: ReadyTicket;
  /** One probe at a time per workspace: concurrent callers share an attempt, never stampede. */
  inFlight?: Promise<SemanticProbeResult>;
  /** Sleeping poll loops, woken by a status note or by close(). */
  wakers: Set<() => void>;
}

const DEADLINE_EXPIRED = Symbol("deadline-expired");

class SemanticReadinessGate implements ReadinessGate {
  readonly #resolveTarget: (workspaceId: string) => ReadinessTarget | undefined;
  readonly #pollIntervalMs: number;
  readonly #probeTimeoutMs: number;
  readonly #probe: (target: ProbeTarget, options?: ProbeOptions) => Promise<SemanticProbeResult>;
  readonly #states = new Map<string, GateState>();
  #closed = false;

  public constructor(options: ReadinessGateOptions) {
    this.#resolveTarget = options.resolveTarget;
    this.#pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
    this.#probeTimeoutMs = options.probeTimeoutMs ?? DEFAULT_PROBE_TIMEOUT_MS;
    this.#probe = options.probe ?? probeSemanticIndex;
  }

  public async awaitReady(workspaceId: string, deadline: Deadline): Promise<ReadyTicket> {
    if (this.#closed) throw new Error("readiness gate is closed; no further calls can wait on it");
    const at = deadlineInstant(deadline);
    const state = this.#state(workspaceId);
    const startedAt = Date.now();

    // Readiness is monotonic for the life of a process: once a probe has answered, later callers do
    // not pay for it again. reset() is how a respawned workspace comes back as unknown.
    if (state.ticket !== undefined) return { ...state.ticket, waitedMs: 0 };

    const target = this.#resolveTarget(workspaceId);
    if (target === undefined) {
      throw new Error(`No live workspace is registered under id ${workspaceId}; nothing to wait for`);
    }
    if (state.phase === "unknown") state.phase = "probing";

    // Every exit from this loop is bounded by `at` (INV-READY-3): the probe is raced against the
    // deadline rather than awaited, so a request that never comes back cannot hold the caller.
    while (!this.#closed) {
      const beforeProbe = at - Date.now();
      if (beforeProbe <= 0) break;

      const outcome = await settleBy(this.#probeOnce(state, target, at), at);
      if (outcome === DEADLINE_EXPIRED) break;
      if (outcome.ok) return this.#open(state, outcome, startedAt);

      const beforeSleep = at - Date.now();
      if (beforeSleep <= 0) break;
      await this.#sleep(state, Math.min(this.#pollIntervalMs, beforeSleep));
    }

    // INV-READY-1: the caller gets an explicit failure carrying what the gate knows, never an empty
    // success it would mistake for "the answer is: nothing".
    throw new WorkspaceNotReadyError(
      this.progress(workspaceId),
      this.#closed ? "gate closed while waiting" : "deadline expired before the semantic probe answered",
    );
  }

  public noteStatus(workspaceId: string, note: StatusNote): void {
    const state = this.#state(workspaceId);
    // Recorded as evidence and used as a hint to probe NOW instead of at the next poll. It does not
    // touch `phase`, `ticket` or anything else the gate opens on — that is INV-READY-2's whole point.
    if (note.type === "ServiceReady") state.serviceReadyAt = Date.now();
    if (note.type === "ProjectStatus" && (note.message ?? "").toUpperCase().includes("OK")) {
      state.projectStatusAt = Date.now();
    }
    if (note.message !== undefined) state.lastStatusMessage = note.message;
    this.#wake(state);
  }

  public progress(workspaceId: string): ReadinessProgress {
    const state = this.#state(workspaceId);
    return {
      workspaceId,
      phase: state.phase,
      probeAttempts: state.probeAttempts,
      elapsedMs: Date.now() - state.firstWaitAt,
      serviceReadyAt: state.serviceReadyAt,
      projectStatusAt: state.projectStatusAt,
      lastStatusMessage: state.lastStatusMessage,
      lastProbeReason: state.lastProbeReason,
      readyAt: state.ticket?.readyAt,
    };
  }

  public reset(workspaceId: string): void {
    const state = this.#states.get(workspaceId);
    if (state === undefined) return;
    this.#wake(state);
    this.#states.delete(workspaceId);
  }

  public close(): void {
    this.#closed = true;
    for (const state of this.#states.values()) this.#wake(state);
  }

  #open(state: GateState, probe: SemanticProbeResult, startedAt: number): ReadyTicket {
    const readyAt = Date.now();
    state.phase = "ready";
    state.lastProbeReason = undefined;
    state.ticket = { workspaceId: state.workspaceId, readyAt, waitedMs: readyAt - startedAt, probe };
    return { ...state.ticket };
  }

  #probeOnce(state: GateState, target: ReadinessTarget, at: number): Promise<SemanticProbeResult> {
    if (state.inFlight !== undefined) return state.inFlight;
    state.probeAttempts += 1;
    // The request is never given more budget than the caller that asked for it, so nothing outlives
    // the deadline it was started under.
    const timeoutMs = Math.min(this.#probeTimeoutMs, Math.max(1, at - Date.now()));
    const attempt = (async (): Promise<SemanticProbeResult> => {
      try {
        return await this.#probe({ projectRoot: target.projectRoot, client: target.client }, { timeoutMs });
      } catch (error) {
        return {
          ok: false,
          method: WORKSPACE_SYMBOL,
          query: "",
          matchCount: 0,
          reason: error instanceof Error ? error.message : String(error),
        };
      } finally {
        state.inFlight = undefined;
      }
    })();
    state.inFlight = attempt;
    return attempt.then((result) => {
      state.lastProbeReason = result.reason;
      return result;
    });
  }

  #sleep(state: GateState, ms: number): Promise<void> {
    return new Promise<void>((resolve) => {
      let done = false;
      const finish = (): void => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        state.wakers.delete(finish);
        resolve();
      };
      const timer = setTimeout(finish, Math.max(0, ms));
      state.wakers.add(finish);
    });
  }

  #wake(state: GateState): void {
    for (const waker of [...state.wakers]) waker();
  }

  #state(workspaceId: string): GateState {
    let state = this.#states.get(workspaceId);
    if (state === undefined) {
      state = {
        workspaceId,
        phase: "unknown",
        probeAttempts: 0,
        firstWaitAt: Date.now(),
        wakers: new Set(),
      };
      this.#states.set(workspaceId, state);
    }
    return state;
  }
}

/** Resolve a `Deadline` to an absolute instant on the `Date.now()` scale. */
export function deadlineInstant(deadline: Deadline): number {
  return "at" in deadline ? deadline.at : Date.now() + deadline.withinMs;
}

/**
 * Await `promise`, but give up at instant `at`. The abandoned promise is left to settle on its own
 * — the caller's budget is the contract, not the request's.
 */
function settleBy<T>(promise: Promise<T>, at: number): Promise<T | typeof DEADLINE_EXPIRED> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value: T | typeof DEADLINE_EXPIRED): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(value);
    };
    const timer = setTimeout(() => finish(DEADLINE_EXPIRED), Math.max(0, at - Date.now()));
    promise.then(finish, () => finish(DEADLINE_EXPIRED));
  });
}

export function createReadinessGate(options: ReadinessGateOptions): ReadinessGate {
  return new SemanticReadinessGate(options);
}
