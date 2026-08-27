// Oracle mức 1 cho feat-tool-diagnostics.
//
// Falsifier đang bị kiểm chứng: "một URI chưa từng có publish trả về CÙNG một danh sách rỗng như
// một URI mà JDT LS đã báo cáo zero problem, thay vì một mốc 'chưa báo cáo' tách biệt [INV-DIAG-1]".
//
// java_diagnostics khác ba tool điều hướng ở chỗ nó không bao giờ phát LSP request: nó đọc lại một
// cache đẩy (harness/docs/design/tool-surface.md, mục Build order, item 4). Vì vậy tệp này tiêm hai
// đồ giả — một facade workspace và một reader cache — và không có JDT LS thật ở đâu cả.
//
// Điểm chịu lực: hai ca "chưa báo cáo" và "đã báo cáo rỗng" phải phân biệt được BẰNG MÃ. Mọi khẳng
// định dưới đây đều đọc trường `status` và sự CÓ MẶT của `problems`, không dựa vào mắt người đọc.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  javaDiagnostics,
  type DiagnosticsFacade,
  type DiagnosticsReader,
  type DiagnosticsScope,
  type FileDiagnostics,
} from "../../src/tools/diagnostics.ts";
import type {
  Diagnostic,
  DiagnosticsLookup,
  DiagnosticsReport,
} from "../../src/lsp/diagnostics-cache.ts";
import type { WorkspaceAvailability } from "../../src/tools/tool-layer.ts";

const CASE_TIMEOUT = 5_000;

const WORKSPACE_ID = "ws-demo";
const PROJECT_PATH = "/tmp/demo";

const NEVER_PUBLISHED_PATH = "/tmp/demo/src/main/java/demo/Untouched.java";
const CLEAN_PATH = "/tmp/demo/src/main/java/demo/Clean.java";
const BROKEN_PATH = "/tmp/demo/src/main/java/demo/Broken.java";

const NEVER_PUBLISHED_URI = "file:///tmp/demo/src/main/java/demo/Untouched.java";
const CLEAN_URI = "file:///tmp/demo/src/main/java/demo/Clean.java";
const BROKEN_URI = "file:///tmp/demo/src/main/java/demo/Broken.java";
// URI mà JDT LS đã đẩy về nhưng danh sách tệp của project không nêu tên — kết quả toàn project vẫn
// phải mang nó, nếu không một problem có thật biến mất khỏi câu trả lời.
const GENERATED_URI = "file:///tmp/demo/target/generated-sources/demo/Generated.java";

/** Một Diagnostic thô đúng như LSP gửi: dòng/cột 0-based. */
function rawDiagnostic(line: number, character: number, message: string, severity = 1): Diagnostic {
  return {
    range: {
      start: { line, character },
      end: { line, character: character + 4 },
    },
    message,
    severity,
    source: "Java",
    code: "cannot-resolve",
  };
}

const BROKEN_DIAGNOSTIC = rawDiagnostic(4, 10, "Greeterr cannot be resolved to a type");
const GENERATED_DIAGNOSTIC = rawDiagnostic(0, 0, "The value of the field x is not used", 2);

interface FakeCacheOptions {
  /** Chỉ những URI có mặt ở đây mới được coi là ĐÃ có publish. */
  reports?: Record<string, { diagnostics: Diagnostic[]; version?: number; receivedAt?: number }>;
}

interface FakeCache extends DiagnosticsReader {
  /** Số lần tầng tool chạm vào cache — cho phép khẳng định "chưa hề đọc cache". */
  reads(): number;
}

function fakeCache(options: FakeCacheOptions = {}): FakeCache {
  const reports = options.reports ?? {};
  let reads = 0;

  function reportOf(uri: string): DiagnosticsReport | undefined {
    const stored = reports[uri];
    if (stored === undefined) return undefined;
    return {
      uri,
      version: stored.version,
      diagnostics: stored.diagnostics,
      receivedAt: stored.receivedAt ?? 1_700_000_000_000,
    };
  }

  return {
    get(workspaceId: string, uri: string): DiagnosticsLookup {
      reads += 1;
      assert.equal(workspaceId, WORKSPACE_ID, "INV-DIAG-3: cache phải bị hỏi bằng workspace đã định tuyến");
      const report = reportOf(uri);
      if (report === undefined) return { reported: false, uri };
      return { reported: true, ...report };
    },
    list(workspaceId: string): readonly DiagnosticsReport[] {
      reads += 1;
      assert.equal(workspaceId, WORKSPACE_ID, "INV-DIAG-3: cache phải bị hỏi bằng workspace đã định tuyến");
      return Object.keys(reports)
        .map((uri) => reportOf(uri))
        .filter((report): report is DiagnosticsReport => report !== undefined);
    },
    reads(): number {
      return reads;
    },
  };
}

interface FakeFacadeOptions {
  availability?: WorkspaceAvailability;
  scopes?: Record<string, DiagnosticsScope>;
  projectFiles?: readonly string[];
}

