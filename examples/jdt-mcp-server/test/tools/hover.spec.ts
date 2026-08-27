// Oracle cho feat-tool-hover.
//
// Falsifier đang bị kiểm chứng: "trả về một hover result mà vị trí chưa từng đi qua ranh giới
// chuyển đổi duy nhất của tầng tool, nên âm thầm là 0-based trong khi mọi kết quả tool khác là
// 1-based [INV-TOOL-1]; HOẶC một hover result thành công bỏ sót trường `range` [INV-TOOL-6]".
//
// `java_hover` là một wrapper mỏng: hình dạng tham số lấy từ bảng tool trong
// harness/docs/design/tool-surface.md, còn việc chuyển đổi toạ độ, đúc range và đặt tên lỗi thuộc
// về `src/tools/tool-layer.ts`. Vì vậy tệp này đo hai thứ: kết quả `java_hover` đúng hệ 1-based và
// luôn mang `range`, VÀ nó trùng khít với kết quả đi thẳng qua tầng tool — nếu wrapper tự cộng trừ
// lấy, hai đường sẽ lệch nhau.
//
// Không có JDT LS thật ở đây: facade giả vừa trả lời, vừa ghi lại mọi lời gọi, nên "vị trí gửi
// xuống dây là 0-based" và "chưa gọi LSP lần nào" đều là đại lượng đo được.

import { test } from "node:test";
import assert from "node:assert/strict";

import { javaHover } from "../../src/tools/hover.ts";
import {
  callPositionalTool,
  HOVER_METHOD,
  TOOL_ERROR_CODES,
  type LspFacade,
  type LspRange,
  type ToolErrorCode,
  type WorkspaceAvailability,
} from "../../src/tools/tool-layer.ts";

// Fixture chứa dấu tiếng Việt (mỗi ký tự một UTF-16 code unit) và một ký tự astral-plane 🚀 (hai
// code unit) đứng TRƯỚC token đích trên cùng một dòng — đúng bộ ký tự mà seam của INV-TOOL-1 đòi.
const FIXTURE_LINES = [
  "package demo;", // dòng LSP 0
  "", // 1
  "/** Bộ đếm 🚀 — kiểm thử toạ độ. */", // 2
  "public class Rocket {", // 3
  '  private final String nhãn = "🚀 khởi động";', // 4
  "  String gréet(String tên) {", // 5
  "    return nhãn + tên;", // 6
  "  }", // 7
  "}", // 8
];
const FIXTURE = FIXTURE_LINES.join("\n");
const FIXTURE_PATH = "/tmp/demo/src/main/java/demo/Rocket.java";

const WORKSPACE_ID = "ws-rocket";

/** Đo trực tiếp trên nội dung thật của tệp, bằng UTF-16 code unit — cùng đơn vị LSP dùng. */
function lineOf(lspLine: number): string {
  const text = FIXTURE_LINES[lspLine];
  assert.ok(text !== undefined, `fixture phải có dòng LSP ${lspLine}`);
  return text;
}

function tokenOffsets(lspLine: number, token: string): { start: number; end: number } {
  const text = lineOf(lspLine);
  const start = text.indexOf(token);
  assert.ok(start >= 0, `token ${token} phải có mặt trên dòng LSP ${lspLine}`);
  return { start, end: start + token.length };
}

// Token `gréet` trên dòng LSP 5.
const GREET_LINE = 5;
const GREET = tokenOffsets(GREET_LINE, "gréet");
const GREET_LSP_RANGE: LspRange = {
  start: { line: GREET_LINE, character: GREET.start },
  end: { line: GREET_LINE, character: GREET.end },
};

// Token `động` trên dòng LSP 4, nằm SAU ký tự astral: một bộ chuyển đổi nhầm code point với
// UTF-16 code unit sẽ trỏ lệch một đơn vị và range báo về cắt ra một chuỗi khác.
const ASTRAL_LINE = 4;
const ASTRAL_TOKEN = "động";
const ASTRAL = tokenOffsets(ASTRAL_LINE, ASTRAL_TOKEN);

const JDT_SIGNATURE = "String demo.Rocket.gréet(String tên)";
const JDT_JAVADOC = "Chào một người dùng theo tên.";

interface RecordedRequest {
  method: string;
  params: unknown;
}

interface FakeFacadeOptions {
  availability?: WorkspaceAvailability;
  content?: string | undefined;
  hover?: unknown;
  rejectWith?: Error;
}

