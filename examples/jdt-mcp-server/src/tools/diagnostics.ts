// diagnostics — tool `java_diagnostics` (harness/docs/design/tool-surface.md, bảng tám tool).
//
// Bất biến sở hữu tại đây:
//   INV-DIAG-1  kết quả luôn mang payload publishDiagnostics gần nhất của URI được hỏi, hoặc một mốc
//               "chưa báo cáo" tường minh; một danh sách rỗng không bao giờ đứng thay cho "chưa tính".
//   INV-TOOL-1  mọi vị trí trong kết quả đi qua đúng một ranh giới chuyển đổi — `fromLspRange` của
//               tool-layer, không có phép cộng trừ toạ độ nào trong tệp này.
//   INV-TOOL-4  workspace chưa trả lời được, hoặc đường dẫn không định tuyến được, luôn là một lỗi
//               có tên; không thất bại nào được mã hoá thành một kết quả thành công rỗng.
//
// Vì sao tool này khác ba tool điều hướng: hover/definition/references đều phát một LSP request rồi
// tạo hình câu trả lời. java_diagnostics KHÔNG BAO GIỜ phát request nào. Spike B cho thấy
// diagnostics tới theo kiểu đẩy và không có lời gọi nào để hỏi lại, nên thứ duy nhất trả lời được là
// bản mà diagnostics-cache đã bắt lấy lúc nó tới (tool-surface.md, Build order, item 4). Vì vậy tầng
// này không dùng `LspFacade.request`, và cổng của nó hẹp hơn hẳn: readiness + định tuyến + đọc cache.
//
// Hai hình dạng mà một agent phải phân biệt được BẰNG MÃ:
//   status: "not-reported"  — JDT LS chưa từng đẩy gì về cho URI này. Không có trường `problems`.
//   status: "reported"      — đã có publish, kể cả khi `problems` rỗng, tức "đã tính xong và sạch".
// Trường `problems` VẮNG MẶT ở nhánh thứ nhất là phần chịu lực: nếu nó tồn tại dưới dạng mảng rỗng,
// mọi người gọi đọc `problems.length === 0` sẽ đọc "chưa index xong" thành "mã nguồn sạch" — đúng
// câu trả lời sai mà INV-DIAG-1 cấm.

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

/** Một problem đã được tạo hình: giống Diagnostic của LSP, nhưng range ở hệ toạ độ công bố (X-007). */
export interface Problem {
  range: SourceRange;
  message: string;
  severity?: number;
  source?: string;
  code?: string | number;
}

/**
 * Trạng thái diagnostics của MỘT URI. Union này là toàn bộ nội dung của INV-DIAG-1 ở tầng tool: hai
 * nhánh khác nhau ở `status`, và chỉ nhánh `reported` mới có `problems`.
 */
export type FileDiagnostics =
  | {
      uri: string;
      status: "reported";
      problems: readonly Problem[];
      version?: number;
      /** Thời điểm publish gần nhất tới nơi, theo đồng hồ của cache. */
      receivedAt: number;
    }
  | { uri: string; status: "not-reported" };

export interface DiagnosticsAnswer {
  path: string;
  workspaceId: string;
  /** `file` khi `path` trỏ vào một tệp; `project` khi nó trỏ vào gốc project. */
  scope: "file" | "project";
  /** Phạm vi một tệp cho đúng một mục; phạm vi project cho một mục cho mỗi URI, sắp xếp theo URI. */
  files: readonly FileDiagnostics[];
}

/**
 * Kết quả phân loại một đường dẫn. Tầng tool không bao giờ tự chạm vào đĩa, nên việc phân biệt "một
 * tệp" với "gốc project" — và việc đúc URI — do người nối dây trả lời, giống hệt cách tool-layer
 * nhận nội dung tệp từ `LspFacade.readFile` thay vì tự đọc.
 */
export type DiagnosticsScope = { kind: "file"; uri: string } | { kind: "project" };

/**
 * Cổng hẹp tới phần còn lại của daemon. Ba câu hỏi, không hơn; đặc biệt KHÔNG có `request`, vì tool
 * này không có quyền phát LSP request nào.
 */
