// Oracle mức 1 cho feat-tool-definition.
//
// Falsifier đang bị kiểm chứng: "java_definition trả về một vị trí khai báo mà line/column chưa
// từng đi qua ranh giới chuyển đổi duy nhất của tầng tool [INV-TOOL-1]" — kể cả khi chỉ MỘT phần
// tử trong danh sách nhiều location bị bỏ sót, và kể cả khi phản hồi LSP tới dưới hình dạng
// `Location` đơn lẻ hay `LocationLink[]`.
//
// Tầng tool là hàm thuần của một `LspFacade` được tiêm, nên không có JDT LS thật ở đây. Facade giả
// vừa là nguồn câu trả lời, vừa là máy đếm: "chưa gọi LSP lần nào" trở thành một đại lượng đo được.
// Pattern facade lấy nguyên từ test/tools/tool-layer.spec.ts để hai tệp nói cùng một ngôn ngữ.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  hover,
  fromLspRange,
  TOOL_ERROR_CODES,
  type LspFacade,
  type LspRange,
  type ToolErrorCode,
  type WorkspaceAvailability,
} from "../../src/tools/tool-layer.ts";
import {
  definition,
  DEFINITION_METHOD,
  type DefinitionAnswer,
} from "../../src/tools/definition.ts";

// Tệp nguồn nơi con trỏ đứng. Có dấu tiếng Việt (é, ê, à — mỗi ký tự một UTF-16 code unit) và một
// ký tự astral-plane (🚀 — hai code unit), đúng bộ ký tự mà seam của INV-TOOL-1 đòi hỏi.
const FIXTURE_LINES = [
  "package demo;", // dòng LSP 0
  "", // 1
  "/** Chào — kiểm thử toạ độ. */", // 2
  "public class Greeter {", // 3
  '  private final String prefix = "Xin chào 🚀";', // 4
  "  String gréet(String tên) {", // 5
  '    return prefix + ", " + tên;', // 6
  "  }", // 7
  "}", // 8
];
const FIXTURE = FIXTURE_LINES.join("\n");
const FIXTURE_PATH = "/tmp/demo/src/main/java/demo/Greeter.java";

// Token `gréet` trên dòng LSP 5 chiếm UTF-16 unit [9, 14). Đây là khai báo mà `textDocument/definition`
// trỏ về trong ca cơ bản; cùng một range cũng được dùng cho hover để so chéo hai đường chuyển đổi.
const LSP_TOKEN_RANGE: LspRange = {
  start: { line: 5, character: 9 },
  end: { line: 5, character: 14 },
};
// Vị trí 1-based tương ứng, viết bằng số nguyên literal — không tự tham chiếu thuật toán.
const EXPECTED_TOKEN_RANGE = {
  start: { line: 6, column: 10 },
  end: { line: 6, column: 15 },
};

const OTHER_PATH = "/tmp/demo/src/main/java/demo/Prefix.java";

interface RecordedRequest {
  method: string;
  params: unknown;
}

interface FakeFacadeOptions {
  availability?: WorkspaceAvailability;
  content?: string | undefined;
  definition?: unknown;
  hover?: unknown;
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
      if (method === DEFINITION_METHOD) return options.definition ?? null;
      if (method === "textDocument/hover") return options.hover ?? null;
      return null;
    },
  };
  return { facade, requests };
}

function expectValue(
  outcome: { isError: false; value: DefinitionAnswer } | { isError: true; code: ToolErrorCode; message: string },
): DefinitionAnswer {
  assert.equal(
    outcome.isError,
    false,
    outcome.isError ? `expected a successful result, got ${outcome.code}: ${outcome.message}` : "",
  );
  return (outcome as { isError: false; value: DefinitionAnswer }).value;
}

// -------------------------------------------------------------------------------------------
// INV-TOOL-1 — mọi vị trí đi qua đúng một ranh giới chuyển đổi
// -------------------------------------------------------------------------------------------