function fakeFacade(options: FakeFacadeOptions = {}): DiagnosticsFacade {
  const availability: WorkspaceAvailability = options.availability ?? {
    status: "ready",
    workspaceId: WORKSPACE_ID,
  };
  const scopes: Record<string, DiagnosticsScope> = options.scopes ?? {
    [PROJECT_PATH]: { kind: "project" },
    [NEVER_PUBLISHED_PATH]: { kind: "file", uri: NEVER_PUBLISHED_URI },
    [CLEAN_PATH]: { kind: "file", uri: CLEAN_URI },
    [BROKEN_PATH]: { kind: "file", uri: BROKEN_URI },
  };
  const projectFiles = options.projectFiles ?? [NEVER_PUBLISHED_URI, CLEAN_URI, BROKEN_URI];

  return {
    workspace(): WorkspaceAvailability {
      return availability;
    },
    scopeOf(path: string): DiagnosticsScope | undefined {
      return scopes[path];
    },
    projectFiles(): readonly string[] {
      return projectFiles;
    },
  };
}

/** Lấy đúng một mục của một câu trả lời thành công; mọi thất bại làm ca đỏ ngay tại đây. */
async function singleEntry(
  facade: DiagnosticsFacade,
  reader: DiagnosticsReader,
  path: string,
): Promise<FileDiagnostics> {
  const outcome = await javaDiagnostics(facade, reader, { path });
  assert.equal(outcome.isError, false, `java_diagnostics phải thành công cho ${path}`);
  if (outcome.isError) throw new Error("unreachable");
  assert.equal(outcome.value.scope, "file");
  assert.equal(outcome.value.workspaceId, WORKSPACE_ID);
  assert.equal(outcome.value.files.length, 1, "phạm vi một tệp phải trả về đúng một mục");
  const entry = outcome.value.files[0];
  assert.ok(entry !== undefined);
  return entry;
}

/**
 * Rút gọn một mục về một giá trị nguyên thuỷ mà MÃ đọc được. Đây là hình dạng mà một agent thật sẽ
 * phân nhánh trên đó: nếu "chưa báo cáo" và "sạch" cùng rút gọn về một giá trị, INV-DIAG-1 đã đổ.
 */
function decide(entry: FileDiagnostics): string {
  return entry.status === "reported" ? `clean-or-broken:${entry.problems.length}` : "unknown";
}

test("một URI chưa từng có publish mang mốc 'chưa báo cáo', không phải danh sách rỗng [INV-DIAG-1]", { timeout: CASE_TIMEOUT }, async () => {
  const reader = fakeCache({ reports: { [CLEAN_URI]: { diagnostics: [] } } });
  const entry = await singleEntry(fakeFacade(), reader, NEVER_PUBLISHED_PATH);

  assert.equal(entry.uri, NEVER_PUBLISHED_URI);
  assert.equal(entry.status, "not-reported");
  // Trường `problems` phải VẮNG MẶT: một mảng rỗng ở đây chính là câu trả lời sai mà falsifier mô tả.
  assert.equal("problems" in entry, false, "mốc 'chưa báo cáo' không được mang danh sách problem nào");
  assert.equal(decide(entry), "unknown");
  assert.ok(reader.reads() > 0, "tầng tool phải thật sự hỏi cache");
});

test("một URI đã publish với danh sách rỗng là một kết quả SẠCH thật, không lẫn với 'chưa báo cáo' [INV-DIAG-1]", { timeout: CASE_TIMEOUT }, async () => {
  const reader = fakeCache({ reports: { [CLEAN_URI]: { diagnostics: [], version: 7, receivedAt: 42 } } });
  const facade = fakeFacade();

  const clean = await singleEntry(facade, reader, CLEAN_PATH);
  const unknown = await singleEntry(facade, reader, NEVER_PUBLISHED_PATH);

  assert.equal(clean.status, "reported");
  assert.ok(clean.status === "reported");
  assert.deepEqual([...clean.problems], [], "URI sạch phải trả về một danh sách problem RỖNG THẬT");
  assert.equal(clean.version, 7);
  assert.equal(clean.receivedAt, 42);
  assert.equal(decide(clean), "clean-or-broken:0");

  // Hai ca chỉ khác nhau ở chỗ cache đã từng nhận publish hay chưa; kết quả phải khác nhau bằng mã.
  assert.notEqual(clean.status, unknown.status);
  assert.notEqual(decide(clean), decide(unknown));
  assert.notDeepStrictEqual(clean, unknown);
});

