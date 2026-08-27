// hover — tool `java_hover` của tầng MCP (bảng tool trong harness/docs/design/tool-surface.md).
//
// Đây là một wrapper MỎNG. Mọi thứ khó đều thuộc về `tool-layer.ts` và tệp này không được làm lại:
//
//   * chuyển đổi toạ độ 1-based ↔ 0-based đi qua ĐÚNG một ranh giới trong tầng tool [INV-TOOL-1];
//     ở đây không có một phép cộng hay trừ nào trên `line`/`column` — vị trí và range được nhận
//     nguyên vẹn từ tầng tool rồi chuyển tiếp;
//   * xác thực line/column so với nội dung HIỆN TẠI của tệp, trước mọi lời gọi LSP [INV-TOOL-5];
//   * taxonomy lỗi đóng X-003 [INV-TOOL-4]: mọi thất bại rời khỏi đây là envelope lỗi của tầng tool,
//     giữ nguyên mã và thông điệp;
//   * đúc `range` của token đã giải được khi JDT LS không kèm `Hover.range` — điều nó không bao giờ
//     làm (`HoverHandler.hover()` chỉ gọi `setContents`, xem harness/docs/design/evidence.md).
//
// Bất biến mà tool này gánh: INV-TOOL-6 — một kết quả `java_hover` THÀNH CÔNG luôn mang `range`
// định vị token nguồn mà hover đã giải được, trong cùng hệ toạ độ với mọi vị trí khác. Trường này
// không bao giờ là tuỳ chọn: kiểu `JavaHoverResolved` buộc nó có mặt, và nhánh duy nhất không có
// range là nhánh no-result có tên `resolved: false`. Nhờ đó "thành công nhưng thiếu range" không
// phải một trạng thái mà mã nguồn này biểu diễn được.
//
// Vì sao "không giải được phần tử nào" KHÔNG phải một lỗi X-003: taxonomy đó là đóng và mọi mã
// trong đó nói về một thất bại của hệ thống (không định tuyến được, chưa sẵn sàng, tiến trình chết,
// vượt hạn mức, vị trí sai). "Ở đây không có symbol" là một câu trả lời đúng về mã nguồn, không
// phải một thất bại — nên nó được biểu diễn thành một no-result TƯỜNG MINH có lý do, đúng tinh thần
// INV-TOOL-4: không thất bại nào bị mã hoá thành kết quả rỗng, và không câu trả lời nào bị mã hoá
// thành một trường bị bỏ trống.

import {
  hover as hoverThroughToolLayer,
  type LspFacade,
  type SourcePosition,
  type SourceRange,
  type ToolOutcome,
} from "./tool-layer.ts";

/** Tham số của `java_hover`, đúng bảng tool: `path`, `line`, `column` (1-based, X-007). */
export interface JavaHoverArguments {
  path: string;
  line: number;
  column: number;
}

/** Phần chung của cả hai nhánh: chúng luôn nói kết quả này thuộc về tệp nào và vị trí nào. */
interface JavaHoverBase {
  path: string;
  workspaceId: string;
  /** Vị trí đã được xác thực, echo lại trong CÙNG hệ toạ độ với `range` bên dưới. */
  position: SourcePosition;
}

export interface JavaHoverResolved extends JavaHoverBase {
  resolved: true;
  /** Khối nội dung đầu tiên JDT LS phát ra: nhãn của phần tử đã giải được. */
  signature: string;
  /** Phần còn lại của nội dung hover. Vắng mặt khi phần tử không có javadoc. */
  javadoc?: string;
  /** Nội dung hover thô, đã gộp — giữ nguyên để không mất gì so với câu trả lời của JDT LS. */
  contents: string;
  /** INV-TOOL-6: bắt buộc, trong hệ 1-based, định vị token mà hover đã giải được. */
  range: SourceRange;
}

export interface JavaHoverUnresolved extends JavaHoverBase {
  resolved: false;
  /** Vì sao không có câu trả lời. Không bao giờ rỗng, và nhánh này không mang `range`. */
  reason: string;
}

export type JavaHoverResult = JavaHoverResolved | JavaHoverUnresolved;

