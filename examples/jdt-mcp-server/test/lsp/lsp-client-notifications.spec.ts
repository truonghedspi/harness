// Oracle cho feat-lsp-notifications: LspClient mang được thông điệp JSON-RPC không có `id` ở cả hai
// chiều. Hai vế của falsifier được ghim riêng biệt:
//   - vế nhận: một khung đến không có `id` phải tới handler đăng ký qua onNotification [INV-DIAG-1];
//   - vế gửi: notify() phải ghi khung không có `id` và không đụng vào bảng tương quan [INV-SYNC-2].
// Fixture tái dùng đúng lối của test/lsp/lsp-client.spec.ts (cặp PassThrough đóng vai stdout/stdin
// của tiến trình), nên khác biệt duy nhất giữa hai tệp là hành vi được phán xét.

import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { once } from "node:events";
import { PassThrough } from "node:stream";
import test from "node:test";

import { LspClient, type LspProcess } from "../../src/lsp/lsp-client.ts";

class FakeProcess extends EventEmitter implements LspProcess {
  readonly stdout = new PassThrough();
  readonly stdin = new PassThrough();
}

function frame(message: unknown): Buffer {
  const body = Buffer.from(JSON.stringify(message));
  return Buffer.concat([Buffer.from(`Content-Length: ${body.byteLength}\r\n\r\n`), body]);
}

/** Đọc đúng một khung đã ghi ra stdin, kiểm tra header khớp độ dài thân. */
async function nextFrame(stream: PassThrough): Promise<Record<string, unknown>> {
  if (stream.readableLength === 0) await once(stream, "readable");
  const wire = Buffer.from(stream.read() as Buffer);
  const separator = wire.indexOf("\r\n\r\n");
  assert.notEqual(separator, -1, "expected a complete LSP header");
  const header = wire.subarray(0, separator).toString();
  const length = Number.parseInt(header.match(/^Content-Length: (\d+)$/m)?.[1] ?? "", 10);
  const body = wire.subarray(separator + 4);
  assert.equal(body.byteLength, length, "expected one complete LSP body");
  return JSON.parse(body.toString()) as Record<string, unknown>;
}

