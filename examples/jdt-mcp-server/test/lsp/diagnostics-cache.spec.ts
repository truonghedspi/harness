// Oracle của diagnostics-cache (INV-DIAG-1/2/3, harness/docs/design/tool-surface.md).
//
// Mọi ca dưới đây đều đồng bộ: chúng chỉ gọi hàm và đọc lại bộ nhớ đệm, không chờ I/O. Vì vậy
// không ca nào mang { timeout: N } — DECISIONS.md 2026-08-22 đã đo được rằng tuỳ chọn đó vô hiệu
// với callback đồng bộ (timer không chạy khi event loop bị chặn) và chỉ tạo cảm giác an toàn giả.
import assert from "node:assert/strict";
import test from "node:test";

import {
  createDiagnosticsCache,
  PUBLISH_DIAGNOSTICS_METHOD,
  type Diagnostic,
  type LspNotificationSource,
} from "../../src/lsp/diagnostics-cache.ts";

const WS_A = "ws-a";
const WS_B = "ws-b";
const BROKEN = "file:///projects/a/src/main/java/spike/Broken.java";

function diagnostic(message: string, line = 0, severity = 1): Diagnostic {
  return {
    range: { start: { line, character: 0 }, end: { line, character: 7 } },
    severity,
    source: "Java",
    message,
  };
}

/** Nguồn notification giả lập ranh giới mà LspClient sẽ nối vào; ghi lại đúng những gì được đăng ký. */
class RecordingSource implements LspNotificationSource {
  readonly registrations: { method: string; handler: (params: unknown) => void }[] = [];

  public onNotification(method: string, handler: (params: unknown) => void): void {
    this.registrations.push({ method, handler });
  }

  /** Phát một notification đúng như JDT LS đẩy về: chỉ có method và params, không có id. */
  public publish(method: string, params: unknown): void {
    for (const registration of this.registrations) {
      if (registration.method === method) registration.handler(params);
    }
  }
}

test("một publish cho URI chưa từng thấy được lưu nguyên vẹn và đọc lại được", () => {
  const cache = createDiagnosticsCache();
  const problems = [diagnostic("Type mismatch: cannot convert from String to int", 4)];

  assert.equal(cache.absorb(WS_A, { uri: BROKEN, version: 3, diagnostics: problems }), true);

  const lookup = cache.get(WS_A, BROKEN);
  assert.equal(lookup.reported, true);
  assert.equal(lookup.uri, BROKEN);
  assert.deepEqual(lookup.reported ? [...lookup.diagnostics] : null, problems);
  assert.equal(lookup.reported ? lookup.version : undefined, 3);
});

// INV-DIAG-2 — ca giết falsifier của tính năng.
test("publish danh sách RỖNG thay thế hoàn toàn các problem đã cache, không giữ lại cái cũ", () => {
  const cache = createDiagnosticsCache();
  cache.absorb(WS_A, {
    uri: BROKEN,
    diagnostics: [diagnostic("Type mismatch: cannot convert from String to int", 4), diagnostic("Dead code", 9, 2)],
  });

  cache.absorb(WS_A, { uri: BROKEN, diagnostics: [] });

  const lookup = cache.get(WS_A, BROKEN);
  // Rỗng phải là "đã báo cáo, không còn vấn đề" — không phải "chưa từng báo cáo" (INV-DIAG-1)
  // và tuyệt đối không phải "vẫn còn hai vấn đề cũ" (INV-DIAG-2).
  assert.equal(lookup.reported, true);
  assert.deepEqual(lookup.reported ? [...lookup.diagnostics] : null, []);
  assert.equal(lookup.reported ? lookup.diagnostics.length : -1, 0);

  const listed = cache.list(WS_A);
  assert.equal(listed.length, 1);
  assert.equal(listed[0]?.uri, BROKEN);
  assert.equal(listed[0]?.diagnostics.length, 0);
});

test("publish sau cho cùng URI thay thế hoàn toàn publish trước, không cộng dồn", () => {
  const cache = createDiagnosticsCache();
  cache.absorb(WS_A, { uri: BROKEN, version: 1, diagnostics: [diagnostic("old-a"), diagnostic("old-b")] });

  cache.absorb(WS_A, { uri: BROKEN, version: 2, diagnostics: [diagnostic("new-only")] });

  const lookup = cache.get(WS_A, BROKEN);
  assert.equal(lookup.reported, true);
  const messages = lookup.reported ? lookup.diagnostics.map((item) => item.message) : [];
  assert.deepEqual(messages, ["new-only"]);
  assert.equal(messages.includes("old-a"), false);
  assert.equal(messages.includes("old-b"), false);
  assert.equal(lookup.reported ? lookup.version : undefined, 2);
});

