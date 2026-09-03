// code-action-store — the server-side handle table for the code-actions tool pair.
//
// JDT LS returns unresolved code actions (edit/command undefined, with only opaque `data`; spike D).
// Passing that internal blob through an LLM context window has no value and leaks an implementation
// detail the caller cannot use. Instead, the daemon keeps the blob server-side and gives the caller
// an OPAQUE `actionId` (INV-CA-2). The handle is structurally stale-prone: resolving one minted
// before an edit afterward would apply an edit calculated against source that no longer exists.
// Each handle is therefore bound to (workspaceId, sync generation) when minted, and resolution
// rechecks the generation (INV-CA-1).

export type CodeActionResolve =
  | { ok: true; action: unknown }
  | { ok: false; reason: "expired" | "unknown" };

export interface CodeActionStore {
  /** Mint an opaque actionId bound to (workspaceId, generation). Return the id, never the blob. */
  mint(workspaceId: string, generation: number, action: unknown): string;
  /** Resolve a handle; `expired` when generation changed, `unknown` when id is missing (or another workspace). */
  resolve(workspaceId: string, generation: number, actionId: string): CodeActionResolve;
  /** Find a handle's mint-time workspace and generation without stale checking, so the daemon knows where to resolve it. */
  lookup(actionId: string): { workspaceId: string; generation: number } | undefined;
}

export function createCodeActionStore(): CodeActionStore {
  const entries = new Map<string, { workspaceId: string; generation: number; action: unknown }>();
  let nextId = 1;
  return {
    mint(workspaceId, generation, action) {
      const actionId = `ca-${nextId}`;
      nextId += 1;
      entries.set(actionId, { workspaceId, generation, action });
      return actionId;
    },
    resolve(workspaceId, generation, actionId) {
      const entry = entries.get(actionId);
      if (entry === undefined) return { ok: false, reason: "unknown" };
      if (entry.workspaceId !== workspaceId) return { ok: false, reason: "unknown" };
      if (entry.generation !== generation) return { ok: false, reason: "expired" };
      return { ok: true, action: entry.action };
    },
    lookup(actionId) {
      const entry = entries.get(actionId);
      return entry === undefined ? undefined : { workspaceId: entry.workspaceId, generation: entry.generation };
    },
  };
}
