// Traceability (harness/skills/test-design/SKILL.md, role: Test-Implementer).
//
// Conditions:   TCON-TOOL-0001, TCON-TOOL-0002, TCON-TOOL-0003, TCON-TOOL-0004, TCON-TOOL-0005,
//               TCON-TOOL-0006, TCON-TOOL-0007, TCON-TOOL-0008, TCON-TOOL-0009, TCON-TOOL-0010
// Requirements: INV-TOOL-1, INV-TOOL-3, INV-TOOL-4, INV-TOOL-5, INV-TOOL-6
// Plan:         TP-TOOL-0001 | Feature: feat-prove-navigation-tools
//
// Bài kiểm tra tích hợp mức 3: `java_hover`, `java_definition` và `java_references` chạy qua một
// tiến trình JDT LS THẬT do per-workspace pool thật khởi động. Không có facade giả nào ở đây; phần
// duy nhất tệp này tự dựng là composition root — nơi nối project-router, workspace-pool,
// readiness-gate và nội dung tệp trên đĩa thành `LspFacade` mà tầng tool đòi hỏi. Daemon sản phẩm
// chưa có một nơi nối dây như vậy (feat-prove-cross-process-integration mới sở hữu việc đó), nên
// composition root nằm trong tệp test và chỉ gọi các giao diện đã công bố của bốn thành phần.
//
// Ground truth của mọi toạ độ được tính từ CHÍNH văn bản fixture bằng chỉ số UTF-16 code unit của
// JavaScript, rồi cộng 1 để sang hệ công bố (X-007). Không khẳng định nào lấy giá trị mà cài đặt
// vừa trả về làm kỳ vọng.
//
// Fixture cố ý làm phép đếm khó theo hai cách khác nhau, vì hai chế độ hỏng khác nhau:
//   * dòng BMP mang é ☕ ñ 日本語 ✓ ß — số code unit BẰNG số codepoint nhưng NHỎ HƠN số byte UTF-8,
//     nên nó bắt được cách đếm bằng byte và chỉ cách đếm bằng byte (TCON-TOOL-0001);
//   * dòng astral mang một dãy ký tự astral-plane (mỗi ký tự là một cặp surrogate) — số code unit
//     LỚN HƠN số codepoint, nên nó bắt thêm cách đếm bằng codepoint mà dòng BMP không thể bắt
//     (TCON-TOOL-0002).
//
// Cả hai dòng đều phải LỆCH XA HƠN BỀ RỘNG CỦA TOKEN, và đó là điều kiện có răng chứ không phải một
// chi tiết trang trí. Bản fixture đầu tiên chỉ đặt hai cặp surrogate trước `counter`: phép đếm bằng
// codepoint khi đó lệch đúng hai code unit, tức rơi vào giữa một token dài bảy ký tự, JDT LS vẫn giải
// ra đúng symbol đó và mọi khẳng định vẫn xanh. Mutant "đếm bằng codepoint" sống sót. Vì vậy độ lệch
// mà mỗi dòng gây ra được khẳng định tường minh là LỚN HƠN `SYMBOL.length` ngay trong đợt quét.
//
// Ngoài phạm vi có chủ đích: `resyncing` và `workspace-crashed` của taxonomy X-003 thuộc về
// feat-prove-sync và feat-prove-pool-crash-handling (xem spec_gaps của TP-TOOL-0001).
//
// Về dọn dẹp: mọi tài nguyên đi qua `cleanupStack`, không qua `t.after` trực tiếp. Lý do nằm ở chú
// thích của hàm đó — hook `after` của node:test chạy theo thứ tự đăng ký, nên cách viết quen thuộc
// (`t.after(rmSync)` rồi `t.after(pool.close)`) xoá thư mục lúc JVM còn sống và treo tiến trình test.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { definition, type DefinitionAnswer } from "../../src/tools/definition.ts";
import { javaHover, type JavaHoverResult } from "../../src/tools/hover.ts";
import { references, type ReferencesAnswer } from "../../src/tools/references.ts";
import type {
  LspFacade,
  SourceRange,
  ToolOutcome,
  WorkspaceAvailability,
} from "../../src/tools/tool-layer.ts";
import { resolveWorkspace } from "../../src/workspace/project-router.ts";
import {
  createReadinessGate,
  WorkspaceNotReadyError,
  type ReadinessGate,
  type ReadinessTarget,
} from "../../src/workspace/readiness-gate.ts";
import { createWorkspacePool, type WorkspacePool } from "../../src/workspace/workspace-pool.ts";

// -------------------------------------------------------------------------------------------
// Tham số thời gian. X-001 (ngân sách deadline mỗi lời gọi) còn mở, nên mọi thời hạn ở đây là
// tham số của test chứ không phải hằng số của sản phẩm.
// -------------------------------------------------------------------------------------------

/** Hạn chờ index sẵn sàng cho workspace ấm. Cold start đo được khoảng 4 s trên fixture này. */
const READY_DEADLINE_MS = Number.parseInt(process.env.JDT_READY_DEADLINE_MS ?? "120000", 10);
/** Hạn chờ dùng cho ca not-ready: đủ ngắn để chắc chắn rơi vào giữa lúc index đang xây. */
const WARMING_DEADLINE_MS = Number.parseInt(process.env.JDT_WARMING_DEADLINE_MS ?? "100", 10);
const SWEEP_TIMEOUT_MS = 300_000;