// INV-DIAG-1 — rỗng không bao giờ được đứng thay cho "chưa tính".
test("URI chưa có publish nào trả về mốc 'chưa báo cáo', khác hẳn danh sách rỗng đã báo cáo", () => {
  const cache = createDiagnosticsCache();
  const before = cache.get(WS_A, BROKEN);
  assert.equal(before.reported, false);
  assert.equal("diagnostics" in before, false);

  cache.absorb(WS_A, { uri: BROKEN, diagnostics: [] });

  const after = cache.get(WS_A, BROKEN);
  assert.equal(after.reported, true);
  assert.deepEqual(after.reported ? [...after.diagnostics] : null, []);
});

// INV-DIAG-3 — fixture spike B: hai workspace, cùng một đường dẫn tương đối.
test("hai workspace giữ cache riêng cho cùng một chuỗi URI, không lẫn sang nhau", () => {
  const cache = createDiagnosticsCache();
  cache.absorb(WS_A, { uri: BROKEN, diagnostics: [diagnostic("problem thuộc workspace A")] });
  cache.absorb(WS_B, { uri: BROKEN, diagnostics: [diagnostic("problem thuộc workspace B", 1)] });

  const fromA = cache.get(WS_A, BROKEN);
  const fromB = cache.get(WS_B, BROKEN);
  assert.deepEqual(fromA.reported ? fromA.diagnostics.map((item) => item.message) : [], [
    "problem thuộc workspace A",
  ]);
  assert.deepEqual(fromB.reported ? fromB.diagnostics.map((item) => item.message) : [], [
    "problem thuộc workspace B",
  ]);

  // Xoá sạch một workspace không được chạm vào workspace kia.
  cache.forget(WS_A);
  assert.equal(cache.get(WS_A, BROKEN).reported, false);
  assert.equal(cache.get(WS_B, BROKEN).reported, true);
  assert.equal(cache.list(WS_A).length, 0);
  assert.equal(cache.list(WS_B).length, 1);
});

test("list chỉ trả về các URI của đúng workspace được hỏi", () => {
  const cache = createDiagnosticsCache();
  cache.absorb(WS_A, { uri: "file:///a/One.java", diagnostics: [diagnostic("một")] });
  cache.absorb(WS_A, { uri: "file:///a/Two.java", diagnostics: [] });
  cache.absorb(WS_B, { uri: "file:///b/Three.java", diagnostics: [diagnostic("ba")] });

  assert.deepEqual(
    cache.list(WS_A).map((entry) => entry.uri).sort(),
    ["file:///a/One.java", "file:///a/Two.java"],
  );
  assert.deepEqual(cache.list(WS_B).map((entry) => entry.uri), ["file:///b/Three.java"]);
});

// Ghim chuỗi trên dây theo LSP 3.17, không qua hằng số của chính module đang bị phán xét.
test("cache đăng ký đúng notification 'textDocument/publishDiagnostics' của LSP", () => {
  const cache = createDiagnosticsCache();
  const source = new RecordingSource();

  cache.attach(WS_A, source);

  assert.equal(source.registrations.length, 1);
  assert.equal(source.registrations[0]?.method, "textDocument/publishDiagnostics");
  assert.equal(PUBLISH_DIAGNOSTICS_METHOD, "textDocument/publishDiagnostics");
});