function makeFacade(options: FakeFacadeOptions = {}): {
  facade: LspFacade;
  requests: RecordedRequest[];
} {
  const requests: RecordedRequest[] = [];
  const facade: LspFacade = {
    workspace: () => options.availability ?? { status: "ready", workspaceId: WORKSPACE_ID },
    readFile: () => ("content" in options ? options.content : FIXTURE),
    request: async (method: string, params: unknown) => {
      requests.push({ method, params });
      if (options.rejectWith !== undefined) throw options.rejectWith;
      if (method === HOVER_METHOD) return options.hover ?? null;
      return null;
    },
  };
  return { facade, requests };
}

type Outcome = Awaited<ReturnType<typeof javaHover>>;
type HoverValue = Extract<Outcome, { isError: false }>["value"];

function expectValue(outcome: Outcome): HoverValue {
  assert.equal(
    outcome.isError,
    false,
    outcome.isError ? `mong đợi kết quả thành công, nhận ${outcome.code}: ${outcome.message}` : "",
  );
  return (outcome as Extract<Outcome, { isError: false }>).value;
}

/** Đọc `range` như một giá trị thô, để "trường bị bỏ sót" là một quan sát chứ không phải lỗi kiểu. */
function rawField(value: unknown, field: string): unknown {
  return (value as Record<string, unknown>)[field];
}

function expectResolved(value: HoverValue): Record<string, unknown> {
  const record = value as unknown as Record<string, unknown>;
  assert.equal(record.resolved, true, "fixture này phải cho một hover đã giải được");
  return record;
}

// -------------------------------------------------------------------------------------------
// Ca cơ bản — kết quả `java_hover` nằm trong hệ 1-based và mang đủ signature, javadoc, range
// -------------------------------------------------------------------------------------------

test(
  "java_hover trả về signature, javadoc và range 1-based cho token tại path/line/column",
  { timeout: 5_000 },
  async () => {
    const { facade, requests } = makeFacade({
      hover: {
        contents: [
          { language: "java", value: JDT_SIGNATURE },
          JDT_JAVADOC,
        ],
        range: GREET_LSP_RANGE,
      },
    });

    const value = expectValue(
      await javaHover(facade, {
        path: FIXTURE_PATH,
        line: GREET_LINE + 1,
        column: GREET.start + 1,
      }),
    );
    const resolved = expectResolved(value);

    assert.equal(resolved.path, FIXTURE_PATH);
    assert.equal(resolved.workspaceId, WORKSPACE_ID);
    assert.equal(resolved.signature, JDT_SIGNATURE, "signature là khối nội dung đầu tiên JDT LS phát");
    assert.equal(resolved.javadoc, JDT_JAVADOC, "javadoc là phần còn lại của nội dung hover");

    // Vị trí echo lại phải nằm trong CÙNG hệ với tham số của người gọi (1-based), không phải 0-based.
    assert.deepEqual(
      resolved.position,
      { line: GREET_LINE + 1, column: GREET.start + 1 },
      "vị trí trong kết quả phải là 1-based, đúng hệ mà người gọi đã dùng",
    );

    // Range là literal, đối chiếu với offset thật đo trên nội dung tệp bằng UTF-16 code unit.
    assert.deepEqual(rawField(resolved, "range"), {
      start: { line: GREET_LINE + 1, column: GREET.start + 1 },
      end: { line: GREET_LINE + 1, column: GREET.end + 1 },
    });

    // Đối chiếu ngược: range 1-based phải cắt đúng token nguồn ra khỏi nội dung thật.
    const range = rawField(resolved, "range") as {
      start: { line: number; column: number };
      end: { line: number; column: number };
    };
    assert.equal(
      lineOf(range.start.line - 1).slice(range.start.column - 1, range.end.column - 1),
      "gréet",
      "range báo về phải cắt đúng token trong nội dung thật của tệp",
    );

    // Chiều xuống: đúng một ranh giới, nên facade nhận vị trí 0-based.
    assert.equal(requests.length, 1, "đúng một lời gọi LSP cho một lần hover");
    assert.equal(requests[0]?.method, HOVER_METHOD);
    assert.deepEqual(
      (requests[0]?.params as { position: unknown }).position,
      { line: GREET_LINE, character: GREET.start },
      "1-based của người gọi được hạ xuống 0-based trước khi lên dây",
    );
  },
);