const JDTLS_FIXTURE_HOME = path.resolve(".cache/jdtls-fixture/1.61.0.202607231254");

// -------------------------------------------------------------------------------------------
// Fixture nguồn. Số dòng trong chú thích là số dòng 1-based mà mọi khẳng định dùng.
// -------------------------------------------------------------------------------------------

const FIXTURE_LINES = [
  /* 1 */ "package fixture;",
  /* 2 */ "",
  /* 3 */ "// một dòng chú thích thuần văn xuôi, không có định danh nào để giải",
  /* 4 */ "public class Nav {",
  /* 5 */ "    int counter;",
  /* 6 */ "",
  /* 7 */ '    int bmpUse() { String bmp = "café ☕ ñ 日本語 ✓ ß"; return counter; }',
  /* 8 */ '    int astralUse() { String astral = "𝄞𝒜𝔸𝔹𝔻𝔼𝔽𝔾𝕀𝕁𝕂𝕃 café ☕ ñ 日本語 ✓ ß"; return counter; }',
  /* 9 */ "    int useA() { return counter; }",
  /* 10 */ "    int useB() { return counter + 1; }",
  /* 11 */ "    int useC() { return counter * 2; }",
  /* 12 */ "    void useD() { counter = 0; }",
  /* 13 */ "    void useE() { counter += 1; }",
  /* 14 */ "}",
  /* 15 */ "",
];
const FIXTURE_SOURCE = FIXTURE_LINES.join("\n");

const SYMBOL = "counter";
const DECLARATION_LINE = 5;
const BMP_LINE = 7;
const ASTRAL_LINE = 8;
const COMMENT_LINE = 3;
const BLANK_LINE = 6;
/**
 * Neo thuần ASCII cho hai điều kiện về cap. INV-TOOL-3 nói về việc cắt danh sách, không nói về phép
 * chuyển đổi toạ độ; hỏi từ một dòng có ký tự non-ASCII sẽ khiến một lỗi đếm cột cũng làm đỏ chúng
 * và ta không còn phân biệt được hai bất biến.
 */
const PLAIN_LINE = 9;

/** Văn bản của một dòng 1-based; ném lỗi thay vì trả về `undefined` để fixture không lặng lẽ trượt. */
function lineText(line: number): string {
  const text = FIXTURE_LINES[line - 1];
  assert.ok(text !== undefined, `fixture không có dòng ${line}`);
  return text;
}

/** Cột 1-based của `needle` trên một dòng, đếm bằng UTF-16 code unit — đúng đơn vị mà X-007 công bố. */
function columnOf(line: number, needle: string): number {
  const index = lineText(line).indexOf(needle);
  assert.ok(index >= 0, `fixture: không tìm thấy "${needle}" trên dòng ${line}`);
  return index + 1;
}

/** Range ground-truth của một lần xuất hiện `SYMBOL` bắt đầu tại cột 1-based đã cho. */
function symbolRangeAt(line: number, column: number): SourceRange {
  return {
    start: { line, column },
    end: { line, column: column + SYMBOL.length },
  };
}

function symbolRangeOn(line: number): SourceRange {
  return symbolRangeAt(line, columnOf(line, SYMBOL));
}

/**
 * Mọi lần xuất hiện của `counter` trong fixture TRỪ chính khai báo — tức tập tham chiếu đúng mà
 * `java_references` phải trả về khi `includeDeclaration: false`. Đọc thẳng từ văn bản fixture, nên
 * nó là ground truth độc lập chứ không phải giá trị mà cài đặt vừa sinh ra.
 */
function expectedReferenceRanges(): SourceRange[] {
  const ranges: SourceRange[] = [];
  for (let line = 1; line <= FIXTURE_LINES.length; line += 1) {
    if (line === DECLARATION_LINE) continue;
    const pattern = new RegExp(`\\b${SYMBOL}\\b`, "g");
    for (const match of lineText(line).matchAll(pattern)) {
      ranges.push(symbolRangeAt(line, match.index + 1));
    }
  }
  return ranges;
}

function sortRanges(ranges: readonly SourceRange[]): SourceRange[] {
  return [...ranges].sort(
    (a, b) => a.start.line - b.start.line || a.start.column - b.start.column,
  );
}

// -------------------------------------------------------------------------------------------
// Ngăn xếp dọn dẹp
// -------------------------------------------------------------------------------------------

interface AfterRegistrar {
  after(fn: () => void | Promise<void>): void;
}

/** Đăng ký một bước dọn dẹp. Các bước chạy theo thứ tự NGƯỢC với thứ tự đăng ký. */
type Cleanup = (step: () => void | Promise<void>) => void;