test(
  "một khai báo duy nhất trả về đúng vị trí 1-based, đối chiếu được với byte thật của tệp",
  { timeout: 5_000 },
  async () => {
    const { facade, requests } = makeFacade({
      definition: { uri: FIXTURE_PATH, range: LSP_TOKEN_RANGE },
    });

    const answer = expectValue(
      await definition(facade, { path: FIXTURE_PATH, line: 6, column: 11 }),
    );

    assert.equal(answer.resolved, true, "facade trả về một location nên kết quả phải resolved");
    assert.equal(answer.locations.length, 1);
    assert.deepEqual(answer.locations[0], { path: FIXTURE_PATH, range: EXPECTED_TOKEN_RANGE });

    // Đối chiếu ngược với byte thật: range 1-based phải cắt đúng token khai báo trong tệp.
    const line = FIXTURE_LINES[answer.locations[0].range.start.line - 1];
    assert.equal(
      line.slice(answer.locations[0].range.start.column - 1, answer.locations[0].range.end.column - 1),
      "gréet",
      "range báo về phải cắt đúng token trong nội dung thật của tệp",
    );

    assert.equal(requests.length, 1, "đúng một lời gọi LSP cho một lần hỏi definition");
    assert.equal(requests[0].method, DEFINITION_METHOD);
  },
);

test(
  "INV-TOOL-1: vị trí gửi xuống LSP là 0-based, còn vị trí echo lại là 1-based của caller",
  { timeout: 5_000 },
  async () => {
    const { facade, requests } = makeFacade({
      definition: [{ uri: FIXTURE_PATH, range: LSP_TOKEN_RANGE }],
    });

    const answer = expectValue(
      await definition(facade, { path: FIXTURE_PATH, line: 6, column: 11 }),
    );

    assert.deepEqual(
      (requests[0].params as { position: unknown }).position,
      { line: 5, character: 10 },
      "đúng một ranh giới: 1-based của caller được hạ xuống 0-based trước khi lên dây",
    );
    assert.deepEqual(
      (requests[0].params as { textDocument: unknown }).textDocument,
      { uri: FIXTURE_PATH },
      "definition hỏi đúng tệp mà caller nêu tên",
    );
    assert.deepEqual(answer.position, { line: 6, column: 11 });
  },
);

test(
  "INV-TOOL-1: cùng một range LSP cho cùng một range kết quả, dù definition hay hover sinh ra nó",
  { timeout: 5_000 },
  async () => {
    const { facade } = makeFacade({
      definition: { uri: FIXTURE_PATH, range: LSP_TOKEN_RANGE },
      hover: { contents: "String gréet(String tên)", range: LSP_TOKEN_RANGE },
    });

    const definitionAnswer = expectValue(
      await definition(facade, { path: FIXTURE_PATH, line: 6, column: 11 }),
    );
    const hoverOutcome = await hover(facade, { path: FIXTURE_PATH, line: 6, column: 11 });
    assert.equal(hoverOutcome.isError, false);
    const hoverRange =
      hoverOutcome.isError === false && hoverOutcome.value.hover?.resolved === true
        ? hoverOutcome.value.hover.range
        : undefined;
    assert.ok(hoverRange !== undefined, "mỏ neo dương: hover phải trả về một range đã chuyển đổi");

    // Câu khẳng định giết mutant "definition tự cộng trừ lấy": hai đường khác nhau chỉ cần lệch một
    // đơn vị là hỏng, dù cả hai vẫn "trông hợp lệ".
    assert.deepEqual(
      definitionAnswer.locations[0].range,
      hoverRange,
      "cùng một vị trí LSP phải cho cùng một vị trí kết quả, bất kể method nào sinh ra nó",
    );
    // Và cả hai phải khớp với chính hàm chuyển đổi công bố của tầng tool.
    assert.deepEqual(definitionAnswer.locations[0].range, fromLspRange(LSP_TOKEN_RANGE));
  },
);

// -------------------------------------------------------------------------------------------
// Nhiều location — MỌI phần tử phải đi qua ranh giới, không chỉ phần tử đầu
// -------------------------------------------------------------------------------------------

test(
  "mảng nhiều khai báo: TẤT CẢ location đều được chuyển đổi, không chỉ phần tử đầu",
  { timeout: 5_000 },
  async () => {
    const raw = [
      { uri: FIXTURE_PATH, range: LSP_TOKEN_RANGE },
      {
        uri: OTHER_PATH,
        range: { start: { line: 0, character: 0 }, end: { line: 0, character: 7 } },
      },
      {
        uri: OTHER_PATH,
        range: { start: { line: 11, character: 4 }, end: { line: 11, character: 9 } },
      },
    ];
    const { facade } = makeFacade({ definition: raw });

    const answer = expectValue(
      await definition(facade, { path: FIXTURE_PATH, line: 6, column: 11 }),
    );

    assert.equal(answer.resolved, true);
    assert.deepEqual(answer.locations, [
      { path: FIXTURE_PATH, range: EXPECTED_TOKEN_RANGE },
      {
        path: OTHER_PATH,
        range: { start: { line: 1, column: 1 }, end: { line: 1, column: 8 } },
      },
      {
        path: OTHER_PATH,
        range: { start: { line: 12, column: 5 }, end: { line: 12, column: 10 } },
      },
    ]);

    // Không phần tử nào được phép giữ lại toạ độ 0-based của LSP.
    for (const [index, location] of answer.locations.entries()) {
      assert.deepEqual(
        location.range,
        fromLspRange(raw[index].range as LspRange),
        `location #${index} phải đi qua đúng ranh giới chuyển đổi của tầng tool`,
      );
      assert.notDeepEqual(
        location.range.start,
        raw[index].range.start,
        `location #${index} không được trả về nguyên toạ độ 0-based của LSP`,
      );
    }
  },
);

