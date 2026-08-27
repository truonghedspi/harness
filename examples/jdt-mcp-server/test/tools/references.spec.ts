// Oracle mức 1 cho feat-tool-references.
//
// Falsifier đang bị kiểm chứng: "một kết quả references vượt cap được trả về KHÔNG bị cắt thay vì
// `truncated: true` cộng tổng số thực [INV-TOOL-3]".
//
// Cách đo: facade giả sinh ra một số lượng location tuỳ ý, nên "vượt cap" là một đại lượng dựng
// được chính xác chứ không phải một tình huống may rủi. Ba mốc được ghim riêng — dưới cap, đúng
// bằng cap, trên cap — vì một lỗi lệch-một ở biên chỉ lộ ra khi cả ba cùng bị hỏi.
//
// Cap không được hard-code trong logic cắt: X-008 còn mở, mới chỉ khuyến nghị 200. Ca "đổi cap qua
// tuỳ chọn thì hành vi cắt đổi theo" là bằng chứng cơ học cho điều đó — nếu một số 200 nằm cứng đâu
// đó trên đường cắt, ca cap=10 và ca cap=300 không thể cùng xanh.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_REFERENCE_CAP,
  REFERENCES_METHOD,
  references,
  type ReferencesAnswer,
  type ReferencesOptions,
  type ReferencesRequest,
} from "../../src/tools/references.ts";
import type { LspFacade, ToolOutcome, WorkspaceAvailability } from "../../src/tools/tool-layer.ts";

const CASE_TIMEOUT = 5_000;

// Fixture mang dấu tiếng Việt và một ký tự astral-plane, cùng bộ ký tự mà seam của INV-TOOL-1 đòi
// hỏi: nếu một phép cộng toạ độ nào đó đếm bằng code point thay vì UTF-16 code unit, cột báo về
// trên dòng chứa 🚀 sẽ lệch.
const FIXTURE_LINES = [
  "package demo;", // dòng LSP 0
  "", // 1
  "public class Greeter {", // 2
  '  private final String prefix = "Xin chào 🚀";', // 3
  "  String gréet(String tên) {", // 4
  "    return prefix + tên;", // 5
  "  }", // 6
  "}", // 7
];
const FIXTURE = FIXTURE_LINES.join("\n");
const FIXTURE_PATH = "/tmp/demo/src/main/java/demo/Greeter.java";
const CALLER_PATH = "/tmp/demo/src/main/java/demo/Caller.java";

/** Vị trí caller hỏi: dòng 5, cột 10 trong hệ 1-based — ngay trên token `gréet`. */
const REQUEST: ReferencesRequest = { path: FIXTURE_PATH, line: 5, column: 10 };

interface RecordedRequest {
  method: string;
  params: unknown;
}

interface FakeFacadeOptions {
  availability?: WorkspaceAvailability;
  content?: string | undefined;
  locations?: unknown;
  rejectWith?: Error;
}

/**
 * Facade giả. `requests` là máy đếm: một lời gọi LSP xuất hiện ở đây khi lẽ ra không được phép là
 * bằng chứng trực tiếp rằng thứ tự các bước đã sai (INV-TOOL-5).
 */
function makeFacade(options: FakeFacadeOptions = {}): {
  facade: LspFacade;
  requests: RecordedRequest[];
} {
  const requests: RecordedRequest[] = [];
  const facade: LspFacade = {
    workspace: () => options.availability ?? { status: "ready", workspaceId: "ws-demo" },
    readFile: () => ("content" in options ? options.content : FIXTURE),
    request: async (method: string, params: unknown) => {
      requests.push({ method, params });
      if (options.rejectWith !== undefined) throw options.rejectWith;
      return options.locations ?? [];
    },
  };
  return { facade, requests };
}

/**
 * `count` location giả, mỗi cái ở một dòng LSP khác nhau nên danh tính của từng phần tử đọc được
 * từ chính toạ độ của nó. Nhờ đó ca vượt cap khẳng định được ĐÚNG những phần tử nào được giữ, chứ
 * không chỉ khẳng định số lượng.
 */
function makeLocations(count: number): unknown[] {
  return Array.from({ length: count }, (_unused, index) => ({
    uri: CALLER_PATH,
    range: {
      start: { line: index, character: 4 },
      end: { line: index, character: 9 },
    },
  }));
}