/**
 * `node:test` chạy các hook `after` theo đúng THỨ TỰ ĐĂNG KÝ (kiểm chứng trực tiếp trên node 22).
 * Đăng ký `rmSync(root)` trước rồi `pool.close()` sau vì thế xoá thư mục trong lúc JVM còn sống: lệnh
 * xoá ném lỗi, tiến trình JDT LS sống sót và giữ stdio, và chính tiến trình test không bao giờ thoát.
 *
 * Hàm này đảo ngược thứ tự đó bằng một ngăn xếp duy nhất. Người viết test đăng ký các bước theo đúng
 * trình tự khởi tạo — thư mục trước, pool sau — và ngăn xếp tự tháo theo chiều ngược lại. Mỗi bước
 * được bọc riêng, nên một bước hỏng không chặn các bước còn lại: một khẳng định đỏ giữa chừng vẫn
 * phải bỏ lại một máy sạch.
 */
function cleanupStack(t: AfterRegistrar): Cleanup {
  const steps: Array<() => void | Promise<void>> = [];
  t.after(async () => {
    for (let index = steps.length - 1; index >= 0; index -= 1) {
      try {
        await steps[index]!();
      } catch {
        /* dọn dẹp là best-effort */
      }
    }
  });
  return (step) => {
    steps.push(step);
  };
}

// -------------------------------------------------------------------------------------------
// Composition root: project-router + workspace-pool + readiness-gate + nội dung tệp trên đĩa.
// -------------------------------------------------------------------------------------------

interface LiveHarness {
  facade: LspFacade;
  sourcePath: string;
  projectRoot: string;
  /** Số LSP request đã thật sự rời khỏi tầng tool qua facade — cơ sở của khẳng định INV-TOOL-5. */
  lspRequests(): number;
}

interface HarnessOptions {
  /** Hạn chờ readiness cho mỗi lời gọi tool. Ca not-ready dùng một giá trị rất ngắn. */
  readyDeadlineMs: number;
  /** Bỏ qua bước chờ index ấm lúc dựng, để tool được gọi khi workspace còn đang khởi động. */
  warmUp: boolean;
}

/**
 * Dựng một workspace sống: project Maven thật trên đĩa, tiến trình JDT LS thật do pool spawn,
 * handshake initialize thật, readiness-gate thật.
 *
 * Mỗi tài nguyên được đẩy vào `cleanup` NGAY khi nó tồn tại, chứ không phải sau khi hàm trả về. Nếu
 * handshake ném lỗi giữa chừng, pool đã spawn vẫn được đóng; nếu chờ tới lúc trả về mới đăng ký thì
 * một JVM mồ côi sẽ giữ tiến trình test lại mãi mãi.
 */
async function startLiveWorkspace(
  root: string,
  name: string,
  options: HarnessOptions,
  cleanup: Cleanup,
): Promise<LiveHarness> {
  const projectRoot = path.join(root, name);
  const sourcePath = path.join(projectRoot, "src/main/java/fixture/Nav.java");
  mkdirSync(path.dirname(sourcePath), { recursive: true });
  writeFileSync(
    path.join(projectRoot, "pom.xml"),
    "<project><modelVersion>4.0.0</modelVersion><groupId>fixture</groupId>" +
      `<artifactId>${name}</artifactId><version>1</version></project>\n`,
  );
  writeFileSync(sourcePath, FIXTURE_SOURCE, "utf8");

  const pool: WorkspacePool = createWorkspacePool({
    cacheRoot: path.join(root, `cache-${name}`),
    maxWorkspaces: 3,
  });
  cleanup(() => pool.close());

  const targets = new Map<string, ReadinessTarget>();
  const gate: ReadinessGate = createReadinessGate({
    resolveTarget: (workspaceId) => targets.get(workspaceId),
  });
  cleanup(() => gate.close());

  const routed = resolveWorkspace(sourcePath);
  assert.ok(!("error" in routed), `fixture phải định tuyến được: ${JSON.stringify(routed)}`);
  const lease = await pool.acquire(routed.projectRoot);
  cleanup(() => lease.release());
  const client = lease.client;
  assert.ok(client, "pool phải trả về LspClient của tiến trình JDT LS thật");

  // Nửa server→client của handshake. JDT LS treo nếu không ai trả lời ba request này.
  client.onRequest("workspace/configuration", (params) => {
    const items = (params as { items?: unknown[] } | undefined)?.items;
    return Array.from({ length: Array.isArray(items) ? items.length : 0 }, () => ({}));
  });
  client.onRequest("client/registerCapability", () => null);
  client.onRequest("window/workDoneProgress/create", () => null);
  client.onNotification("language/status", (params) => {
    const note = params as { type?: unknown; message?: unknown };
    if (typeof note.type !== "string") return;
    gate.noteStatus(lease.workspaceId, {
      type: note.type,
      message: typeof note.message === "string" ? note.message : undefined,
    });
  });

  const projectUri = pathToFileURL(routed.projectRoot).href;
  await client.request("initialize", {
    processId: process.pid,
    rootUri: projectUri,
    workspaceFolders: [{ uri: projectUri, name }],
    capabilities: {
      workspace: { configuration: true, workspaceFolders: true },
      textDocument: {
        hover: { contentFormat: ["plaintext", "markdown"] },
        publishDiagnostics: {},
      },
    },
  });
  client.notify("initialized", {});
  targets.set(lease.workspaceId, {
    workspaceId: lease.workspaceId,
    projectRoot: routed.projectRoot,
    client,
  });
  client.notify("textDocument/didOpen", {
    textDocument: {
      uri: pathToFileURL(sourcePath).href,
      languageId: "java",
      version: 1,
      text: FIXTURE_SOURCE,
    },
  });

  let lspRequests = 0;
  const facade: LspFacade = {
    workspace: async (filePath: string): Promise<WorkspaceAvailability> => {
      const resolution = resolveWorkspace(filePath);
      if ("error" in resolution) return { status: "unroutable", detail: resolution.error };
      const held = await pool.acquire(resolution.projectRoot);
      try {
        await gate.awaitReady(held.workspaceId, { withinMs: options.readyDeadlineMs });
      } catch (error) {
        if (error instanceof WorkspaceNotReadyError) {
          return { status: "not-ready", detail: error.message, progress: error.progress };
        }
        throw error;
      } finally {
        // Trả lease ngay: mỗi lời gọi tool mượn workspace đúng một lần, và một lease bị bỏ quên sẽ
        // tích luỹ qua hàng chục lời gọi rồi giữ pool lại lúc đóng.
        await held.release();
      }
      return { status: "ready", workspaceId: held.workspaceId };
    },
    readFile: (filePath: string): string | undefined => {
      try {
        return readFileSync(filePath, "utf8");
      } catch {
        return undefined;
      }
    },
    request: async (method: string, params: unknown): Promise<unknown> => {
      lspRequests += 1;
      // Tầng tool đặt `uri` bằng đúng đường dẫn nó nhận được; chuyển sang file URI là việc của
      // composition root, vì chỉ nó biết tệp nằm trên hệ thống tệp nào.
      const shaped = params as { textDocument: { uri: string } };
      return client.request(method, {
        ...shaped,
        textDocument: { ...shaped.textDocument, uri: pathToFileURL(shaped.textDocument.uri).href },
      });
    },
  };

  if (options.warmUp) {
    await gate.awaitReady(lease.workspaceId, { withinMs: READY_DEADLINE_MS });
  }

  return {
    facade,
    sourcePath,
    projectRoot: routed.projectRoot,
    lspRequests: () => lspRequests,
  };
}