export interface DiagnosticsFacade {
  /** Workspace phục vụ đường dẫn này có đang trả lời được không, và nếu không thì vì sao. */
  workspace(path: string): WorkspaceAvailability | Promise<WorkspaceAvailability>;
  /** Đường dẫn này là một tệp (kèm URI của nó) hay cả project; `undefined` khi không định tuyến được. */
  scopeOf(path: string): DiagnosticsScope | undefined;
  /**
   * URI của MỌI tệp thuộc project, kể cả tệp chưa từng có publish. Bảng tool nói java_diagnostics
   * trả lời cho "every file in the project", nên danh sách khoá của cache là chưa đủ: một tệp chưa
   * được index sẽ vắng mặt khỏi cache, và một câu trả lời bỏ qua nó lại đọc ra y hệt "tệp đó sạch".
   */
  projectFiles(workspaceId: string): readonly string[];
}

/** Cổng đọc cache. `DiagnosticsCache` thoả cổng này theo cấu trúc; test tiêm đồ giả. */
export interface DiagnosticsReader {
  get(workspaceId: string, uri: string): DiagnosticsLookup;
  list(workspaceId: string): readonly DiagnosticsReport[];
}

export interface DiagnosticsRequest {
  /** Một tệp cụ thể, HOẶC gốc project để lấy toàn bộ (tool-surface.md, bảng tám tool). */
  path: string;
}

/** Cùng hình dạng envelope lỗi với tool-layer: thông điệp luôn tự nêu tên mã lỗi của nó. */
function fail(code: ToolErrorCode, message: string, detail?: unknown): ToolOutcome<never> {
  const failure = { isError: true as const, code, message: `${code}: ${message}` };
  return detail === undefined ? failure : { ...failure, detail };
}

/**
 * Thứ tự các bước là nội dung của hai bất biến, không phải sở thích:
 *
 *   1. hỏi workspace có trả lời được không — chưa sẵn sàng thì dừng ngay với lỗi có tên (INV-TOOL-4).
 *      Bước này phải đứng TRƯỚC mọi lần chạm cache: một workspace đang index có cache trống, và một
 *      cache trống đọc ra y hệt "project không có lỗi nào";
 *   2. phân loại đường dẫn — không định tuyến được thì dừng, cache vẫn chưa bị chạm;
 *   3. chỉ đến đây mới đọc cache, và mỗi URI được tạo hình độc lập nên phân biệt "chưa báo cáo" với
 *      "đã báo cáo rỗng" được giữ nguyên cho từng URI (INV-DIAG-1).
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
 * Hợp của hai tập: tệp mà project có, và URI mà cache đã nhận publish. Vế thứ nhất giữ cho tệp chưa
 * được index xuất hiện dưới mốc "chưa báo cáo" thay vì biến mất; vế thứ hai giữ cho một problem có
 * thật ở URI mà danh sách tệp không nêu tên — mã sinh, tệp ngoài source root — không bị bỏ rơi.
 * Sắp xếp để thứ tự kết quả tất định, không phụ thuộc thứ tự publish tới.
 *
 * Hai vế đi vào phép hợp bằng hai cách viết khác nhau cho cùng một tệp: `projectFiles` mang cách
 * viết của người gọi, còn khoá của cache đã được quy chuẩn theo identity của hệ tệp. Một Set không
 * khử được hai chuỗi khác ký tự cùng trỏ một tệp, nên cả hai vế phải đi qua ĐÚNG hàm quy chuẩn mà
 * cache dùng — nếu không, MỘT tệp vật lý cho HAI mục và hình dạng "một mục cho mỗi tệp" của bảng
 * java_diagnostics vỡ (INV-DIAG-1). Phép hợp không đổi nghĩa: tệp project chưa index vẫn có mặt
 * dưới mốc "chưa báo cáo", URI đã publish mà project không nêu tên vẫn có mặt.
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
 * Ánh xạ một lần đọc cache sang hình dạng công bố. Đây là chỗ INV-DIAG-1 sống hay chết: nhánh
 * `reported: false` KHÔNG được sinh ra `problems`, kể cả một mảng rỗng.
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
 * Diagnostic thô của LSP mang range 0-based. Phép chuyển đổi duy nhất hợp lệ là `fromLspRange` của
 * tool-layer; tệp này không được cộng trừ chỉ số dòng hay cột ở bất cứ đâu (INV-TOOL-1).
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
