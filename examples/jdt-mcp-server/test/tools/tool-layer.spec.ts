// Oracle mức 1 cho feat-tool-layer-core.
//
// Falsifier đang bị kiểm chứng: "một kết quả hover VÀ một kết quả completion trong cùng response
// dùng hai cơ sở vị trí khác nhau [INV-TOOL-1]; HOẶC một line/column vượt giới hạn thực tế lọt tới
// fake LSP facade thay vì bị từ chối TRƯỚC khi gọi [INV-TOOL-5]; HOẶC một workspace chưa sẵn sàng
// được báo cáo như một kết quả THÀNH CÔNG rỗng thay vì một lỗi được đặt tên [INV-TOOL-4]".
//
// Tầng tool ở đây là hàm thuần của một LspFacade được tiêm (harness/docs/design/architecture.md,
// bảng thành phần). Không có JDT LS thật trong tệp này: facade giả vừa là nguồn câu trả lời, vừa là
// máy đếm — nhờ đó "chưa gọi LSP lần nào" trở thành một đại lượng đo được, không phải một suy đoán.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  callPositionalTool,
  fromLspPosition,
  fromLspRange,
  toLspPosition,
  validatePosition,
  TOOL_ERROR_CODES,
  type LspFacade,
  type LspRange,
  type ToolErrorCode,
  type WorkspaceAvailability,
} from "../../src/tools/tool-layer.ts";

// Nội dung tệp mà facade giả phục vụ. Có dấu tiếng Việt (é, ê, à — mỗi ký tự một UTF-16 code unit)
// và một ký tự astral-plane (🚀 — hai code unit), đúng bộ ký tự mà seam của INV-TOOL-1 đòi hỏi.
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

// Token `gréet` trên dòng LSP 5 chiếm UTF-16 unit [9, 14). Cả hover lẫn completion đều trả về đúng
// range này, nên mọi khác biệt trong kết quả chỉ có thể đến từ đường chuyển đổi toạ độ.
const LSP_TOKEN_RANGE: LspRange = {
  start: { line: 5, character: 9 },
  end: { line: 5, character: 14 },
};

interface RecordedRequest {
  method: string;
  params: unknown;
}

interface FakeFacadeOptions {
  availability?: WorkspaceAvailability;
  content?: string | undefined;
  hover?: unknown;
  completion?: unknown;
  rejectWith?: Error;
}

/**
 * Facade giả. `requests` là bằng chứng cơ học cho INV-TOOL-5: nếu một toạ độ vượt giới hạn vẫn sinh
 * ra một phần tử ở đây thì việc xác thực đã xảy ra SAU lời gọi LSP, hoặc không hề xảy ra.
 */
function makeFacade(options: FakeFacadeOptions = {}): {
  facade: LspFacade;
  requests: RecordedRequest[];
} {
  const requests: RecordedRequest[] = [];
  const facade: LspFacade = {
    workspace: () =>
      options.availability ?? { status: "ready", workspaceId: "ws-demo" },
    readFile: () => ("content" in options ? options.content : FIXTURE),
    request: async (method: string, params: unknown) => {
      requests.push({ method, params });
      if (options.rejectWith !== undefined) throw options.rejectWith;
      if (method === "textDocument/hover") return options.hover ?? null;
      if (method === "textDocument/completion") return options.completion ?? { items: [] };
      return null;
    },
  };
  return { facade, requests };
}

function expectValue<T>(outcome: { isError: false; value: T } | { isError: true; code: ToolErrorCode; message: string }): T {
  assert.equal(
    outcome.isError,
    false,
    outcome.isError ? `expected a successful result, got ${outcome.code}: ${outcome.message}` : "",
  );
  return (outcome as { isError: false; value: T }).value;
}

// -------------------------------------------------------------------------------------------
// INV-TOOL-1 — một cơ sở toạ độ duy nhất, chuyển đổi tại đúng một ranh giới
// -------------------------------------------------------------------------------------------