// -------------------------------------------------------------------------------------------
// Trợ giúp khẳng định
// -------------------------------------------------------------------------------------------

function unwrap<T>(outcome: ToolOutcome<T>, label: string): T {
  assert.equal(
    outcome.isError,
    false,
    `${label} phải thành công, nhận được ${JSON.stringify(outcome)}`,
  );
  return (outcome as { isError: false; value: T }).value;
}

/** `java_definition` trả URI, `java_references` trả đường dẫn; so sánh về cùng một dạng đường dẫn. */
function asFsPath(value: string): string {
  const raw = value.startsWith("file:") ? fileURLToPath(value) : value;
  try {
    return realpathSync(raw);
  } catch {
    return raw;
  }
}

function assertResolvedHover(result: JavaHoverResult, label: string): SourceRange {
  assert.equal(
    result.resolved,
    true,
    `${label}: java_hover phải giải được symbol, nhận được ${JSON.stringify(result)}`,
  );
  assert.ok(
    "range" in result && result.range !== undefined && result.range !== null,
    `${label}: kết quả java_hover thành công LUÔN mang range (INV-TOOL-6)`,
  );
  return (result as { range: SourceRange }).range;
}

function assertDeclarationLocation(answer: DefinitionAnswer, sourcePath: string, label: string): void {
  assert.equal(
    answer.resolved,
    true,
    `${label}: java_definition phải tìm được khai báo, nhận được ${JSON.stringify(answer)}`,
  );
  assert.equal(answer.locations.length, 1, `${label}: fixture chỉ có đúng một khai báo của ${SYMBOL}`);
  const location = answer.locations[0]!;
  assert.equal(asFsPath(location.path), asFsPath(sourcePath), `${label}: khai báo phải nằm trong chính tệp fixture`);
  assert.deepEqual(
    location.range,
    symbolRangeOn(DECLARATION_LINE),
    `${label}: range của khai báo phải khớp offset thật của "${SYMBOL}" trên dòng ${DECLARATION_LINE}`,
  );
}

function assertReferenceSet(answer: ReferencesAnswer, sourcePath: string, label: string): void {
  for (const reference of answer.references) {
    assert.equal(
      asFsPath(reference.path),
      asFsPath(sourcePath),
      `${label}: mọi tham chiếu phải nằm trong tệp fixture`,
    );
  }
  assert.deepEqual(
    sortRanges(answer.references.map((reference) => reference.range)),
    sortRanges(expectedReferenceRanges()),
    `${label}: tập range tham chiếu phải khớp từng offset thật trong fixture`,
  );
}

// -------------------------------------------------------------------------------------------
// Đợt quét chính: một tiến trình JDT LS ấm phục vụ tám điều kiện.
// -------------------------------------------------------------------------------------------