function expectSuccess(outcome: ToolOutcome<ReferencesAnswer>): ReferencesAnswer {
  assert.equal(outcome.isError, false, `mong đợi kết quả thành công, nhận: ${JSON.stringify(outcome)}`);
  if (outcome.isError) throw new Error("unreachable");
  return outcome.value;
}

async function callWith(
  locations: unknown,
  options?: ReferencesOptions,
): Promise<ReferencesAnswer> {
  const { facade } = makeFacade({ locations });
  return expectSuccess(await references(facade, REQUEST, options));
}

// -------------------------------------------------------------------------------------------
// INV-TOOL-3 — ba mốc quanh cap
// -------------------------------------------------------------------------------------------

test("dưới cap: mọi reference được trả về, truncated false, total đúng số thực", { timeout: CASE_TIMEOUT }, async () => {
  const answer = await callWith(makeLocations(3), { cap: 5 });

  assert.equal(answer.references.length, 3);
  assert.equal(answer.truncated, false);
  assert.equal(answer.total, 3);
  assert.equal(answer.cap, 5);

  // Toạ độ công bố là 1-based: location LSP dòng 0 cột 4 phải hiện ra là dòng 1 cột 5.
  assert.deepEqual(answer.references[0], {
    path: CALLER_PATH,
    range: { start: { line: 1, column: 5 }, end: { line: 1, column: 10 } },
  });
  assert.deepEqual(answer.references[2]?.range.start, { line: 3, column: 5 });
  // Vị trí được hỏi cũng echo lại trong cùng hệ, không phải hệ LSP.
  assert.deepEqual(answer.position, { line: 5, column: 10 });
});

test(
  "VƯỢT cap: kết quả chỉ còn đúng cap phần tử, truncated true, total là tổng THỰC trước khi cắt",
  { timeout: CASE_TIMEOUT },
  async () => {
    // Cap mặc định (X-008 khuyến nghị 200) và 250 reference từ LSP — đúng hình dạng của falsifier.
    const answer = await callWith(makeLocations(250));

    assert.equal(answer.cap, DEFAULT_REFERENCE_CAP);
    assert.equal(
      answer.references.length,
      DEFAULT_REFERENCE_CAP,
      "một danh sách vượt cap không được rời khỏi tầng tool với nhiều hơn cap phần tử",
    );
    assert.equal(answer.truncated, true, "kết quả bị cắt phải tự khai báo là đã bị cắt");
    assert.equal(
      answer.total,
      250,
      "total phải là tổng số thực trước khi cắt, không phải số phần tử còn lại sau khi cắt",
    );
    assert.notEqual(answer.total, answer.references.length);

    // Phần được giữ là đoạn đầu theo đúng thứ tự LSP trả về, không phải một tập bất kỳ.
    assert.deepEqual(answer.references[0]?.range.start, { line: 1, column: 5 });
    assert.deepEqual(answer.references[DEFAULT_REFERENCE_CAP - 1]?.range.start, {
      line: DEFAULT_REFERENCE_CAP,
      column: 5,
    });
  },
);

test(
  "đúng ngưỡng cap: không lệch-một — bằng cap thì chưa bị cắt",
  { timeout: CASE_TIMEOUT },
  async () => {
    const answer = await callWith(makeLocations(7), { cap: 7 });

    assert.equal(answer.references.length, 7);
    assert.equal(answer.truncated, false, "đúng bằng cap là vừa đủ, không phải là vượt");
    assert.equal(answer.total, 7);

    // Và ngay trên ngưỡng một đơn vị thì phải cắt.
    const overByOne = await callWith(makeLocations(8), { cap: 7 });
    assert.equal(overByOne.references.length, 7);
    assert.equal(overByOne.truncated, true);
    assert.equal(overByOne.total, 8);
  },
);

test(
  "cap đọc TỪ cấu hình: cùng một câu trả lời LSP, đổi cap thì hành vi cắt đổi theo",
  { timeout: CASE_TIMEOUT },
  async () => {
    const locations = makeLocations(250);

    const tight = await callWith(locations, { cap: 10 });
    assert.equal(tight.cap, 10);
    assert.equal(tight.references.length, 10);
    assert.equal(tight.truncated, true);
    assert.equal(tight.total, 250);

    // Cap rộng hơn số reference thực: không có số 200 cứng nào được phép cắt ở đây.
    const wide = await callWith(locations, { cap: 300 });
    assert.equal(wide.cap, 300);
    assert.equal(wide.references.length, 250);
    assert.equal(wide.truncated, false);
    assert.equal(wide.total, 250);
  },
);