test(
  "INV-TOOL-1: hover và completion trong cùng một response dùng chung một cơ sở vị trí 1-based",
  { timeout: 5_000 },
  async () => {
    const { facade } = makeFacade({
      hover: {
        contents: { kind: "markdown", value: "String gréet(String tên)" },
        range: LSP_TOKEN_RANGE,
      },
      completion: {
        items: [{ label: "gréet", textEdit: { range: LSP_TOKEN_RANGE, newText: "gréet" } }],
      },
    });

    const answer = expectValue(
      await callPositionalTool(facade, { path: FIXTURE_PATH, line: 6, column: 11 }, [
        "hover",
        "completion",
      ]),
    );

    assert.equal(answer.hover?.resolved, true, "facade trả về hover có nội dung nên hover phải resolved");
    const hoverRange = answer.hover?.resolved === true ? answer.hover.range : undefined;
    assert.ok(hoverRange !== undefined, "hover thành công luôn mang range (INV-TOOL-6)");
    const completionRange = answer.completion?.items[0]?.range;
    assert.ok(completionRange !== undefined, "completion item phải mang range đã chuyển đổi");

    // Literal, không tự tham chiếu thuật toán: LSP (line 5, character 9..14) là 1-based
    // (line 6, column 10..15).
    assert.deepEqual(hoverRange, {
      start: { line: 6, column: 10 },
      end: { line: 6, column: 15 },
    });

    // Đây là câu khẳng định giết mutant "mỗi capability tự chuyển đổi lấy": hai đường khác nhau chỉ
    // cần lệch một đơn vị là hỏng, dù cả hai vẫn "trông hợp lệ".
    assert.deepEqual(
      completionRange,
      hoverRange,
      "cùng một vị trí LSP phải cho cùng một vị trí kết quả, bất kể method nào sinh ra nó",
    );

    // Đối chiếu ngược với byte thật của tệp: range 1-based phải trỏ đúng token nguồn.
    const line = FIXTURE_LINES[hoverRange.start.line - 1];
    assert.equal(
      line.slice(hoverRange.start.column - 1, hoverRange.end.column - 1),
      "gréet",
      "range báo về phải cắt đúng token trong nội dung thật của tệp",
    );
  },
);

test("chuyển đổi toạ độ: LSP (line 5, character 10) là (line 6, column 11)", () => {
  assert.deepEqual(fromLspPosition({ line: 5, character: 10 }), { line: 6, column: 11 });
  assert.deepEqual(toLspPosition({ line: 6, column: 11 }), { line: 5, character: 10 });
  assert.deepEqual(
    fromLspRange({ start: { line: 0, character: 0 }, end: { line: 5, character: 10 } }),
    { start: { line: 1, column: 1 }, end: { line: 6, column: 11 } },
  );
});

test(
  "vị trí gửi xuống LSP là 0-based: caller nói (6, 11), facade nhận (5, 10)",
  { timeout: 5_000 },
  async () => {
    const { facade, requests } = makeFacade({
      hover: { contents: "x", range: LSP_TOKEN_RANGE },
    });

    expectValue(
      await callPositionalTool(facade, { path: FIXTURE_PATH, line: 6, column: 11 }, ["hover"]),
    );

    assert.equal(requests.length, 1);
    assert.deepEqual(
      (requests[0].params as { position: unknown }).position,
      { line: 5, character: 10 },
      "đúng một ranh giới: 1-based của caller được hạ xuống 0-based trước khi lên dây",
    );
  },
);

test(
  "hover không mang range vẫn được cấp range 1-based đúc từ nội dung tệp, qua cùng ranh giới",
  { timeout: 5_000 },
  async () => {
    const { facade } = makeFacade({ hover: { contents: "String gréet(String tên)" } });

    const answer = expectValue(
      await callPositionalTool(facade, { path: FIXTURE_PATH, line: 6, column: 11 }, ["hover"]),
    );

    assert.equal(answer.hover?.resolved, true);
    const range = answer.hover?.resolved === true ? answer.hover.range : undefined;
    assert.deepEqual(range, { start: { line: 6, column: 10 }, end: { line: 6, column: 15 } });
  },
);

// -------------------------------------------------------------------------------------------
// INV-TOOL-5 — xác thực tham số TRƯỚC bất kỳ lời gọi LSP nào
// -------------------------------------------------------------------------------------------

