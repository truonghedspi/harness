// diagnostics-cache — nơi giữ bản báo cáo publishDiagnostics gần nhất của mỗi URI, theo mỗi
// workspace (harness/docs/design/runtime-model.md, harness/docs/design/tool-surface.md).
//
// Bất biến sở hữu tại đây:
//   INV-DIAG-1  đọc lại luôn trả về payload gần nhất, hoặc mốc "chưa báo cáo" tường minh; danh
//               sách rỗng không bao giờ đứng thay cho "chưa tính".
//   INV-DIAG-2  một publish sau cho cùng URI luôn thay thế HOÀN TOÀN publish trước; problem không
//               bao giờ được cộng dồn qua các lần publish.
//   INV-DIAG-3  diagnostics luôn được quy về workspace của instance đã đẩy chúng về; một URI không
//               bao giờ được phục vụ từ cache của workspace khác.
//
// Vì sao cache tồn tại: spike B (harness/docs/design/evidence.md) cho thấy diagnostics tới theo kiểu
// đẩy, không được yêu cầu, kể cả cho tệp client chưa từng didOpen. Không có lời gọi nào để "hỏi lại"
// diagnostics, nên thứ duy nhất trả lời được java_diagnostics là bản đã bắt lấy lúc nó tới. Do đó
// khoá là (workspaceId, uri), độc lập hoàn toàn với vòng đời open/close.
//
// Cổng LspNotificationSource là ranh giới với lsp-client, cùng lối viết mà file-sync-watcher dùng
// cho LspNotificationSink: component khai báo cổng hẹp trong tệp của chính nó, daemon nối dây sau.
// LspClient trở nên tương thích cấu trúc ngay khi có phương thức onNotification cùng chữ ký này;
// hiện tại LspClient chưa định tuyến notification (thông điệp không mang id bị bỏ qua), nên phần
// nối dây thật thuộc về feature của lsp-client, không phải tệp này.

import { realpathSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

/** Chuỗi method của LSP 3.17 cho notification diagnostics đẩy về từ server. */
export const PUBLISH_DIAGNOSTICS_METHOD = "textDocument/publishDiagnostics";

export interface Position {
  line: number;
  character: number;
}

export interface Range {
  start: Position;
  end: Position;
}

/** Hình dạng tối thiểu của một Diagnostic theo LSP; các trường khác được giữ nguyên vẹn. */
export interface Diagnostic {
  range: Range;
  message: string;
  severity?: number;
  source?: string;
  code?: string | number;
  [key: string]: unknown;
}

export interface PublishDiagnosticsParams {
  uri: string;
  version?: number;
  diagnostics: Diagnostic[];
}

/** Một bản báo cáo đã được bắt lấy, kèm thời điểm nó tới. */
export interface DiagnosticsReport {
  readonly uri: string;
  readonly version?: number;
  readonly diagnostics: readonly Diagnostic[];
  readonly receivedAt: number;
}

/**
 * Kết quả đọc lại. INV-DIAG-1: `reported: false` là mốc "chưa báo cáo", khác hẳn một bản báo cáo
 * hợp lệ có `diagnostics` rỗng, tức "đã tính xong và không còn vấn đề".
 */
export type DiagnosticsLookup =
  | ({ readonly reported: true } & DiagnosticsReport)
  | { readonly reported: false; readonly uri: string };

/**
 * Cổng tới nguồn notification của một workspace. LspClient thoả cổng này ngay khi có
 * onNotification(method, handler); cache không bao giờ tự phân tích khung LSP.
 */
export interface LspNotificationSource {
  onNotification(method: string, handler: (params: unknown) => void): void;
}

export interface DiagnosticsCacheOptions {
  /** Đồng hồ tiêm vào để test đóng dấu thời gian tất định. */
  now?: () => number;
}

export interface DiagnosticsCache {
  /**
   * Nhận một payload publishDiagnostics thô cho một workspace và LƯU ĐÈ hoàn toàn mục cũ của URI
   * đó. Trả về false khi payload không đúng dạng — khi đó cache giữ nguyên trạng thái trước.
   */
  absorb(workspaceId: string, params: unknown): boolean;
  /** Đọc lại bản báo cáo gần nhất của một URI trong một workspace. */
  get(workspaceId: string, uri: string): DiagnosticsLookup;
  /** Toàn bộ URI đã có báo cáo của một workspace, kể cả các URI đang rỗng. */
  list(workspaceId: string): readonly DiagnosticsReport[];
  /** Quên sạch một workspace (dùng khi pool evict nó). */
  forget(workspaceId: string): void;
  /** Đăng ký cache làm subscriber notification của một workspace; trả về hàm gỡ đăng ký. */
  attach(workspaceId: string, source: LspNotificationSource): () => void;
}

class PushDiagnosticsCache implements DiagnosticsCache {
  readonly #byWorkspace = new Map<string, Map<string, DiagnosticsReport>>();
  readonly #now: () => number;

  public constructor(options: DiagnosticsCacheOptions = {}) {
    this.#now = options.now ?? Date.now;
  }

  public absorb(workspaceId: string, params: unknown): boolean {
    const payload = readPublishDiagnostics(params);
    if (payload === undefined) return false;

    const uri = canonicalFileUri(payload.uri);

    let workspace = this.#byWorkspace.get(workspaceId);
    if (workspace === undefined) {
      workspace = new Map<string, DiagnosticsReport>();
      this.#byWorkspace.set(workspaceId, workspace);
    }

    // INV-DIAG-2: mô hình publish của LSP là thay-thế, không phải nối-thêm. Mục cũ của URI này
    // biến mất hoàn toàn ở đây, kể cả khi payload mới rỗng — không đọc lại mục cũ, không hợp nhất.
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
 * Exported because the cache's key space IS the identity space of a diagnostics URI: any caller that
 * unions its own URI list with this cache's keys must fold both sides through this one function, or
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
 * Kiểm tra hình dạng payload trước khi nó chạm vào cache. Một notification hỏng bị bỏ qua thay vì
 * ghi đè một bản báo cáo hợp lệ: đây là đường đẩy một chiều, không có ai để trả lỗi về.
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

/** Đóng băng sâu bản sao đã lưu: không người gọi nào cộng dồn được vào cache qua tham chiếu. */
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