test(
  "LocationLink[]: range của định danh đích được chuyển đổi cho mọi phần tử",
  { timeout: 5_000 },
  async () => {
    const wholeDeclaration = {
      start: { line: 5, character: 2 },
      end: { line: 7, character: 3 },
    };
    const { facade } = makeFacade({
      definition: [
        {
          targetUri: FIXTURE_PATH,
          targetRange: wholeDeclaration,
          targetSelectionRange: LSP_TOKEN_RANGE,
        },
        {
          targetUri: OTHER_PATH,
          targetRange: { start: { line: 2, character: 0 }, end: { line: 4, character: 1 } },
          targetSelectionRange: { start: { line: 2, character: 6 }, end: { line: 2, character: 12 } },
        },
      ],
    });

    const answer = expectValue(
      await definition(facade, { path: FIXTURE_PATH, line: 6, column: 11 }),
    );

    assert.deepEqual(answer.locations, [
      { path: FIXTURE_PATH, range: EXPECTED_TOKEN_RANGE },
      {
        path: OTHER_PATH,
        range: { start: { line: 3, column: 7 }, end: { line: 3, column: 13 } },
      },
    ]);
  },
);

test(
  "LocationLink không có targetSelectionRange dùng targetRange, vẫn qua ranh giới",
  { timeout: 5_000 },
  async () => {
    const { facade } = makeFacade({
      definition: [
        {
          targetUri: OTHER_PATH,
          targetRange: { start: { line: 9, character: 2 }, end: { line: 9, character: 8 } },
        },
      ],
    });

    const answer = expectValue(
      await definition(facade, { path: FIXTURE_PATH, line: 6, column: 11 }),
    );

    assert.deepEqual(answer.locations, [
      {
        path: OTHER_PATH,
        range: { start: { line: 10, column: 3 }, end: { line: 10, column: 9 } },
      },
    ]);
  },
);

// -------------------------------------------------------------------------------------------
// Không tìm thấy khai báo — no-result tường minh, không phải lỗi giả (INV-TOOL-4)
// -------------------------------------------------------------------------------------------

test(
  "mảng rỗng là no-result tường minh: kết quả thành công, locations rỗng, có lý do",
  { timeout: 5_000 },
  async () => {
    const { facade } = makeFacade({ definition: [] });

    const answer = expectValue(
      await definition(facade, { path: FIXTURE_PATH, line: 6, column: 11 }),
    );

    assert.equal(answer.resolved, false, "không có khai báo nào là một nhánh có tên");
    assert.deepEqual(answer.locations, [], "locations không bao giờ là một trường bị bỏ trống");
    assert.ok(
      answer.resolved === false && answer.reason.length > 0,
      "no-result phải nói vì sao",
    );
  },
);

test(
  "phản hồi null cũng là no-result tường minh, không phải lỗi",
  { timeout: 5_000 },
  async () => {
    const { facade } = makeFacade({ definition: null });

    const answer = expectValue(
      await definition(facade, { path: FIXTURE_PATH, line: 6, column: 11 }),
    );

    assert.equal(answer.resolved, false);
    assert.deepEqual(answer.locations, []);
  },
);

// -------------------------------------------------------------------------------------------
// Taxonomy X-003 — mọi thất bại là lỗi có tên (INV-TOOL-4), xác thực trước lời gọi (INV-TOOL-5)
// -------------------------------------------------------------------------------------------