test(
  "feat-prove-navigation-tools: hover/definition/references qua pool thật trên fixture non-ASCII và astral-plane",
  { timeout: SWEEP_TIMEOUT_MS },
  async (t) => {
    process.env.JDTLS_HOME = JDTLS_FIXTURE_HOME;
    const cleanup = cleanupStack(t);
    const root = realpathSync(mkdtempSync(path.join(tmpdir(), "jdt-nav-")));
    // Đăng ký theo trình tự khởi tạo; `cleanupStack` tháo theo chiều ngược lại, nên thư mục chỉ bị
    // xoá SAU khi mọi tiến trình con đã dừng hẳn.
    cleanup(() => rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }));

    const live = await startLiveWorkspace(
      root,
      "warm",
      { readyDeadlineMs: READY_DEADLINE_MS, warmUp: true },
      cleanup,
    );
    const { facade, sourcePath } = live;

    // Kỳ vọng của fixture, tính trước một lần và dùng lại — mọi giá trị đến từ văn bản nguồn.
    const bmpColumn = columnOf(BMP_LINE, SYMBOL);
    const astralColumn = columnOf(ASTRAL_LINE, SYMBOL);
    const plainColumn = columnOf(PLAIN_LINE, SYMBOL);
    const expectedReferences = expectedReferenceRanges();
    assert.equal(
      lineText(PLAIN_LINE),
      Buffer.from(lineText(PLAIN_LINE), "utf8").toString("latin1"),
      "neo của hai ca cap phải thuần ASCII, nếu không nó lại đo INV-TOOL-1 một lần nữa",
    );

    // Fixture phải thật sự làm phép đếm khó, nếu không cả hai điều kiện đầu đều vô nghĩa. Mỗi cách
    // đếm sai đẩy vị trí được hỏi đi một quãng; quãng đó phải VƯỢT bề rộng token, nếu không lời gọi
    // vẫn rơi vào giữa `counter`, JDT LS vẫn giải ra đúng symbol và cách đếm sai không để lại dấu vết.
    const bmpPrefix = lineText(BMP_LINE).slice(0, bmpColumn - 1);
    const astralPrefix = lineText(ASTRAL_LINE).slice(0, astralColumn - 1);
    assert.equal(
      [...bmpPrefix].length,
      bmpPrefix.length,
      "dòng BMP không được chứa cặp surrogate: nó tồn tại để cô lập cách đếm bằng byte",
    );
    assert.ok(
      Buffer.byteLength(bmpPrefix, "utf8") - bmpPrefix.length > SYMBOL.length,
      "độ lệch byte↔code unit của dòng BMP phải vượt bề rộng token, nếu không lỗi đếm byte vẫn rơi trong token",
    );
    assert.ok(
      astralPrefix.length - [...astralPrefix].length > SYMBOL.length,
      "độ lệch code unit↔codepoint của dòng astral phải vượt bề rộng token, nếu không lỗi đếm " +
        "codepoint vẫn rơi trong token và mutant tương ứng sống sót",
    );

    await t.test(
      "TCON-TOOL-0001: ba tool đều báo đúng offset thật trên dòng chứa ký tự non-ASCII một code unit [INV-TOOL-1]",
      async () => {
        const hover = unwrap(
          await javaHover(facade, { path: sourcePath, line: BMP_LINE, column: bmpColumn }),
          "java_hover trên dòng BMP",
        );
        const range = assertResolvedHover(hover, "dòng BMP");
        assert.deepEqual(hover.position, { line: BMP_LINE, column: bmpColumn });
        assert.deepEqual(
          range,
          symbolRangeAt(BMP_LINE, bmpColumn),
          "range của hover phải khớp offset UTF-16 thật, không phải số byte UTF-8 hay số codepoint",
        );

        const declaration = unwrap(
          await definition(facade, { path: sourcePath, line: BMP_LINE, column: bmpColumn }),
          "java_definition trên dòng BMP",
        );
        assert.deepEqual(declaration.position, { line: BMP_LINE, column: bmpColumn });
        assertDeclarationLocation(declaration, sourcePath, "dòng BMP");

        const found = unwrap(
          await references(
            facade,
            { path: sourcePath, line: BMP_LINE, column: bmpColumn, includeDeclaration: false },
            { cap: expectedReferences.length },
          ),
          "java_references trên dòng BMP",
        );
        assert.deepEqual(found.position, { line: BMP_LINE, column: bmpColumn });
        assertReferenceSet(found, sourcePath, "dòng BMP");
      },
    );

    await t.test(
      "TCON-TOOL-0002: ba tool đều báo đúng offset thật trên dòng chứa cặp surrogate astral-plane [INV-TOOL-1]",
      async () => {
        const hover = unwrap(
          await javaHover(facade, { path: sourcePath, line: ASTRAL_LINE, column: astralColumn }),
          "java_hover trên dòng astral",
        );
        const range = assertResolvedHover(hover, "dòng astral");
        assert.deepEqual(hover.position, { line: ASTRAL_LINE, column: astralColumn });
        assert.deepEqual(
          range,
          symbolRangeAt(ASTRAL_LINE, astralColumn),
          "một ký tự astral-plane chiếm HAI code unit; đếm nó là một codepoint làm range lệch sang token khác",
        );

        const declaration = unwrap(
          await definition(facade, { path: sourcePath, line: ASTRAL_LINE, column: astralColumn }),
          "java_definition trên dòng astral",
        );
        assert.deepEqual(declaration.position, { line: ASTRAL_LINE, column: astralColumn });
        assertDeclarationLocation(declaration, sourcePath, "dòng astral");

        const found = unwrap(
          await references(
            facade,
            { path: sourcePath, line: ASTRAL_LINE, column: astralColumn, includeDeclaration: false },
            { cap: expectedReferences.length },
          ),
          "java_references trên dòng astral",
        );
        assert.deepEqual(found.position, { line: ASTRAL_LINE, column: astralColumn });
        assertReferenceSet(found, sourcePath, "dòng astral");
      },
    );

    await t.test(
      "TCON-TOOL-0003: ba tool nói cùng MỘT hệ toạ độ cho cùng một vị trí symbol [INV-TOOL-1]",
      async () => {
        const request = { path: sourcePath, line: ASTRAL_LINE, column: astralColumn };
        const hover = unwrap(await javaHover(facade, request), "java_hover trong đợt quét chung");
        const declaration = unwrap(await definition(facade, request), "java_definition trong đợt quét chung");
        const found = unwrap(
          await references(facade, { ...request, includeDeclaration: true }, { cap: 1_000 }),
          "java_references trong đợt quét chung",
        );

        // Cùng một vị trí được ba tool echo lại y hệt nhau — không tool nào tự hạ hay nâng cơ sở.
        const echoed = { line: ASTRAL_LINE, column: astralColumn };
        assert.deepEqual(hover.position, echoed);
        assert.deepEqual(declaration.position, echoed);
        assert.deepEqual(found.position, echoed);

        const hoverRange = assertResolvedHover(hover, "đợt quét chung");
        assert.equal(declaration.resolved, true);
        const declarationRange = declaration.locations[0]!.range;

        // Đối chiếu chéo giữa các tool: đầu ra của java_definition được nạp thẳng làm đầu vào của
        // java_hover. Nếu một trong hai nói bằng cơ sở khác, vòng này rơi sang token khác và range
        // trả về không còn trùng.
        const hoverAtDeclaration = unwrap(
          await javaHover(facade, {
            path: sourcePath,
            line: declarationRange.start.line,
            column: declarationRange.start.column,
          }),
          "java_hover tại chính vị trí java_definition đã chỉ ra",
        );
        assert.deepEqual(
          assertResolvedHover(hoverAtDeclaration, "vòng definition→hover"),
          declarationRange,
          "hover tại vị trí mà definition trả về phải bao đúng token đó — hai tool phải cùng cơ sở",
        );

        // java_references với includeDeclaration bao đúng khai báo mà java_definition đã chỉ ra.
        assert.ok(
          found.references.some(
            (reference) =>
              reference.range.start.line === declarationRange.start.line &&
              reference.range.start.column === declarationRange.start.column,
          ),
          `java_references phải chứa khai báo tại ${JSON.stringify(declarationRange)}; ` +
            `nhận được ${JSON.stringify(found.references.map((reference) => reference.range))}`,
        );
        // Và ba tool cùng nói dòng 1-based, không tool nào rơi lại 0-based.
        assert.deepEqual(hoverRange, symbolRangeAt(ASTRAL_LINE, astralColumn));
        assert.deepEqual(declarationRange, symbolRangeOn(DECLARATION_LINE));
      },
    );

    await t.test(
      "TCON-TOOL-0004: danh sách vượt cap luôn kèm truncated:true và TỔNG THỰC [INV-TOOL-3]",
      async () => {
        const trueTotal = expectedReferences.length;
        assert.ok(trueTotal >= 2, "fixture phải có ít nhất hai tham chiếu thì mới cắt được");
        const cap = trueTotal - 1;

        const found = unwrap(
          await references(
            facade,
            { path: sourcePath, line: PLAIN_LINE, column: plainColumn, includeDeclaration: false },
            { cap },
          ),
          "java_references dưới cap nhỏ hơn số tham chiếu thật",
        );

        assert.equal(found.cap, cap, "kết quả phải nói rõ cap nào đã được áp dụng");
        assert.equal(found.truncated, true, "một danh sách bị cắt KHÔNG BAO GIỜ được im lặng");
        assert.equal(
          found.total,
          trueTotal,
          "total phải là tổng THỰC trước khi cắt, không phải độ dài sau khi cắt",
        );
        assert.equal(found.references.length, cap, "danh sách trả về phải dài đúng bằng cap");
        for (const reference of found.references) {
          assert.ok(
            expectedReferences.some(
              (expected) =>
                expected.start.line === reference.range.start.line &&
                expected.start.column === reference.range.start.column,
            ),
            `phần tử còn lại sau khi cắt phải là một tham chiếu thật: ${JSON.stringify(reference.range)}`,
          );
        }
      },
    );

    await t.test(
      "TCON-TOOL-0005: đúng bằng cap thì danh sách đầy đủ và KHÔNG bị đánh dấu truncated [INV-TOOL-3]",
      async () => {
        const trueTotal = expectedReferences.length;
        const found = unwrap(
          await references(
            facade,
            { path: sourcePath, line: PLAIN_LINE, column: plainColumn, includeDeclaration: false },
            { cap: trueTotal },
          ),
          "java_references dưới cap đúng bằng số tham chiếu thật",
        );

        assert.equal(found.cap, trueTotal);
        assert.equal(
          found.truncated,
          false,
          "không phần tử nào bị cắt thì không bao giờ được báo là đã cắt (so sánh > chứ không phải >=)",
        );
        assert.equal(found.total, trueTotal);
        assert.equal(found.references.length, trueTotal, "không được thiếu tham chiếu cuối cùng");
        assertReferenceSet(found, sourcePath, "cap đúng biên");
      },
    );

    await t.test(
      "TCON-TOOL-0008: toạ độ quá khổ bị từ chối TRƯỚC mọi lời gọi LSP, bằng lỗi invalid-position [INV-TOOL-5]",
      async () => {
        const oversized = [
          { label: "dòng vượt quá cuối tệp", line: FIXTURE_LINES.length + 1, column: 1 },
          {
            label: "cột vượt quá cuối dòng",
            line: BMP_LINE,
            column: lineText(BMP_LINE).length + 5,
          },
        ];

        for (const { label, line, column } of oversized) {
          const before = live.lspRequests();
          const outcomes = [
            await javaHover(facade, { path: sourcePath, line, column }),
            await definition(facade, { path: sourcePath, line, column }),
            await references(facade, { path: sourcePath, line, column, includeDeclaration: false }),
          ];
          const names = ["java_hover", "java_definition", "java_references"];

          outcomes.forEach((outcome, index) => {
            assert.equal(
              outcome.isError,
              true,
              `${names[index]} với ${label}: phải là lỗi tường minh, không phải kết quả thành công ${JSON.stringify(outcome)}`,
            );
            const failure = outcome as { isError: true; code: string; message: string };
            assert.equal(
              failure.code,
              "invalid-position",
              `${names[index]} với ${label}: mã lỗi phải là invalid-position của chính tầng tool`,
            );
            assert.match(
              failure.message,
              /^invalid-position: /,
              `${names[index]} với ${label}: thông điệp phải tự nêu tên loại lỗi`,
            );
          });

          assert.equal(
            live.lspRequests(),
            before,
            `${label}: không lời gọi LSP nào được phép rời tầng tool khi toạ độ đã sai (INV-TOOL-5)`,
          );
        }
      },
    );

    await t.test(
      "TCON-TOOL-0009: hover giữa token luôn trả range của token ĐÃ GIẢI, không phải vị trí được hỏi [INV-TOOL-6]",
      async () => {
        const midTokenColumn = astralColumn + 3;
        assert.ok(
          midTokenColumn > astralColumn && midTokenColumn < astralColumn + SYMBOL.length,
          "vị trí hỏi phải nằm GIỮA token, nếu không một range echo lại đầu vào sẽ đúng một cách tầm thường",
        );

        const hover = unwrap(
          await javaHover(facade, { path: sourcePath, line: ASTRAL_LINE, column: midTokenColumn }),
          "java_hover giữa token trên dòng astral",
        );
        const range = assertResolvedHover(hover, "hover giữa token");

        assert.deepEqual(
          range,
          symbolRangeAt(ASTRAL_LINE, astralColumn),
          "range phải bao trọn token đã giải, tính theo offset UTF-16 thật của fixture",
        );
        assert.notDeepEqual(
          range.start,
          hover.position,
          "range không được là bản sao vị trí mà người gọi đã hỏi",
        );
        assert.notDeepEqual(
          range.end,
          hover.position,
          "range không được suy biến thành một điểm tại vị trí được hỏi",
        );
      },
    );

    await t.test(
      "TCON-TOOL-0010: vị trí không giải được phần tử nào là no-result CÓ TÊN, không phải hover thành công [INV-TOOL-6]",
      async () => {
        const emptyPositions = [
          { label: "dòng trống", line: BLANK_LINE, column: 1 },
          { label: "dòng chú thích thuần văn xuôi", line: COMMENT_LINE, column: 20 },
        ];

        for (const { label, line, column } of emptyPositions) {
          const result = unwrap(
            await javaHover(facade, { path: sourcePath, line, column }),
            `java_hover tại ${label}`,
          );
          assert.equal(
            result.resolved,
            false,
            `${label}: phải là no-result tường minh, nhận được ${JSON.stringify(result)}`,
          );
          assert.equal(
            "range" in result,
            false,
            `${label}: nhánh no-result không mang range — "thành công nhưng thiếu range" bị cấm`,
          );
          const unresolved = result as { reason: string };
          assert.ok(
            typeof unresolved.reason === "string" && unresolved.reason.trim().length > 0,
            `${label}: no-result phải nêu lý do đọc được, nhận được ${JSON.stringify(unresolved.reason)}`,
          );
          assert.deepEqual(
            result.position,
            { line, column },
            `${label}: no-result vẫn phải nói rõ nó nói về vị trí nào`,
          );
        }
      },
    );
  },
);