/** Nhường một vòng event loop để dòng stdout được tiêu thụ hết trước khi khẳng định. */
function flush(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

test("notify writes a Content-Length frame that carries no id", { timeout: 1_000 }, async () => {
  const child = new FakeProcess();
  const client = new LspClient(child);

  await client.notify("workspace/didChangeWatchedFiles", { changes: [{ uri: "file:///A.java", type: 2 }] });

  const wire = await nextFrame(child.stdin);
  assert.equal(
    Object.hasOwn(wire, "id"),
    false,
    "a notification carrying an id is a request JDT LS will try to answer",
  );
  assert.deepEqual(wire, {
    jsonrpc: "2.0",
    method: "workspace/didChangeWatchedFiles",
    params: { changes: [{ uri: "file:///A.java", type: 2 }] },
  });
});

test(
  "notify leaves the request/response correlation table untouched",
  { timeout: 1_000 },
  async () => {
    const child = new FakeProcess();
    const client = new LspClient(child);

    const first = client.request("first", { value: 1 });
    assert.deepEqual(await nextFrame(child.stdin), {
      jsonrpc: "2.0",
      id: 1,
      method: "first",
      params: { value: 1 },
    });

    // Một notification xen giữa hai request: nó không được lấy số từ bộ đếm id, nên request kế tiếp
    // vẫn nhận id 2. Nếu notify() cấp phát id, id kế tiếp nhảy lên 3 và ô nó đặt vào bảng tương quan
    // không bao giờ được giải quyết.
    await client.notify("java/projectConfigurationUpdate", { uri: "file:///pom.xml" });
    const notificationWire = await nextFrame(child.stdin);

    const second = client.request("second", { value: 2 });
    assert.deepEqual(
      await nextFrame(child.stdin),
      { jsonrpc: "2.0", id: 2, method: "second", params: { value: 2 } },
      "the notification consumed an id, so the request after it correlates against the wrong slot",
    );
    assert.equal(Object.hasOwn(notificationWire, "id"), false);

    child.stdout.write(frame({ jsonrpc: "2.0", id: 1, result: "one" }));
    child.stdout.write(frame({ jsonrpc: "2.0", id: 2, result: "two" }));
    assert.deepEqual(await Promise.all([first, second]), ["one", "two"]);
  },
);

test(
  "an inbound frame without an id reaches the handler registered for its method",
  { timeout: 1_000 },
  async () => {
    const child = new FakeProcess();
    const client = new LspClient(child);
    const seen: unknown[] = [];
    client.onNotification("textDocument/publishDiagnostics", (params) => {
      seen.push(params);
    });

    const params = {
      uri: "file:///Broken.java",
      version: 3,
      diagnostics: [{ message: "cannot find symbol", severity: 1 }],
    };
    child.stdout.write(frame({ jsonrpc: "2.0", method: "textDocument/publishDiagnostics", params }));
    await flush();

    assert.deepEqual(seen, [params], "the notification was dropped instead of dispatched");
  },
);

test("a notification for another method leaves the handler untouched", { timeout: 1_000 }, async () => {
  const child = new FakeProcess();
  const client = new LspClient(child);
  const seen: unknown[] = [];
  client.onNotification("textDocument/publishDiagnostics", (params) => {
    seen.push(params);
  });

  child.stdout.write(frame({ jsonrpc: "2.0", method: "language/status", params: { type: "Started" } }));
  await flush();

  assert.deepEqual(seen, [], "dispatch ignored the method and fired every handler");
});

test("every handler registered for one method is called, none overwritten", { timeout: 1_000 }, async () => {
  const child = new FakeProcess();
  const client = new LspClient(child);
  const calls: string[] = [];
  client.onNotification("textDocument/publishDiagnostics", () => calls.push("first"));
  client.onNotification("textDocument/publishDiagnostics", () => calls.push("second"));
  client.onNotification("textDocument/publishDiagnostics", () => calls.push("third"));

  child.stdout.write(
    frame({
      jsonrpc: "2.0",
      method: "textDocument/publishDiagnostics",
      params: { uri: "file:///A.java", diagnostics: [] },
    }),
  );
  await flush();

  // DiagnosticsCache.attach() gọi onNotification mỗi lần được gọi và không có đường gỡ đăng ký ở
  // phía nguồn; nếu đăng ký ghi đè theo method thì subscriber trước bị huỷ im lặng.
  assert.deepEqual(calls, ["first", "second", "third"]);
});

test(
  "a notification with no subscriber is dropped without killing the reader",
  { timeout: 1_000 },
  async () => {
    const child = new FakeProcess();
    const client = new LspClient(child);
    const pending = client.request("survives");
    await nextFrame(child.stdin);

    child.stdout.write(frame({ jsonrpc: "2.0", method: "language/status", params: { type: "Starting" } }));
    await flush();
    child.stdout.write(frame({ jsonrpc: "2.0", id: 1, result: "still alive" }));

    assert.equal(await pending, "still alive");
  },
);

test("a throwing handler stops neither its siblings nor the reader", { timeout: 1_000 }, async () => {
  const child = new FakeProcess();
  const client = new LspClient(child);
  const calls: string[] = [];
  client.onNotification("language/status", () => {
    calls.push("before");
    throw new Error("subscriber is defective");
  });
  client.onNotification("language/status", () => calls.push("after"));

  const pending = client.request("survives");
  await nextFrame(child.stdin);
  child.stdout.write(frame({ jsonrpc: "2.0", method: "language/status", params: {} }));
  await flush();
  child.stdout.write(frame({ jsonrpc: "2.0", id: 1, result: "still alive" }));

  assert.deepEqual(calls, ["before", "after"]);
  assert.equal(await pending, "still alive");
});

test(
  "request/response and server-initiated requests keep working alongside notifications",
  { timeout: 1_000 },
  async () => {
    const child = new FakeProcess();
    const client = new LspClient(child);
    client.onRequest("workspace/configuration", async () => [{ java: true }]);
    client.onNotification("workspace/configuration", () => {
      assert.fail("a server request carrying an id must not be routed to notification handlers");
    });

    // Request server→client: có method VÀ có id, phải được trả lời như trước.
    child.stdout.write(
      frame({ jsonrpc: "2.0", id: 41, method: "workspace/configuration", params: {} }),
    );
    assert.deepEqual(await nextFrame(child.stdin), { jsonrpc: "2.0", id: 41, result: [{ java: true }] });

    // Request client→server vẫn tương quan theo id như trước.
    const pending = client.request("java/buildWorkspace");
    assert.deepEqual(await nextFrame(child.stdin), {
      jsonrpc: "2.0",
      id: 1,
      method: "java/buildWorkspace",
    });
    child.stdout.write(frame({ jsonrpc: "2.0", id: 1, result: { status: 1 } }));
    assert.deepEqual(await pending, { status: 1 });
  },
);

test(
  "the function returned by onNotification really unsubscribes that handler",
  { timeout: 1_000 },
  async () => {
    const child = new FakeProcess();
    const client = new LspClient(child);
    let calls = 0;
    const unsubscribe = client.onNotification("textDocument/publishDiagnostics", () => {
      calls += 1;
    });

    const notification = frame({
      jsonrpc: "2.0",
      method: "textDocument/publishDiagnostics",
      params: { uri: "file:///A.java", diagnostics: [] },
    });

    // Khung đầu tiên chứng minh handler thật sự được nối vào dispatch, nên số 0 ở khẳng định cuối
    // là hệ quả của việc gỡ đăng ký chứ không phải của một handler chưa bao giờ chạy.
    child.stdout.write(notification);
    await flush();
    assert.equal(calls, 1, "the handler was never wired, so this case cannot judge unsubscribing");

    unsubscribe();
    child.stdout.write(notification);
    await flush();

    // Pool gỡ workspace bằng đúng hàm này. Nếu nó là một no-op, subscriber của workspace đã bị evict
    // vẫn nhận diagnostics của phiên sau.
    assert.equal(calls, 1, "the unsubscribe function did nothing: the handler still receives frames");
  },
);

test(
  "a handler unsubscribing itself mid-dispatch does not make its siblings be skipped",
  { timeout: 1_000 },
  async () => {
    const child = new FakeProcess();
    const client = new LspClient(child);
    const calls: string[] = [];

    // Handler thứ nhất gỡ đăng ký của CHÍNH nó ngay trong thân callback, tức là trong lúc vòng
    // dispatch đang chạy. Nếu vòng lặp duyệt thẳng mảng gốc thay vì một ảnh chụp, lệnh splice làm
    // mảng dịch chỉ số và handler kế tiếp bị bỏ qua im lặng.
    const unsubscribeFirst = client.onNotification("language/status", () => {
      calls.push("first");
      unsubscribeFirst();
    });
    client.onNotification("language/status", () => calls.push("second"));
    client.onNotification("language/status", () => calls.push("third"));

    child.stdout.write(frame({ jsonrpc: "2.0", method: "language/status", params: { type: "Started" } }));
    await flush();

    assert.deepEqual(
      calls,
      ["first", "second", "third"],
      "a sibling was skipped: the frame did not reach every handler registered for its method",
    );

    // Khung thứ hai chốt vế còn lại: handler đã tự gỡ không được gọi lại, hai handler kia thì có.
    child.stdout.write(frame({ jsonrpc: "2.0", method: "language/status", params: { type: "Ready" } }));
    await flush();

    assert.deepEqual(calls, ["first", "second", "third", "second", "third"]);
  },
);

test("notify refuses to write once the process has exited", { timeout: 1_000 }, async () => {
  const child = new FakeProcess();
  const client = new LspClient(child);
  child.emit("exit", 137, null);

  await assert.rejects(
    async () => client.notify("workspace/didChangeWatchedFiles", { changes: [] }),
    /JDT LS process exited.*137/,
  );
});