// -------------------------------------------------------------------------------------------
// Hình dạng lời gọi LSP
// -------------------------------------------------------------------------------------------

test(
  "lời gọi phát ra đúng textDocument/references, vị trí hạ về 0-based, includeDeclaration được truyền",
  { timeout: CASE_TIMEOUT },
  async () => {
    const { facade, requests } = makeFacade({ locations: makeLocations(2) });
    expectSuccess(await references(facade, { ...REQUEST, includeDeclaration: true }));

    assert.equal(requests.length, 1);
    assert.equal(requests[0]?.method, REFERENCES_METHOD);
    assert.deepEqual(requests[0]?.params, {
      textDocument: { uri: FIXTURE_PATH },
      position: { line: 4, character: 9 },
      context: { includeDeclaration: true },
    });
  },
);

test("uri dạng file:// được trả về như một đường dẫn thật", { timeout: CASE_TIMEOUT }, async () => {
  const answer = await callWith([
    { uri: `file://${CALLER_PATH}`, range: { start: { line: 0, character: 0 }, end: { line: 0, character: 3 } } },
  ]);

  assert.equal(answer.references[0]?.path, CALLER_PATH);
});

// -------------------------------------------------------------------------------------------
// Taxonomy X-003 / INV-TOOL-4 — không thất bại nào biến thành một danh sách rỗng thành công
// -------------------------------------------------------------------------------------------

test(
  "workspace chưa sẵn sàng: lỗi có tên, và LSP chưa hề bị gọi",
  { timeout: CASE_TIMEOUT },
  async () => {
    const { facade, requests } = makeFacade({
      availability: { status: "not-ready", detail: "indexing 40%", progress: { percent: 40 } },
      locations: makeLocations(3),
    });

    const outcome = await references(facade, REQUEST);
    assert.equal(outcome.isError, true);
    if (!outcome.isError) throw new Error("unreachable");
    assert.equal(outcome.code, "not-ready");
    assert.match(outcome.message, /^not-ready: /);
    assert.equal(requests.length, 0, "workspace chưa trả lời được thì không được phát request nào");
    assert.equal("value" in outcome, false, "envelope lỗi không bao giờ mang theo value");
  },
);

test("workspace đang resync được báo đúng tên của nó", { timeout: CASE_TIMEOUT }, async () => {
  const { facade } = makeFacade({
    availability: { status: "resyncing", detail: "pom.xml changed" },
  });

  const outcome = await references(facade, REQUEST);
  assert.equal(outcome.isError, true);
  if (!outcome.isError) throw new Error("unreachable");
  assert.equal(outcome.code, "resyncing");
});

test(
  "line/column vượt giới hạn tệp bị từ chối TRƯỚC khi gọi LSP (INV-TOOL-5)",
  { timeout: CASE_TIMEOUT },
  async () => {
    const { facade, requests } = makeFacade({ locations: makeLocations(3) });

    const outcome = await references(facade, { path: FIXTURE_PATH, line: 999, column: 1 });
    assert.equal(outcome.isError, true);
    if (!outcome.isError) throw new Error("unreachable");
    assert.equal(outcome.code, "invalid-position");
    assert.equal(requests.length, 0);
  },
);

test("không đọc được nội dung tệp: unroutable, không phải danh sách rỗng", { timeout: CASE_TIMEOUT }, async () => {
  const { facade, requests } = makeFacade({ content: undefined, locations: makeLocations(3) });

  const outcome = await references(facade, REQUEST);
  assert.equal(outcome.isError, true);
  if (!outcome.isError) throw new Error("unreachable");
  assert.equal(outcome.code, "unroutable");
  assert.equal(requests.length, 0);
});

test("workspace chết giữa lời gọi: workspace-crashed", { timeout: CASE_TIMEOUT }, async () => {
  const { facade } = makeFacade({ rejectWith: new Error("socket closed") });

  const outcome = await references(facade, REQUEST);
  assert.equal(outcome.isError, true);
  if (!outcome.isError) throw new Error("unreachable");
  assert.equal(outcome.code, "workspace-crashed");
  assert.match(outcome.message, /socket closed/);
});

test(
  "không có reference nào là một kết quả thành công rỗng hợp lệ, không phải lỗi",
  { timeout: CASE_TIMEOUT },
  async () => {
    const answer = await callWith([]);

    assert.deepEqual(answer.references, []);
    assert.equal(answer.truncated, false);
    assert.equal(answer.total, 0);
    assert.equal(answer.workspaceId, "ws-demo");
  },
);