// -------------------------------------------------------------------------------------------
// TCON-TOOL-0006 — đường dẫn không định tuyến được. Không cần JVM: quyết định thuộc project-router.
// -------------------------------------------------------------------------------------------

test(
  "TCON-TOOL-0006: đường dẫn không thuộc workspace nào luôn thành lỗi unroutable, không bao giờ là kết quả rỗng thành công [INV-TOOL-4]",
  { timeout: 30_000 },
  async (t) => {
    const cleanup = cleanupStack(t);
    const root = realpathSync(mkdtempSync(path.join(tmpdir(), "jdt-nav-unroutable-")));
    cleanup(() => rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }));

    const strayPath = path.join(root, "Stray.java");
    writeFileSync(strayPath, FIXTURE_SOURCE, "utf8");
    const routed = resolveWorkspace(strayPath);
    assert.ok(
      "error" in routed,
      "fixture phải thật sự không định tuyến được; nếu có pom.xml phía trên thì ca này vô nghĩa",
    );

    let lspRequests = 0;
    const facade: LspFacade = {
      workspace: (filePath: string): WorkspaceAvailability => {
        const resolution = resolveWorkspace(filePath);
        if ("error" in resolution) return { status: "unroutable", detail: resolution.error };
        return { status: "ready", workspaceId: resolution.workspaceId };
      },
      readFile: (filePath: string) => readFileSync(filePath, "utf8"),
      request: async () => {
        lspRequests += 1;
        return null;
      },
    };

    const outcomes: Array<[string, ToolOutcome<unknown>]> = [
      ["java_hover", await javaHover(facade, { path: strayPath, line: BMP_LINE, column: 1 })],
      ["java_definition", await definition(facade, { path: strayPath, line: BMP_LINE, column: 1 })],
      [
        "java_references",
        await references(facade, {
          path: strayPath,
          line: BMP_LINE,
          column: 1,
          includeDeclaration: false,
        }),
      ],
    ];

    for (const [name, outcome] of outcomes) {
      assert.equal(
        outcome.isError,
        true,
        `${name}: đường dẫn không định tuyến được phải thành lỗi, nhận được ${JSON.stringify(outcome)}`,
      );
      const failure = outcome as { isError: true; code: string; message: string };
      assert.equal(failure.code, "unroutable", `${name}: lỗi phải tự nêu tên loại unroutable`);
      assert.match(failure.message, /^unroutable: /, `${name}: thông điệp phải mang tên loại lỗi`);
      assert.equal(
        "value" in failure,
        false,
        `${name}: envelope lỗi không bao giờ mang theo một kết quả thành công`,
      );
    }
    assert.equal(lspRequests, 0, "không lời gọi LSP nào được phát ra cho một đường dẫn không định tuyến được");
  },
);

