// code-action-store — bảng handle phía server cho cặp tool code-actions.
//
// JDT LS trả code action ở dạng CHƯA giải (edit/command undefined, chỉ có `data` mờ đục; spike D).
// Không có giá trị nào trong việc đưa blob nội bộ đó qua context window của một LLM — và làm vậy còn
// rò một chi tiết cài đặt mà caller không dùng được. Thay vào đó daemon giữ blob phía server và trao
// cho caller một `actionId` MỜ ĐỤC (INV-CA-2). Handle đó là mối nguy stale theo cấu trúc: một handle
// được đúc trước một lần sửa rồi giải sau lần sửa sẽ áp một edit tính trên mã nguồn không còn tồn tại
// nữa, nên mỗi handle bị trói vào (workspaceId, sync generation) lúc đúc và resolve phải kiểm lại
// generation (INV-CA-1).

export type CodeActionResolve =
  | { ok: true; action: unknown }
  | { ok: false; reason: "expired" | "unknown" };

export interface CodeActionStore {
  /** Đúc một actionId mờ đục, trói vào (workspaceId, generation). Trả về id, không bao giờ trả blob. */
  mint(workspaceId: string, generation: number, action: unknown): string;
  /** Tra handle; `expired` khi generation đổi, `unknown` khi id không có (hoặc khác workspace). */
  resolve(workspaceId: string, generation: number, actionId: string): CodeActionResolve;
  /** Tìm workspace + generation lúc đúc của một handle, không kiểm stale — để daemon biết gọi resolve ở đâu. */
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