test("một URI có problem thật trả về đúng nội dung, toạ độ đã quy về hệ 1-based", { timeout: CASE_TIMEOUT }, async () => {
  const reader = fakeCache({ reports: { [BROKEN_URI]: { diagnostics: [BROKEN_DIAGNOSTIC] } } });
  const entry = await singleEntry(fakeFacade(), reader, BROKEN_PATH);

  assert.ok(entry.status === "reported");
  assert.equal(entry.problems.length, 1);
  const problem = entry.problems[0];
  assert.ok(problem !== undefined);
  assert.equal(problem.message, "Greeterr cannot be resolved to a type");
  assert.equal(problem.severity, 1);
  assert.equal(problem.source, "Java");
  assert.equal(problem.code, "cannot-resolve");
  // LSP 0-based (4, 10)–(4, 14) → hệ công bố 1-based (5, 11)–(5, 15), đúng một ranh giới chuyển đổi.
  assert.deepEqual(problem.range, {
    start: { line: 5, column: 11 },
    end: { line: 5, column: 15 },
  });
  assert.equal(decide(entry), "clean-or-broken:1");
});

test("phạm vi toàn project giữ đúng phân biệt cho TỪNG URI", { timeout: CASE_TIMEOUT }, async () => {
  const reader = fakeCache({
    reports: {
      [CLEAN_URI]: { diagnostics: [] },
      [BROKEN_URI]: { diagnostics: [BROKEN_DIAGNOSTIC] },
      [GENERATED_URI]: { diagnostics: [GENERATED_DIAGNOSTIC] },
    },
  });

  const outcome = await javaDiagnostics(fakeFacade(), reader, { path: PROJECT_PATH });
  assert.equal(outcome.isError, false);
  if (outcome.isError) throw new Error("unreachable");
  assert.equal(outcome.value.scope, "project");

  const byUri = new Map(outcome.value.files.map((entry) => [entry.uri, entry] as const));
  assert.deepEqual(
    [...byUri.keys()].sort(),
    [BROKEN_URI, CLEAN_URI, GENERATED_URI, NEVER_PUBLISHED_URI].sort(),
    "kết quả toàn project phải hợp nhất tệp của project với mọi URI cache đã nhận",
  );

  const untouched = byUri.get(NEVER_PUBLISHED_URI);
  const clean = byUri.get(CLEAN_URI);
  const broken = byUri.get(BROKEN_URI);
  const generated = byUri.get(GENERATED_URI);
  assert.ok(untouched !== undefined && clean !== undefined);
  assert.ok(broken !== undefined && generated !== undefined);

  assert.equal(untouched.status, "not-reported");
  assert.equal("problems" in untouched, false);

  assert.ok(clean.status === "reported");
  assert.deepEqual([...clean.problems], []);

  assert.ok(broken.status === "reported");
  assert.equal(broken.problems.length, 1);
  assert.equal(broken.problems[0]?.message, "Greeterr cannot be resolved to a type");

  assert.ok(generated.status === "reported");
  assert.equal(generated.problems[0]?.severity, 2);

  // Tổng hợp toàn project vẫn phải phân biệt được bằng mã, không chỉ bằng mắt.
  assert.deepEqual(
    [...byUri.entries()].map(([uri, entry]) => [uri, decide(entry)] as const).sort(),
    [
      [BROKEN_URI, "clean-or-broken:1"],
      [CLEAN_URI, "clean-or-broken:0"],
      [GENERATED_URI, "clean-or-broken:1"],
      [NEVER_PUBLISHED_URI, "unknown"],
    ].sort(),
  );
});

test("một workspace chưa sẵn sàng là lỗi có tên, không phải một project sạch [INV-TOOL-4]", { timeout: CASE_TIMEOUT }, async () => {
  const reader = fakeCache({ reports: { [CLEAN_URI]: { diagnostics: [] } } });
  const facade = fakeFacade({
    availability: { status: "not-ready", detail: "still indexing", progress: { percent: 40 } },
  });

  const outcome = await javaDiagnostics(facade, reader, { path: PROJECT_PATH });
  assert.equal(outcome.isError, true);
  if (!outcome.isError) throw new Error("unreachable");
  assert.equal(outcome.code, "not-ready");
  assert.match(outcome.message, /^not-ready: /);
  assert.deepEqual(outcome.detail, { percent: 40 });
  // Một cache trống + một workspace chưa index xong đọc ra y hệt "không có lỗi nào" nếu tầng tool
  // lỡ hỏi cache trước; nên "chưa hề chạm cache" là đại lượng phải đo.
  assert.equal(reader.reads(), 0, "workspace chưa sẵn sàng thì cache không được đọc lần nào");
});

test("một đường dẫn không định tuyến được là lỗi có tên, không phải một kết quả rỗng [INV-TOOL-4]", { timeout: CASE_TIMEOUT }, async () => {
  const reader = fakeCache();
  const outcome = await javaDiagnostics(fakeFacade(), reader, { path: "/tmp/elsewhere/Foo.java" });

  assert.equal(outcome.isError, true);
  if (!outcome.isError) throw new Error("unreachable");
  assert.equal(outcome.code, "unroutable");
  assert.equal(reader.reads(), 0);
});