// -------------------------------------------------------------------------------------------
// INV-TOOL-1 — vị trí đi qua ĐÚNG ranh giới chuyển đổi của tầng tool, không có đường tắt
// -------------------------------------------------------------------------------------------

test(
  "INV-TOOL-1: java_hover và tầng tool cho cùng một vị trí và cùng một range trên cùng đầu vào",
  { timeout: 5_000 },
  async () => {
    const payload = { contents: { kind: "markdown", value: JDT_SIGNATURE }, range: GREET_LSP_RANGE };
    const request = { path: FIXTURE_PATH, line: GREET_LINE + 1, column: GREET.start + 1 };

    const wrapper = expectResolved(
      expectValue(await javaHover(makeFacade({ hover: payload }).facade, request)),
    );

    const core = await callPositionalTool(makeFacade({ hover: payload }).facade, request, ["hover"]);
    assert.equal(core.isError, false, "đường tham chiếu qua tầng tool phải thành công");
    const coreAnswer = (core as Extract<typeof core, { isError: false }>).value;
    assert.equal(coreAnswer.hover?.resolved, true);
    const coreRange = coreAnswer.hover?.resolved === true ? coreAnswer.hover.range : undefined;

    assert.deepEqual(
      rawField(wrapper, "range"),
      coreRange,
      "wrapper không được tự chuyển đổi: range phải trùng khít với range của tầng tool",
    );
    assert.deepEqual(
      wrapper.position,
      coreAnswer.position,
      "wrapper không được tự chuyển đổi: vị trí phải trùng khít với vị trí của tầng tool",
    );
  },
);

test(
  "INV-TOOL-1: range đúc từ nội dung tệp trỏ đúng token nằm sau một ký tự astral-plane",
  { timeout: 5_000 },
  async () => {
    assert.equal("🚀".length, 2, "ký tự astral-plane chiếm hai UTF-16 code unit");
    assert.ok(lineOf(ASTRAL_LINE).includes("🚀"), "dòng đích phải chứa ký tự astral-plane");

    // JDT LS không bao giờ đặt `Hover.range` (evidence.md), nên đây là đường đi thật: range được đúc
    // từ nội dung tệp. Một phép chuyển đổi nhầm đơn vị sẽ trỏ lệch và cắt ra chuỗi khác.
    const { facade } = makeFacade({ hover: { contents: JDT_SIGNATURE } });

    const resolved = expectResolved(
      expectValue(
        await javaHover(facade, {
          path: FIXTURE_PATH,
          line: ASTRAL_LINE + 1,
          column: ASTRAL.start + 1,
        }),
      ),
    );

    assert.deepEqual(rawField(resolved, "range"), {
      start: { line: ASTRAL_LINE + 1, column: ASTRAL.start + 1 },
      end: { line: ASTRAL_LINE + 1, column: ASTRAL.end + 1 },
    });

    const range = rawField(resolved, "range") as {
      start: { line: number; column: number };
      end: { line: number; column: number };
    };
    assert.equal(
      lineOf(range.start.line - 1).slice(range.start.column - 1, range.end.column - 1),
      ASTRAL_TOKEN,
      "range phải cắt đúng token đích, không phải token bên cạnh",
    );
  },
);

// -------------------------------------------------------------------------------------------
// INV-TOOL-6 — mọi kết quả thành công đều mang `range`; không có phần tử nào là no-result có tên
// -------------------------------------------------------------------------------------------

