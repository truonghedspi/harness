// sync-guard — the INV-SYNC-1 blocking seam (harness/docs/design/runtime-model.md).
//
//   INV-SYNC-1: no tool result is ever computed from a JDT LS view older than the last on-disk
//   change observed in that workspace: the call either reflects the change or fails explicitly,
//   never silently answers from the pre-edit model.
//
// The file-sync-watcher exposes the observable half of that contract — `isQuiescent()` and
// `whenSettled()` — but it only *emits* `workspace/didChangeWatchedFiles`; it never decides whether
// a tool call may answer. That decision is this component's whole job. Two facts matter, and they
// are measured, not assumed (spikes/jdtls-disk-sync.mjs):
//
//   1. `whenSettled()` resolves when the notification is *dispatched* (~120 ms debounce), but
//   2. JDT LS rebuilds its model asynchronously and can keep answering from the pre-edit view for
//      seconds after the notification lands.
//
// So the guard cannot stop at "the notification is out". It must keep probing until the answer
// actually reflects the change (the caller names what "stale" looks like for its query via
// `isStale`), and if the deadline passes first it fails explicitly as `resyncing` — the second half
// of INV-SYNC-1's disjunction.
//
// X-001 is open, so there is no default deadline: the caller names one explicitly (`{ at }` or
// `{ withinMs }`), exactly like the readiness gate.

import type { FileSyncWatcher } from "./file-sync-watcher.ts";

export type SyncDeadline = { at: number } | { withinMs: number };

/** X-003's `resyncing` code: the caller asked too soon after an on-disk edit to get a current answer. */
export class ResyncingError extends Error {
  public readonly code = "resyncing";
  public readonly isError = true;

  public constructor(detail: string) {
    super(`resyncing: ${detail}`);
    this.name = "ResyncingError";
  }
}

export interface SyncGuardOptions {
  /** Delay between stale probes. Defaults to the readiness gate's poll cadence. */
  pollIntervalMs?: number;
}

const DEFAULT_POLL_INTERVAL_MS = 250;

function toInstant(deadline: SyncDeadline): number {
  return "at" in deadline ? deadline.at : Date.now() + deadline.withinMs;
}

/** Race a promise against a timeout that resolves `onTimeout`, and always clear the timer. */
async function raceWithTimeout<T>(promise: Promise<T>, ms: number, onTimeout: T): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((resolve) => {
        timer = setTimeout(() => resolve(onTimeout), ms);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/**
 * Run `run` only once its result is known to reflect the latest on-disk change, and fail as
 * `ResyncingError` if that cannot be confirmed inside `deadline`.
 *
 * `isStale` answers one question: does this result still describe the pre-edit world? It is the
 * caller's responsibility and the only edit-specific part of the contract — the guard itself cannot
 * know what "correct" means for an arbitrary query.
 */
export async function withSyncQuiescence<T>(
  watcher: FileSyncWatcher,
  deadline: SyncDeadline,
  run: () => Promise<T>,
  isStale: (result: T) => boolean,
  options: SyncGuardOptions = {},
): Promise<T> {
  const deadlineAt = toInstant(deadline);
  const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;

  // Fast path: nothing observed is still in flight, so the serialized LSP stream has already carried
  // every dispatched notification ahead of this call — the view is current and `isStale` does not
  // apply (there is no in-flight edit to be stale against). Answering here is the common case.
  if (watcher.isQuiescent()) {
    return run();
  }

  // A pending change exists. First ensure it has been dispatched (the notification is out of the
  // debounce window), then poll until the answer actually reflects it — JDT LS rebuilds async.
  const remaining = deadlineAt - Date.now();
  if (remaining <= 0) {
    throw new ResyncingError("the file-sync watcher has a pending change and the deadline already elapsed");
  }
  const dispatched = await raceWithTimeout(
    watcher.whenSettled().then(() => true),
    remaining,
    false,
  );
  if (!dispatched) {
    throw new ResyncingError("the file-sync watcher did not dispatch its pending change in time");
  }

  for (;;) {
    const result = await run();
    if (!isStale(result)) return result;
    if (Date.now() >= deadlineAt) {
      throw new ResyncingError("the JDT LS view did not catch up to the on-disk change before the deadline");
    }
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }
}
