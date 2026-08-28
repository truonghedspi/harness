// Oracle mức 1 cho feat-tool-completion.
//
// Falsifier đang bị kiểm chứng: "một kết quả completion trong một phạm vi lớn được trả về KHÔNG bị cắt
// thay vì `truncated: true` cộng tổng số thực [INV-TOOL-3]".
//
// Cách đo: facade giả sinh ra một số lượng completion item tuỳ ý, nên "vượt cap" là một đại lượng
// dựng được chính xác chứ không phải tình huống may rủi. Ba mốc được ghim riêng — dưới cap, đúng
// bằng cap, trên cap — vì một lỗi lệch-một ở biên chỉ lộ ra khi cả ba cùng bị hỏi. Cap đọc từ tuỳ
// chọn, không hard-code (X-008 mở), nên ca "đổi cap thì hành vi đổi theo" là bằng chứng cơ học cho
// điều đó.
//
// Bước xác thực vị trí (INV-TOOL-5) và tạo hình item (INV-TOOL-1) nằm trong tool-layer và đã được
// chứng minh ở `tool-layer.spec.ts`; tệp này chỉ kiểm phần cap/truncation mà wrapper mỏng gánh thêm.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_COMPLETION_CAP,
  javaCompletion,
  type JavaCompletionOptions,
  type JavaCompletionResult,
} from "../../src/tools/completion.ts";
import { COMPLETION_METHOD, type LspFacade, type ToolOutcome, type WorkspaceAvailability } from "../../src/tools/tool-layer.ts";

const CASE_TIMEOUT = 5_000;

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

/** Vị trí hỏi: dòng 5, cột 10 trong hệ 1-based — ngay trên token `gréet`. */
const REQUEST = { path: FIXTURE_PATH, line: 5, column: 10 };

interface RecordedRequest {
  method: string;
  params: unknown;
}

interface FakeFacadeOptions {
  availability?: WorkspaceAvailability;
  content?: string | undefined;
  completions?: unknown;
  rejectWith?: Error;
}

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
      return options.completions ?? [];
    },
  };
  return { facade, requests };
}

/**
 * `count` completion item giả, mỗi cái có `range` riêng trên cùng một dòng nên danh tính của từng
 * phần tử đọc được từ chính toạ độ của nó — ca vượt cap khẳng định ĐÚNG phần tử nào được giữ.
 */
function makeItems(count: number): unknown[] {
  return Array.from({ length: count }, (_unused, index) => ({
    label: `item-${index}`,
    detail: `detail-${index}`,
    range: {
      start: { line: 0, character: index },
      end: { line: 0, character: index + 4 },
    },
  }));
}

function expectSuccess(outcome: ToolOutcome<JavaCompletionResult>): JavaCompletionResult {
  assert.equal(outcome.isError, false, `mong đợi kết quả thành công, nhận: ${JSON.stringify(outcome)}`);
  if (outcome.isError) throw new Error("unreachable");
  return outcome.value;
}

async function callWith(completions: unknown, options?: JavaCompletionOptions): Promise<JavaCompletionResult> {
  const { facade } = makeFacade({ completions });
  return expectSuccess(await javaCompletion(facade, REQUEST, options));
}

// -------------------------------------------------------------------------------------------
// INV-TOOL-3 — ba mốc quanh cap
// -------------------------------------------------------------------------------------------

test("dưới cap: mọi item được trả về, truncated false, total đúng số thực", { timeout: CASE_TIMEOUT }, async () => {
  const answer = await callWith(makeItems(3), { cap: 5 });

  assert.equal(answer.items.length, 3);
  assert.equal(answer.truncated, false);
  assert.equal(answer.total, 3);
  assert.equal(answer.cap, 5);

  // Toạ độ công bố là 1-based: range LSP dòng 0 cột 0 phải hiện ra là dòng 1 cột 1.
  assert.deepEqual(answer.items[0], {
    label: "item-0",
    detail: "detail-0",
    range: { start: { line: 1, column: 1 }, end: { line: 1, column: 5 } },
  });
  assert.deepEqual(answer.items[2]?.range.start, { line: 1, column: 3 });
  // Vị trí được hỏi cũng echo lại trong cùng hệ 1-based.
  assert.deepEqual(answer.position, { line: 5, column: 10 });
});

test(
  "VƯỢT cap: kết quả chỉ còn đúng cap item, truncated true, total là tổng THỰC trước khi cắt",
  { timeout: CASE_TIMEOUT },
  async () => {
    const answer = await callWith(makeItems(250));

    assert.equal(answer.cap, DEFAULT_COMPLETION_CAP);
    assert.equal(answer.items.length, DEFAULT_COMPLETION_CAP, "một danh sách vượt cap không được rời khỏi tool với nhiều hơn cap item");
    assert.equal(answer.truncated, true, "kết quả bị cắt phải tự khai báo là đã bị cắt");
    assert.equal(answer.total, 250, "total phải là tổng số thực trước khi cắt, không phải số item còn lại");
    assert.notEqual(answer.total, answer.items.length);

    // Phần được giữ là đoạn đầu theo đúng thứ tự LSP trả về.
    assert.equal(answer.items[0]?.label, "item-0");
    assert.equal(answer.items[DEFAULT_COMPLETION_CAP - 1]?.label, `item-${DEFAULT_COMPLETION_CAP - 1}`);
  },
);

test("đúng ngưỡng cap: không lệch-một — bằng cap thì chưa bị cắt", { timeout: CASE_TIMEOUT }, async () => {
  const answer = await callWith(makeItems(7), { cap: 7 });

  assert.equal(answer.items.length, 7);
  assert.equal(answer.truncated, false, "đúng bằng cap là vừa đủ, không phải là vượt");
  assert.equal(answer.total, 7);

  const overByOne = await callWith(makeItems(8), { cap: 7 });
  assert.equal(overByOne.items.length, 7);
  assert.equal(overByOne.truncated, true);
  assert.equal(overByOne.total, 8);
});