// Spike B: diagnostics tới không được yêu cầu, cho cả tệp chưa từng didOpen.
test("diagnostics đẩy về qua notification cho tệp CHƯA TỪNG didOpen vẫn vào cache của đúng workspace", () => {
  const cache = createDiagnosticsCache();
  const sourceA = new RecordingSource();
  const sourceB = new RecordingSource();
  cache.attach(WS_A, sourceA);
  cache.attach(WS_B, sourceB);

  // Không có bất kỳ lời gọi mở tệp nào trước đó; JDT LS của workspace B tự đẩy về.
  sourceB.publish("textDocument/publishDiagnostics", {
    uri: BROKEN,
    diagnostics: [diagnostic("Type mismatch: cannot convert from String to int", 4)],
  });

  const fromB = cache.get(WS_B, BROKEN);
  assert.equal(fromB.reported, true);
  assert.deepEqual(fromB.reported ? fromB.diagnostics.map((item) => item.message) : [], [
    "Type mismatch: cannot convert from String to int",
  ]);
  assert.equal(cache.get(WS_A, BROKEN).reported, false, "instance của workspace A không hề báo cáo URI này");

  // Và lần đẩy tiếp theo qua đúng đường dây đó cũng phải thay thế hoàn toàn (INV-DIAG-2).
  sourceB.publish("textDocument/publishDiagnostics", { uri: BROKEN, diagnostics: [] });
  const cleared = cache.get(WS_B, BROKEN);
  assert.equal(cleared.reported, true);
  assert.equal(cleared.reported ? cleared.diagnostics.length : -1, 0);
});

test("notification của method khác không bao giờ chạm vào cache", () => {
  const cache = createDiagnosticsCache();
  const source = new RecordingSource();
  cache.attach(WS_A, source);

  source.publish("language/status", { uri: BROKEN, diagnostics: [diagnostic("không được lưu")] });

  assert.equal(cache.get(WS_A, BROKEN).reported, false);
});

test("sau khi gỡ đăng ký, notification tới sau không còn sửa được cache", () => {
  const cache = createDiagnosticsCache();
  const source = new RecordingSource();
  const detach = cache.attach(WS_A, source);
  source.publish("textDocument/publishDiagnostics", { uri: BROKEN, diagnostics: [diagnostic("bản duy nhất")] });

  detach();
  source.publish("textDocument/publishDiagnostics", { uri: BROKEN, diagnostics: [diagnostic("tới sau khi gỡ")] });

  const lookup = cache.get(WS_A, BROKEN);
  assert.deepEqual(lookup.reported ? lookup.diagnostics.map((item) => item.message) : [], ["bản duy nhất"]);
});

// Cơ chế chịu lực của "thay thế hoàn toàn": cache giữ bản sao riêng, và bản trả ra bị đóng băng.
test("cache không chia sẻ mảng với người gọi: sửa payload gốc hay bản đọc ra đều không đổi được cache", () => {
  const cache = createDiagnosticsCache();
  const payload = [diagnostic("bản gốc")];
  cache.absorb(WS_A, { uri: BROKEN, diagnostics: payload });

  payload.push(diagnostic("chèn thêm sau khi absorb"));
  payload[0]!.message = "bị sửa sau khi absorb";

  const first = cache.get(WS_A, BROKEN);
  assert.equal(first.reported, true);
  assert.deepEqual(first.reported ? first.diagnostics.map((item) => item.message) : [], ["bản gốc"]);

  const stored = first.reported ? first.diagnostics : [];
  assert.equal(Object.isFrozen(stored), true, "mảng đọc ra phải đóng băng để không ai cộng dồn vào cache");
  assert.throws(() => {
    (stored as Diagnostic[]).push(diagnostic("cộng dồn qua bản đọc ra"));
  });

  const second = cache.get(WS_A, BROKEN);
  assert.equal(second.reported ? second.diagnostics.length : -1, 1);
});

test("payload không đúng dạng bị bỏ qua và không tạo ra mục cache giả", () => {
  const cache = createDiagnosticsCache();

  assert.equal(cache.absorb(WS_A, null), false);
  assert.equal(cache.absorb(WS_A, { uri: BROKEN }), false, "thiếu mảng diagnostics");
  assert.equal(cache.absorb(WS_A, { uri: BROKEN, diagnostics: "nhiều lỗi" }), false);
  assert.equal(cache.absorb(WS_A, { diagnostics: [] }), false, "thiếu uri");

  assert.equal(cache.get(WS_A, BROKEN).reported, false);
  assert.equal(cache.list(WS_A).length, 0);
});

test("payload hỏng không được xoá mất bản báo cáo hợp lệ đang có", () => {
  const cache = createDiagnosticsCache();
  cache.absorb(WS_A, { uri: BROKEN, diagnostics: [diagnostic("vẫn còn giá trị")] });

  assert.equal(cache.absorb(WS_A, { uri: BROKEN, diagnostics: null }), false);

  const lookup = cache.get(WS_A, BROKEN);
  assert.deepEqual(lookup.reported ? lookup.diagnostics.map((item) => item.message) : [], ["vẫn còn giá trị"]);
});