test(
  "workspace chưa sẵn sàng là lỗi `not-ready`, không phải một danh sách rỗng thành công",
  { timeout: 5_000 },
  async () => {
    const { facade, requests } = makeFacade({
      availability: { status: "not-ready", detail: "semantic probe đã thử 3 lần, chưa có kết quả" },
    });

    const outcome = await definition(facade, { path: FIXTURE_PATH, line: 6, column: 11 });

    assert.equal(outcome.isError, true, "workspace chưa sẵn sàng không bao giờ là một thành công");
    assert.equal(outcome.isError === true ? outcome.code : undefined, "not-ready");
    assert.ok(
      outcome.isError === true && outcome.message.includes("not-ready"),
      "thông điệp phải tự nêu tên loại lỗi",
    );
    assert.equal(
      (outcome as { value?: unknown }).value,
      undefined,
      "một lỗi không được mang theo bất kỳ payload kết quả nào",
    );
    assert.equal(requests.length, 0, "không hỏi một workspace chưa trả lời được");
  },
);

test(
  "mỗi nhánh workspace của taxonomy X-003 được báo cáo dưới đúng tên của nó",
  { timeout: 5_000 },
  async () => {
    const unavailable = [
      "unroutable",
      "not-ready",
      "resyncing",
      "workspace-crashed",
      "cap-exceeded",
    ] as const;

    for (const status of unavailable) {
      const { facade, requests } = makeFacade({
        availability: { status, detail: `chi tiết ${status}` },
      });
      const outcome = await definition(facade, { path: FIXTURE_PATH, line: 6, column: 11 });

      assert.equal(outcome.isError, true, `${status} phải là lỗi`);
      assert.equal(outcome.isError === true ? outcome.code : undefined, status);
      assert.ok(
        outcome.isError === true && TOOL_ERROR_CODES.includes(outcome.code),
        `${status} phải nằm trong taxonomy đóng X-003`,
      );
      assert.equal(requests.length, 0, `${status}: không được gọi LSP`);
    }
  },
);

test(
  "INV-TOOL-5: line/column vượt giới hạn bị từ chối là `invalid-position` trước mọi lời gọi LSP",
  { timeout: 5_000 },
  async () => {
    const oversized = [
      { line: 99, column: 1, why: "dòng vượt quá số dòng của tệp" },
      { line: 6, column: 500, why: "cột vượt quá độ dài dòng" },
      { line: 0, column: 1, why: "dòng 0 không tồn tại trong hệ 1-based" },
      { line: 6, column: 0, why: "cột 0 không tồn tại trong hệ 1-based" },
    ];

    for (const { line, column, why } of oversized) {
      const { facade, requests } = makeFacade({
        definition: [{ uri: FIXTURE_PATH, range: LSP_TOKEN_RANGE }],
      });

      const outcome = await definition(facade, { path: FIXTURE_PATH, line, column });

      assert.equal(outcome.isError, true, `(${line}, ${column}) phải là lỗi — ${why}`);
      assert.equal(
        outcome.isError === true ? outcome.code : undefined,
        "invalid-position",
        `(${line}, ${column}) phải mang đúng tên loại lỗi — ${why}`,
      );
      assert.equal(
        requests.length,
        0,
        `(${line}, ${column}) không được lọt tới facade: đã gọi ${requests.length} lần LSP — ${why}`,
      );
    }
  },
);

test(
  "một LSP request bị từ chối thành lỗi `workspace-crashed`, không phải danh sách rỗng",
  { timeout: 5_000 },
  async () => {
    const { facade } = makeFacade({ rejectWith: new Error("JDT LS process exited with code 1") });

    const outcome = await definition(facade, { path: FIXTURE_PATH, line: 6, column: 11 });

    assert.equal(outcome.isError, true);
    assert.equal(outcome.isError === true ? outcome.code : undefined, "workspace-crashed");
    assert.ok(
      outcome.isError === true && outcome.message.includes("JDT LS process exited"),
      "nguyên nhân gốc phải còn nguyên trong thông điệp",
    );
  },
);

test(
  "một tệp không đọc được là lỗi `unroutable`, không phải một definition rỗng",
  { timeout: 5_000 },
  async () => {
    const { facade, requests } = makeFacade({ content: undefined });

    const outcome = await definition(facade, { path: FIXTURE_PATH, line: 6, column: 11 });

    assert.equal(outcome.isError, true);
    assert.equal(outcome.isError === true ? outcome.code : undefined, "unroutable");
    assert.ok(
      outcome.isError === true && outcome.message.includes(FIXTURE_PATH),
      "lỗi phải nêu tên đường dẫn",
    );
    assert.equal(requests.length, 0);
  },
);