/**
 * Gọi `textDocument/hover` cho symbol tại `path/line/column` và tạo hình câu trả lời `java_hover`.
 *
 * Đường đi: tất cả đều nằm trong `hoverThroughToolLayer`. Tệp này chỉ đọc kết quả đã chuyển đổi và
 * đổi tên trường sang bề mặt công bố của tool.
 */
export async function javaHover(
  facade: LspFacade,
  args: JavaHoverArguments,
): Promise<ToolOutcome<JavaHoverResult>> {
  const outcome = await hoverThroughToolLayer(facade, {
    path: args.path,
    line: args.line,
    column: args.column,
  });
  // Lỗi đi thẳng ra ngoài: mã và thông điệp là của tầng tool, wrapper không đặt tên lại (X-003).
  if (outcome.isError) return outcome;

  const answer = outcome.value;
  const base: JavaHoverBase = {
    path: answer.path,
    workspaceId: answer.workspaceId,
    // Nguyên vẹn từ tầng tool. Không có phép cộng trừ nào ở đây — đó là toàn bộ INV-TOOL-1.
    position: answer.position,
  };

  const shaped = answer.hover;
  if (shaped === undefined) {
    // Không đạt tới được khi capability "hover" đã được yêu cầu; nếu hợp đồng của tầng tool đổi,
    // nhánh này vẫn là một no-result có tên chứ không bao giờ là một thành công thiếu range.
    return {
      isError: false,
      value: {
        ...base,
        resolved: false,
        reason: `tool layer returned no hover section for ${args.path}`,
      },
    };
  }

  if (!shaped.resolved) {
    return { isError: false, value: { ...base, resolved: false, reason: shaped.reason } };
  }

  const { signature, javadoc } = splitHoverContents(shaped.contents);
  const value: JavaHoverResolved = {
    ...base,
    resolved: true,
    signature,
    contents: shaped.contents,
    // `range` đã ở hệ 1-based khi rời tầng tool; chuyển tiếp nguyên vẹn là cách duy nhất giữ được
    // "đúng một ranh giới chuyển đổi".
    range: shaped.range,
  };
  if (javadoc !== undefined) value.javadoc = javadoc;
  return { isError: false, value };
}

/**
 * Tách nội dung hover thành nhãn phần tử và phần javadoc còn lại.
 *
 * JDT LS phát nội dung hover theo thứ tự cố định: nhãn của phần tử trước, javadoc sau
 * (`HoverInfoProvider`), và tầng tool gộp các phần bằng một dấu xuống dòng. Vì vậy khối đầu tiên là
 * signature. Hai dạng khối được nhận: một dòng trần, hoặc một khối mã markdown có rào ``` — dạng
 * thứ hai xuất hiện khi client thương lượng `MarkupContent` thay cho `MarkedString`.
 *
 * Đây là phép tách trình bày, không phải phép biến đổi dữ liệu: `contents` thô luôn được giữ
 * nguyên trong kết quả, nên không câu chữ nào của JDT LS bị mất ở đây.
 */
function splitHoverContents(contents: string): { signature: string; javadoc?: string } {
  const fenced = readFencedBlock(contents);
  const split = fenced ?? readFirstLine(contents);
  const javadoc = split.rest.trim();
  return javadoc.length === 0
    ? { signature: split.signature }
    : { signature: split.signature, javadoc };
}

function readFirstLine(contents: string): { signature: string; rest: string } {
  const breakAt = contents.indexOf("\n");
  if (breakAt < 0) return { signature: contents.trim(), rest: "" };
  return { signature: contents.slice(0, breakAt).trim(), rest: contents.slice(breakAt + 1) };
}

/** Khối mã markdown mở đầu nội dung, ví dụ "```java\n<nhãn>\n```". */
function readFencedBlock(contents: string): { signature: string; rest: string } | undefined {
  const opening = /^\s*```[^\n]*\n/.exec(contents);
  if (opening === null) return undefined;
  const bodyStart = opening[0].length;
  const closing = contents.indexOf("\n```", bodyStart - 1);
  if (closing < 0) return undefined;
  const body = contents.slice(bodyStart, closing).trim();
  const afterFence = contents.indexOf("\n", closing + 1);
  const rest = afterFence < 0 ? "" : contents.slice(afterFence + 1);
  return { signature: body, rest };
}