test("cap đọc TỪ cấu hình: cùng một câu trả lời LSP, đổi cap thì hành vi cắt đổi theo", { timeout: CASE_TIMEOUT }, async () => {
  const completions = makeItems(250);

  const tight = await callWith(completions, { cap: 10 });
  assert.equal(tight.cap, 10);
  assert.equal(tight.items.length, 10);
  assert.equal(tight.truncated, true);
  assert.equal(tight.total, 250);

  const wide = await callWith(completions, { cap: 300 });
  assert.equal(wide.cap, 300);
  assert.equal(wide.items.length, 250);
  assert.equal(wide.truncated, false);
  assert.equal(wide.total, 250);
});

// -------------------------------------------------------------------------------------------
// Hình dạng lời gọi LSP và hình dạng câu trả lời
// -------------------------------------------------------------------------------------------

test("lời gọi phát ra đúng textDocument/completion, vị trí hạ về 0-based", { timeout: CASE_TIMEOUT }, async () => {
  const { facade, requests } = makeFacade({ completions: makeItems(2) });
  expectSuccess(await javaCompletion(facade, REQUEST));

  assert.equal(requests.length, 1);
  assert.equal(requests[0]?.method, COMPLETION_METHOD);
  assert.deepEqual(requests[0]?.params, {
    textDocument: { uri: FIXTURE_PATH },
    position: { line: 4, character: 9 },
  });
});

test("câu trả lời LSP dạng CompletionList { items: [...] } cũng được tạo hình đúng", { timeout: CASE_TIMEOUT }, async () => {
  const answer = await callWith({ items: makeItems(2) }, { cap: 5 });

  assert.equal(answer.items.length, 2);
  assert.equal(answer.items[0]?.label, "item-0");
});

test("item không đọc được label bị bỏ qua, không làm hỏng cả danh sách", { timeout: CASE_TIMEOUT }, async () => {
  const answer = await callWith([{ range: { start: { line: 0, character: 0 }, end: { line: 0, character: 4 } } }, ...makeItems(2)], { cap: 5 });

  assert.equal(answer.total, 2);
  assert.equal(answer.items[0]?.label, "item-0");
});

// -------------------------------------------------------------------------------------------
// Taxonomy X-003 / INV-TOOL-4 — không thất bại nào biến thành một danh sách rỗng thành công
// -------------------------------------------------------------------------------------------

test("workspace chưa sẵn sàng: lỗi có tên, và LSP chưa hề bị gọi", { timeout: CASE_TIMEOUT }, async () => {
  const { facade, requests } = makeFacade({
    availability: { status: "not-ready", detail: "indexing 40%", progress: { percent: 40 } },
    completions: makeItems(3),
  });

  const outcome = await javaCompletion(facade, REQUEST);
  assert.equal(outcome.isError, true);
  if (!outcome.isError) throw new Error("unreachable");
  assert.equal(outcome.code, "not-ready");
  assert.match(outcome.message, /^not-ready: /);
  assert.equal(requests.length, 0, "workspace chưa trả lời được thì không được phát request nào");
  assert.equal("value" in outcome, false, "envelope lỗi không bao giờ mang theo value");
});

test("workspace đang resync được báo đúng tên của nó", { timeout: CASE_TIMEOUT }, async () => {
  const { facade } = makeFacade({ availability: { status: "resyncing", detail: "pom.xml changed" } });

  const outcome = await javaCompletion(facade, REQUEST);
  assert.equal(outcome.isError, true);
  if (!outcome.isError) throw new Error("unreachable");
  assert.equal(outcome.code, "resyncing");
});

test("line/column vượt giới hạn tệp bị từ chối TRƯỚC khi gọi LSP (INV-TOOL-5)", { timeout: CASE_TIMEOUT }, async () => {
  const { facade, requests } = makeFacade({ completions: makeItems(3) });

  const outcome = await javaCompletion(facade, { path: FIXTURE_PATH, line: 999, column: 1 });
  assert.equal(outcome.isError, true);
  if (!outcome.isError) throw new Error("unreachable");
  assert.equal(outcome.code, "invalid-position");
  assert.equal(requests.length, 0);
});

test("không đọc được nội dung tệp: unroutable, không phải danh sách rỗng", { timeout: CASE_TIMEOUT }, async () => {
  const { facade, requests } = makeFacade({ content: undefined, completions: makeItems(3) });

  const outcome = await javaCompletion(facade, REQUEST);
  assert.equal(outcome.isError, true);
  if (!outcome.isError) throw new Error("unreachable");
  assert.equal(outcome.code, "unroutable");
  assert.equal(requests.length, 0);
});

test("workspace chết giữa lời gọi: workspace-crashed", { timeout: CASE_TIMEOUT }, async () => {
  const { facade } = makeFacade({ rejectWith: new Error("socket closed") });

  const outcome = await javaCompletion(facade, REQUEST);
  assert.equal(outcome.isError, true);
  if (!outcome.isError) throw new Error("unreachable");
  assert.equal(outcome.code, "workspace-crashed");
  assert.match(outcome.message, /socket closed/);
});

test("không có completion item nào là một kết quả thành công rỗng hợp lệ, không phải lỗi", { timeout: CASE_TIMEOUT }, async () => {
  const answer = await callWith([]);

  assert.deepEqual(answer.items, []);
  assert.equal(answer.truncated, false);
  assert.equal(answer.total, 0);
  assert.equal(answer.workspaceId, "ws-demo");
});