test(
  "INV-TOOL-6: mọi hover thành công đều mang range, bất kể JDT LS trả về dạng nội dung nào",
  { timeout: 10_000 },
  async () => {
    const payloads: Array<{ why: string; hover: unknown }> = [
      { why: "contents là chuỗi trần, không kèm range (đường đi thật của JDT LS)", hover: { contents: JDT_SIGNATURE } },
      {
        why: "contents là MarkupContent kèm range",
        hover: { contents: { kind: "markdown", value: JDT_SIGNATURE }, range: GREET_LSP_RANGE },
      },
      {
        why: "contents là mảng MarkedString, không kèm range",
        hover: { contents: [{ language: "java", value: JDT_SIGNATURE }, JDT_JAVADOC] },
      },
      { why: "contents là mảng một phần tử kèm range", hover: { contents: [JDT_SIGNATURE], range: GREET_LSP_RANGE } },
    ];

    for (const { why, hover } of payloads) {
      const { facade } = makeFacade({ hover });
      const resolved = expectResolved(
        expectValue(
          await javaHover(facade, {
            path: FIXTURE_PATH,
            line: GREET_LINE + 1,
            column: GREET.start + 1,
          }),
        ),
      );

      const range = rawField(resolved, "range") as
        | { start: { line: number; column: number }; end: { line: number; column: number } }
        | undefined;
      assert.ok(range !== undefined, `hover thành công không bao giờ bỏ sót range — ${why}`);
      for (const [name, position] of [
        ["start", range.start],
        ["end", range.end],
      ] as const) {
        assert.ok(Number.isInteger(position.line) && position.line >= 1, `${name}.line phải là số nguyên 1-based — ${why}`);
        assert.ok(
          Number.isInteger(position.column) && position.column >= 1,
          `${name}.column phải là số nguyên 1-based — ${why}`,
        );
      }
      assert.equal(range.start.line, range.end.line, `range của một token nằm trên một dòng — ${why}`);
      assert.ok(range.end.column >= range.start.column, `range không được đảo ngược — ${why}`);
      assert.equal(
        typeof rawField(resolved, "signature"),
        "string",
        `hover thành công luôn nêu signature — ${why}`,
      );
    }
  },
);

test(
  "INV-TOOL-6: vị trí không có phần tử nào là no-result tường minh, không phải thành công thiếu range",
  { timeout: 5_000 },
  async () => {
    for (const [why, hover] of [
      ["JDT LS trả null", null],
      ["JDT LS trả contents rỗng", { contents: "" }],
      ["JDT LS trả mảng contents rỗng", { contents: [] }],
    ] as const) {
      const { facade } = makeFacade({ hover });
      const value = expectValue(
        await javaHover(facade, {
          path: FIXTURE_PATH,
          line: 1,
          column: 1,
        }),
      );
      const record = value as unknown as Record<string, unknown>;

      assert.equal(record.resolved, false, `phải là no-result tường minh — ${why}`);
      assert.equal(
        typeof record.reason,
        "string",
        `no-result phải nói vì sao — ${why}`,
      );
      assert.ok((record.reason as string).length > 0, `lý do không được rỗng — ${why}`);
      assert.ok(
        !("range" in record),
        `no-result KHÔNG được giả dạng một thành công thiếu range — ${why}`,
      );
      assert.ok(
        !("signature" in record),
        `no-result KHÔNG được mang signature — ${why}`,
      );
    }
  },
);

// -------------------------------------------------------------------------------------------
// Taxonomy lỗi X-003 — thuộc về tầng tool, wrapper chỉ chuyển tiếp nguyên vẹn
// -------------------------------------------------------------------------------------------

test(
  "X-003: workspace chưa trả lời được thành lỗi có tên, không phải một hover rỗng",
  { timeout: 5_000 },
  async () => {
    const statuses = ["unroutable", "not-ready", "resyncing", "workspace-crashed", "cap-exceeded"] as const;

    for (const status of statuses) {
      const { facade, requests } = makeFacade({
        availability: { status, detail: `chi tiết ${status}` },
        hover: { contents: JDT_SIGNATURE },
      });

      const outcome = await javaHover(facade, {
        path: FIXTURE_PATH,
        line: GREET_LINE + 1,
        column: GREET.start + 1,
      });

      assert.equal(outcome.isError, true, `${status} phải là lỗi`);
      const code = outcome.isError ? outcome.code : undefined;
      assert.equal(code, status, `${status} phải giữ nguyên tên loại của tầng tool`);
      assert.ok(
        TOOL_ERROR_CODES.includes(code as ToolErrorCode),
        `${status} phải nằm trong taxonomy đóng X-003`,
      );
      assert.equal(
        (outcome as { value?: unknown }).value,
        undefined,
        `${status}: một lỗi không mang theo payload kết quả`,
      );
      assert.equal(requests.length, 0, `${status}: không hỏi một workspace chưa trả lời được`);
    }
  },
);

