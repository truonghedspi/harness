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
  return Buffer.concat([
    Buffer.from(`Content-Length: ${body.byteLength}\r\n\r\n`),
    body,
  ]);
}

async function nextFrame(stream: PassThrough): Promise<unknown> {
  if (stream.readableLength === 0) await once(stream, "readable");
  const wire = Buffer.from(stream.read() as Buffer);
  const separator = wire.indexOf("\r\n\r\n");
  assert.notEqual(separator, -1, "expected a complete LSP header");
  const header = wire.subarray(0, separator).toString();
  const length = Number.parseInt(header.match(/^Content-Length: (\d+)$/m)?.[1] ?? "", 10);
  const body = wire.subarray(separator + 4);
  assert.equal(body.byteLength, length, "expected one complete LSP body");
  return JSON.parse(body.toString());
}

test("frames requests and correlates out-of-order responses by id", { timeout: 1_000 }, async () => {
  const child = new FakeProcess();
  const client = new LspClient(child);

  const first = client.request("first", { value: 1 });
  const firstWire = await nextFrame(child.stdin);
  const second = client.request("second", { value: 2 });
  const secondWire = await nextFrame(child.stdin);

  assert.deepEqual(firstWire, { jsonrpc: "2.0", id: 1, method: "first", params: { value: 1 } });
  assert.deepEqual(secondWire, { jsonrpc: "2.0", id: 2, method: "second", params: { value: 2 } });

  child.stdout.write(frame({ jsonrpc: "2.0", id: 2, result: "two" }));
  child.stdout.write(frame({ jsonrpc: "2.0", id: 1, result: "one" }));
  assert.deepEqual(await Promise.all([first, second]), ["one", "two"]);
});

test("parses a response split across chunks", { timeout: 1_000 }, async () => {
  const child = new FakeProcess();
  const client = new LspClient(child);
  const pending = client.request("split");
  const response = frame({ jsonrpc: "2.0", id: 1, result: { ok: true } });

  child.stdout.write(response.subarray(0, 9));
  child.stdout.write(response.subarray(9));

  assert.deepEqual(await pending, { ok: true });
});

test("answers server-initiated requests", { timeout: 1_000 }, async () => {
  const child = new FakeProcess();
  const client = new LspClient(child);
  client.onRequest("workspace/configuration", async () => [{ java: true }]);

  child.stdout.write(frame({ jsonrpc: "2.0", id: 41, method: "workspace/configuration", params: {} }));

  assert.deepEqual(await nextFrame(child.stdin), {
    jsonrpc: "2.0",
    id: 41,
    result: [{ java: true }],
  });
});

test("rejects every pending request immediately when the process exits", { timeout: 1_000 }, async () => {
  const child = new FakeProcess();
  const client = new LspClient(child);
  const first = client.request("one");
  const second = client.request("two");

  child.emit("exit", 137, null);

  await assert.rejects(first, /JDT LS process exited.*137/);
  await assert.rejects(second, /JDT LS process exited.*137/);
});