// -------------------------------------------------------------------------------------------
// TCON-TOOL-0007 — workspace còn đang khởi động. Cần một tiến trình JDT LS THẬT vừa mới sinh ra.
// -------------------------------------------------------------------------------------------

test(
  "TCON-TOOL-0007: workspace chưa sẵn sàng index luôn thành lỗi not-ready, không bao giờ là kết quả rỗng thành công [INV-TOOL-4]",
  { timeout: SWEEP_TIMEOUT_MS },
  async (t) => {
    process.env.JDTLS_HOME = JDTLS_FIXTURE_HOME;
    const cleanup = cleanupStack(t);
    const root = realpathSync(mkdtempSync(path.join(tmpdir(), "jdt-nav-warming-")));
    // Cùng lý do như đợt quét chính: thư mục được đăng ký trước nên bị xoá sau cùng.
    cleanup(() => rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }));

    // `warmUp: false`: tool được gọi ngay sau handshake, trong khi index còn đang xây (cold start
    // đo được khoảng 4 s trên fixture này, so với hạn chờ WARMING_DEADLINE_MS).
    const warming = await startLiveWorkspace(
      root,
      "warming",
      { readyDeadlineMs: WARMING_DEADLINE_MS, warmUp: false },
      cleanup,
    );

    const column = columnOf(BMP_LINE, SYMBOL);
    const outcomes: Array<[string, ToolOutcome<unknown>]> = [
      [
        "java_hover",
        await javaHover(warming.facade, { path: warming.sourcePath, line: BMP_LINE, column }),
      ],
      [
        "java_definition",
        await definition(warming.facade, { path: warming.sourcePath, line: BMP_LINE, column }),
      ],
      [
        "java_references",
        await references(warming.facade, {
          path: warming.sourcePath,
          line: BMP_LINE,
          column,
          includeDeclaration: false,
        }),
      ],
    ];

    for (const [name, outcome] of outcomes) {
      assert.equal(
        outcome.isError,
        true,
        `${name}: workspace đang khởi động phải thành lỗi, nhận được ${JSON.stringify(outcome)}`,
      );
      const failure = outcome as { isError: true; code: string; message: string; detail?: unknown };
      assert.equal(failure.code, "not-ready", `${name}: lỗi phải tự nêu tên loại not-ready`);
      assert.match(failure.message, /^not-ready: /, `${name}: thông điệp phải mang tên loại lỗi`);
      assert.equal(
        "value" in failure,
        false,
        `${name}: envelope lỗi không bao giờ mang theo một kết quả thành công`,
      );
      const progress = failure.detail as { phase?: unknown } | undefined;
      assert.ok(
        progress !== undefined && typeof progress.phase === "string" && progress.phase !== "ready",
        `${name}: lỗi not-ready phải chở theo tiến độ để agent phân biệt "chưa xong" với "không có gì"`,
      );
    }

    assert.equal(
      warming.lspRequests(),
      0,
      "không lời gọi tool nào được phép chạm tới LSP khi workspace còn chưa sẵn sàng",
    );
  },
);