test(
  "X-003: line/column vượt giới hạn là invalid-position và không lời gọi LSP nào được phát ra",
  { timeout: 5_000 },
  async () => {
    const oversized = [
      { line: 99, column: 1, why: "dòng vượt quá số dòng của tệp" },
      { line: GREET_LINE + 1, column: 500, why: "cột vượt quá độ dài dòng" },
      { line: 0, column: 1, why: "dòng 0 không tồn tại trong hệ 1-based" },
      { line: GREET_LINE + 1, column: 0, why: "cột 0 không tồn tại trong hệ 1-based" },
    ];

    for (const { line, column, why } of oversized) {
      const { facade, requests } = makeFacade({ hover: { contents: JDT_SIGNATURE } });
      const outcome = await javaHover(facade, { path: FIXTURE_PATH, line, column });

      assert.equal(outcome.isError, true, `(${line}, ${column}) phải là lỗi — ${why}`);
      assert.equal(
        outcome.isError ? outcome.code : undefined,
        "invalid-position",
        `(${line}, ${column}) phải mang đúng tên loại lỗi — ${why}`,
      );
      assert.equal(requests.length, 0, `(${line}, ${column}) không được lọt tới facade — ${why}`);
    }
  },
);

test(
  "X-003: một LSP request bị từ chối thành workspace-crashed, không phải hover rỗng",
  { timeout: 5_000 },
  async () => {
    const { facade } = makeFacade({ rejectWith: new Error("JDT LS process exited with code 1") });

    const outcome = await javaHover(facade, {
      path: FIXTURE_PATH,
      line: GREET_LINE + 1,
      column: GREET.start + 1,
    });

    assert.equal(outcome.isError, true);
    assert.equal(outcome.isError ? outcome.code : undefined, "workspace-crashed");
    assert.ok(
      outcome.isError && outcome.message.includes("JDT LS process exited"),
      "nguyên nhân gốc phải còn nguyên trong thông điệp",
    );
  },
);

test(
  "X-003: một tệp không đọc được là lỗi unroutable có tên, không phải hover rỗng",
  { timeout: 5_000 },
  async () => {
    const { facade, requests } = makeFacade({ content: undefined });

    const outcome = await javaHover(facade, {
      path: FIXTURE_PATH,
      line: GREET_LINE + 1,
      column: GREET.start + 1,
    });

    assert.equal(outcome.isError, true);
    assert.equal(outcome.isError ? outcome.code : undefined, "unroutable");
    assert.ok(outcome.isError && outcome.message.includes(FIXTURE_PATH), "lỗi phải nêu tên đường dẫn");
    assert.equal(requests.length, 0, "không phát LSP request khi chưa đọc được nội dung");
  },
);

// -------------------------------------------------------------------------------------------
// Hình dạng kết quả — nội dung thô được giữ nguyên, javadoc vắng mặt là vắng mặt tường minh
// -------------------------------------------------------------------------------------------

test(
  "nội dung dạng khối mã markdown: signature là thân khối, javadoc là phần sau nó",
  { timeout: 5_000 },
  async () => {
    const markdown = ["```java", JDT_SIGNATURE, "```", JDT_JAVADOC].join("\n");
    const { facade } = makeFacade({
      hover: { contents: { kind: "markdown", value: markdown }, range: GREET_LSP_RANGE },
    });

    const resolved = expectResolved(
      expectValue(
        await javaHover(facade, {
          path: FIXTURE_PATH,
          line: GREET_LINE + 1,
          column: GREET.start + 1,
        }),
      ),
    );

    assert.equal(resolved.signature, JDT_SIGNATURE, "rào ``` không được lọt vào signature");
    assert.equal(resolved.javadoc, JDT_JAVADOC);
    assert.equal(resolved.contents, markdown, "nội dung thô vẫn giữ nguyên cả rào");
    assert.ok(rawField(resolved, "range") !== undefined, "vẫn phải có range");
  },
);

test(
  "hover chỉ có signature: javadoc vắng mặt, contents thô vẫn được giữ nguyên",
  { timeout: 5_000 },
  async () => {
    const { facade } = makeFacade({ hover: { contents: JDT_SIGNATURE, range: GREET_LSP_RANGE } });

    const resolved = expectResolved(
      expectValue(
        await javaHover(facade, {
          path: FIXTURE_PATH,
          line: GREET_LINE + 1,
          column: GREET.start + 1,
        }),
      ),
    );

    assert.equal(resolved.signature, JDT_SIGNATURE);
    assert.equal(resolved.javadoc, undefined, "không có javadoc thì trường này vắng mặt, không rỗng giả");
    assert.equal(resolved.contents, JDT_SIGNATURE, "nội dung hover thô luôn được giữ nguyên");
    assert.ok(rawField(resolved, "range") !== undefined, "vẫn phải có range");
  },
);