test(
  "INV-TOOL-5: một vị trí hợp lệ thì facade CÓ được gọi — mỏ neo dương cho phép đếm bên dưới",
  { timeout: 5_000 },
  async () => {
    const { facade, requests } = makeFacade({ hover: { contents: "x", range: LSP_TOKEN_RANGE } });

    expectValue(
      await callPositionalTool(facade, { path: FIXTURE_PATH, line: 6, column: 11 }, [
        "hover",
        "completion",
      ]),
    );

    assert.equal(requests.length, 2, "hai capability hợp lệ phải sinh đúng hai lời gọi LSP");
  },
);

test(
  "INV-TOOL-5: line/column vượt giới hạn thực tế bị từ chối là invalid-position, không lời gọi LSP nào",
  { timeout: 5_000 },
  async () => {
    const oversized = [
      { line: 99, column: 1, why: "dòng vượt quá số dòng của tệp" },
      { line: 6, column: 500, why: "cột vượt quá độ dài dòng" },
      { line: 0, column: 1, why: "dòng 0 không tồn tại trong hệ 1-based" },
      { line: 6, column: 0, why: "cột 0 không tồn tại trong hệ 1-based" },
      { line: 6.5, column: 1, why: "dòng không nguyên" },
      { line: FIXTURE_LINES.length + 1, column: 1, why: "ngay sau dòng cuối cùng" },
    ];

    for (const { line, column, why } of oversized) {
      const { facade, requests } = makeFacade({
        hover: { contents: "x", range: LSP_TOKEN_RANGE },
        completion: { items: [{ label: "x", textEdit: { range: LSP_TOKEN_RANGE, newText: "x" } }] },
      });

      const outcome = await callPositionalTool(facade, { path: FIXTURE_PATH, line, column }, [
        "hover",
        "completion",
      ]);

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

test("INV-TOOL-5: cột đo bằng UTF-16 code unit, ký tự astral chiếm hai đơn vị", () => {
  const astralLine = FIXTURE_LINES[4];
  assert.ok(astralLine.includes("🚀"), "fixture phải chứa ký tự astral-plane");

  const atEol = validatePosition(FIXTURE, { line: 5, column: astralLine.length + 1 }, FIXTURE_PATH);
  assert.equal(atEol.isError, false, "vị trí ngay cuối dòng là hợp lệ (điểm chèn)");

  const pastEol = validatePosition(FIXTURE, { line: 5, column: astralLine.length + 2 }, FIXTURE_PATH);
  assert.equal(pastEol.isError, true, "một đơn vị nữa là vượt giới hạn");
  assert.equal(pastEol.isError === true ? pastEol.code : undefined, "invalid-position");
});

// -------------------------------------------------------------------------------------------
// INV-TOOL-4 — mọi thất bại là lỗi có tên, không bao giờ là thành công rỗng
// -------------------------------------------------------------------------------------------

test(
  "INV-TOOL-4: workspace chưa sẵn sàng là lỗi có tên `not-ready`, không phải kết quả rỗng thành công",
  { timeout: 5_000 },
  async () => {
    const { facade, requests } = makeFacade({
      availability: { status: "not-ready", detail: "semantic probe đã thử 3 lần, chưa có kết quả" },
    });

    const outcome = await callPositionalTool(facade, { path: FIXTURE_PATH, line: 6, column: 11 }, [
      "hover",
      "completion",
    ]);

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
  "INV-TOOL-4: mỗi nhánh của taxonomy X-003 được báo cáo dưới đúng tên của nó",
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
      const { facade, requests } = makeFacade({ availability: { status, detail: `chi tiết ${status}` } });
      const outcome = await callPositionalTool(facade, { path: FIXTURE_PATH, line: 6, column: 11 }, [
        "hover",
      ]);
      assert.equal(outcome.isError, true, `${status} phải là lỗi`);
      assert.equal(outcome.isError === true ? outcome.code : undefined, status);
      assert.ok(
        outcome.isError === true && outcome.message.includes(`chi tiết ${status}`),
        `${status} phải chuyển tiếp chi tiết mà facade cung cấp`,
      );
      assert.equal(requests.length, 0, `${status}: không được gọi LSP`);
    }

    assert.deepEqual(
      [...TOOL_ERROR_CODES].sort(),
      [...unavailable, "invalid-position"].sort(),
      "taxonomy là đóng: không có mã nào ngoài X-003",
    );
  },
);

test(
  "INV-TOOL-4: một LSP request bị từ chối thành lỗi `workspace-crashed`, không phải kết quả rỗng",
  { timeout: 5_000 },
  async () => {
    const { facade } = makeFacade({ rejectWith: new Error("JDT LS process exited with code 1") });

    const outcome = await callPositionalTool(facade, { path: FIXTURE_PATH, line: 6, column: 11 }, [
      "hover",
    ]);

    assert.equal(outcome.isError, true);
    assert.equal(outcome.isError === true ? outcome.code : undefined, "workspace-crashed");
    assert.ok(
      outcome.isError === true && outcome.message.includes("JDT LS process exited"),
      "nguyên nhân gốc phải còn nguyên trong thông điệp",
    );
  },
);

test(
  "INV-TOOL-4: hover không giải được phần tử nào là no-result tường minh, không phải trường bị bỏ trống",
  { timeout: 5_000 },
  async () => {
    const { facade } = makeFacade({ hover: null });

    const answer = expectValue(
      await callPositionalTool(facade, { path: FIXTURE_PATH, line: 6, column: 11 }, ["hover"]),
    );

    assert.notEqual(answer.hover, undefined, "hover không bao giờ là một trường bị bỏ trống");
    assert.equal(answer.hover?.resolved, false);
    assert.ok(
      answer.hover?.resolved === false && answer.hover.reason.length > 0,
      "no-result phải nói vì sao",
    );
  },
);

test(
  "INV-TOOL-1: toạ độ trong `reason` của một hover không giải được cũng ở hệ 1-based",
  { timeout: 5_000 },
  async () => {
    const { facade } = makeFacade({ hover: null });

    // `reason` là một chuỗi mà agent ĐỌC, nên nó chở một toạ độ ra khỏi tầng tool y như `range`.
    // Nếu chuỗi này được dựng bằng một phép cộng riêng, đó là ranh giới chuyển đổi thứ ba và
    // INV-TOOL-1 không còn đúng — dù mọi `range` vẫn đúng.
    const answer = expectValue(
      await callPositionalTool(facade, { path: FIXTURE_PATH, line: 6, column: 11 }, ["hover"]),
    );

    const reason = answer.hover?.resolved === false ? answer.hover.reason : "";
    // Literal, đúng cặp số mà người gọi vừa gửi vào: LSP (5, 10) trở lại thành (6, 11).
    assert.ok(
      reason.includes("line 6") && reason.includes("column 11"),
      `reason phải nêu toạ độ 1-based mà người gọi đã hỏi, nhận được: ${reason}`,
    );
    // Và cùng lúc, đó đúng là thứ ranh giới duy nhất sinh ra cho vị trí LSP tương ứng.
    const converted = fromLspPosition({ line: 5, character: 10 });
    assert.ok(
      reason.includes(`line ${converted.line}`) && reason.includes(`column ${converted.column}`),
      `reason phải đi qua đúng ranh giới chuyển đổi chung, nhận được: ${reason}`,
    );
    assert.equal(answer.position.line, converted.line, "vị trí echo lại và reason phải cùng một hệ");
    assert.equal(answer.position.column, converted.column);
  },
);

// -------------------------------------------------------------------------------------------
// Hai ranh giới phụ mà INV-TOOL-5 và INV-TOOL-1 vẫn sở hữu: kiểu xuống dòng, và cặp surrogate
// -------------------------------------------------------------------------------------------

test("INV-TOOL-5: với nội dung CRLF, cuối dòng thật là trước ký tự CR, không phải sau nó", () => {
  // Một tệp Java được chỉnh sửa trên Windows tới đây nguyên vẹn: nếu tách dòng chỉ theo `\n`, ký tự
  // `\r` còn sót lại làm mỗi dòng dài thêm một đơn vị, và một cột vượt quá cuối dòng thật được
  // chấp nhận — đúng ranh giới mà INV-TOOL-5 sở hữu.
  const crlf = "int a;\r\nint bb;\r\n";
  const lines = ["int a;", "int bb;", ""];

  const atEol = validatePosition(crlf, { line: 1, column: lines[0]!.length + 1 }, FIXTURE_PATH);
  assert.equal(atEol.isError, false, "điểm chèn ngay cuối dòng vẫn hợp lệ");

  const pastEol = validatePosition(crlf, { line: 1, column: lines[0]!.length + 2 }, FIXTURE_PATH);
  assert.equal(pastEol.isError, true, "một đơn vị nữa là vượt quá cuối dòng thật, CR không phải nội dung");
  assert.equal(pastEol.isError === true ? pastEol.code : undefined, "invalid-position");

  assert.equal(
    validatePosition(crlf, { line: 3, column: 1 }, FIXTURE_PATH).isError,
    false,
    "tệp kết thúc bằng CRLF vẫn có một dòng rỗng cuối",
  );
  assert.equal(
    validatePosition(crlf, { line: 4, column: 1 }, FIXTURE_PATH).isError,
    true,
    "CRLF không được đếm thành hai lần xuống dòng",
  );

  // Cùng bất biến, với kiểu xuống dòng CR cổ điển.
  assert.equal(validatePosition("int a;\rint bb;", { line: 2, column: 8 }, FIXTURE_PATH).isError, false);
  assert.equal(validatePosition("int a;\rint bb;", { line: 2, column: 9 }, FIXTURE_PATH).isError, true);
});

test(
  "INV-TOOL-1: range dự phòng đi theo ranh giới code point, một cặp surrogate không bị cắt đôi",
  { timeout: 5_000 },
  async () => {
    // `𝐀` (U+1D400) là một chữ cái hợp lệ trong định danh Java và chiếm HAI UTF-16 code unit.
    // JDT LS không đặt `Hover.range`, nên range được đúc từ nội dung tệp; nếu bước dò token bước
    // từng code unit, nó dừng giữa cặp surrogate và trả về một range cắt đôi một ký tự.
    const content = "class A { int 𝐀bc = 1; }";
    assert.equal(content.indexOf("𝐀"), 14, "fixture phải đặt ký tự astral đúng vị trí đã tính");
    assert.equal(content.length, 25, "𝐀 phải chiếm hai UTF-16 code unit");

    for (const [column, why] of [
      [15, "hỏi ngay tại ký tự astral: quét xuôi phải nhảy trọn cặp"],
      [18, "hỏi ở cuối định danh: quét ngược phải nhảy trọn cặp"],
    ] as const) {
      const { facade } = makeFacade({ content, hover: { contents: "int 𝐀bc" } });
      const answer = expectValue(
        await callPositionalTool(facade, { path: FIXTURE_PATH, line: 1, column }, ["hover"]),
      );
      const range = answer.hover?.resolved === true ? answer.hover.range : undefined;
      // Định danh `𝐀bc` chiếm UTF-16 unit [14, 18) → 1-based cột 15..19.
      assert.deepEqual(
        range,
        { start: { line: 1, column: 15 }, end: { line: 1, column: 19 } },
        `range của định danh chứa ký tự astral phải trọn vẹn — ${why}`,
      );
    }
  },
);

test(
  "INV-TOOL-4: một tệp không đọc được là lỗi có tên, không phải một hover rỗng",
  { timeout: 5_000 },
  async () => {
    const { facade, requests } = makeFacade({ content: undefined });

    const outcome = await callPositionalTool(facade, { path: FIXTURE_PATH, line: 6, column: 11 }, [
      "hover",
    ]);

    assert.equal(outcome.isError, true);
    assert.equal(outcome.isError === true ? outcome.code : undefined, "unroutable");
    assert.ok(outcome.isError === true && outcome.message.includes(FIXTURE_PATH), "lỗi phải nêu tên đường dẫn");
    assert.equal(requests.length, 0);
  },
);
