// Oracle mức 1 cho feat-tool-apply-code-action (java_apply_code_action) + code-action-store.
//
// Falsifier: "giải một actionId dựa trên mã nguồn đã đổi từ khi đúc handle thay vì lỗi [INV-CA-1]".
//
// Cách đo: store đúc handle trói vào generation; oracle khẳng định resolve ở đúng generation trả về
// edit, resolve ở generation KHÁC trả về lỗi `resyncing`, và actionId không tồn tại trả về
// `unroutable` — không bao giờ âm thầm trả edit stale hay edit của action khác (INV-CA-2).

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { CODE_ACTION_RESOLVE_METHOD, javaApplyCodeAction } from "../../src/tools/apply-code-action.ts";
import { createCodeActionStore, type CodeActionStore } from "../../src/tools/code-action-store.ts";
import type { LspFacade } from "../../src/tools/tool-layer.ts";

const CASE_TIMEOUT = 5_000;

const CONTENT = "public class Greeter {\n    String greet() { return \"hi\"; }\n}\n";

interface Fixture {
  root: string;
  file: string;
  uri: string;
}

function makeFixture(): Fixture {
  const root = mkdtempSync(path.join(tmpdir(), "applyca-"));
  const file = path.join(root, "Greeter.java");
  writeFileSync(file, CONTENT, "utf8");
  return { root, file, uri: pathToFileURL(file).href };
}

/** WorkspaceEdit đổi `greet` -> `salute` trong tệp. */
function makeWorkspaceEdit(uri: string): unknown {
  return {
    changes: {
      [uri]: [{ range: { start: { line: 1, character: 11 }, end: { line: 1, character: 16 } }, newText: "salute" }],
    },
  };
}

function makeFacade(resolveResult: unknown, rejectWith?: Error): { facade: LspFacade; requests: string[] } {
  const requests: string[] = [];
  const facade: LspFacade = {
    workspace: () => ({ status: "ready", workspaceId: "ws-demo" }),
    readFile: () => CONTENT,
    request: async (method: string) => {
      requests.push(method);
      if (rejectWith !== undefined) throw rejectWith;
      return resolveResult;
    },
  };
  return { facade, requests };
}

test("resolve đúng generation trả về edit qua codeAction/resolve", { timeout: CASE_TIMEOUT }, async () => {
  const fixture = makeFixture();
  const store: CodeActionStore = createCodeActionStore();
  const actionId = store.mint("ws-demo", 0, { title: "Rename", data: { opaque: true } });
  const { facade, requests } = makeFacade(makeWorkspaceEdit(fixture.uri));

  const outcome = await javaApplyCodeAction(facade, store, "ws-demo", 0, { actionId });
  assert.equal(outcome.isError, false, `mong đợi thành công, nhận ${JSON.stringify(outcome)}`);
  if (outcome.isError) throw new Error("unreachable");

  assert.equal(requests[0], CODE_ACTION_RESOLVE_METHOD);
  assert.equal(outcome.value.applied, false);
  assert.equal(outcome.value.files.length, 1);
  assert.equal(outcome.value.files[0]?.path, fixture.file);
  assert.deepEqual(outcome.value.files[0]?.edits[0], {
    range: { start: { line: 2, column: 12 }, end: { line: 2, column: 17 } },
    newText: "salute",
  });
  // no-apply: không ghi đĩa.
  assert.equal(readFileSync(fixture.file, "utf8"), CONTENT);

  rmSync(fixture.root, { recursive: true, force: true });
});

test("generation đổi sau khi đúc: resolve trả lỗi resyncing, không bao giờ trả edit stale", { timeout: CASE_TIMEOUT }, async () => {
  const fixture = makeFixture();
  const store = createCodeActionStore();
  const actionId = store.mint("ws-demo", 0, { data: { opaque: true } });
  const { facade, requests } = makeFacade(makeWorkspaceEdit(fixture.uri));

  const outcome = await javaApplyCodeAction(facade, store, "ws-demo", 1, { actionId });
  assert.equal(outcome.isError, true);
  if (!outcome.isError) throw new Error("unreachable");
  assert.equal(outcome.code, "resyncing", "handle đúc ở generation 0 không được giải ở generation 1");
  assert.equal(requests.length, 0, "không được gọi codeAction/resolve khi handle đã hết hạn");

  rmSync(fixture.root, { recursive: true, force: true });
});

test("actionId không tồn tại: lỗi unroutable", { timeout: CASE_TIMEOUT }, async () => {
  const fixture = makeFixture();
  const store = createCodeActionStore();
  const { facade } = makeFacade(makeWorkspaceEdit(fixture.uri));

  const outcome = await javaApplyCodeAction(facade, store, "ws-demo", 0, { actionId: "ca-999" });
  assert.equal(outcome.isError, true);
  if (!outcome.isError) throw new Error("unreachable");
  assert.equal(outcome.code, "unroutable");

  rmSync(fixture.root, { recursive: true, force: true });
});

test("apply:true ghi edit xuống đĩa", { timeout: CASE_TIMEOUT }, async () => {
  const fixture = makeFixture();
  const store = createCodeActionStore();
  const actionId = store.mint("ws-demo", 0, { data: { opaque: true } });
  const { facade } = makeFacade(makeWorkspaceEdit(fixture.uri));

  const outcome = await javaApplyCodeAction(facade, store, "ws-demo", 0, { actionId, apply: true });
  assert.equal(outcome.isError, false);
  if (outcome.isError) throw new Error("unreachable");
  assert.equal(outcome.value.applied, true);
  assert.equal(
    readFileSync(fixture.file, "utf8"),
    "public class Greeter {\n    String salute() { return \"hi\"; }\n}\n",
    "apply:true phải ghi đúng edit",
  );

  rmSync(fixture.root, { recursive: true, force: true });
});

test("handle không bao giờ giải nhầm sang action khác (INV-CA-2)", { timeout: CASE_TIMEOUT }, async () => {
  const store = createCodeActionStore();
  const first = store.mint("ws-demo", 0, { title: "first", data: { n: 1 } });
  const second = store.mint("ws-demo", 0, { title: "second", data: { n: 2 } });

  assert.deepEqual(store.resolve("ws-demo", 0, first), { ok: true, action: { title: "first", data: { n: 1 } } });
  assert.deepEqual(store.resolve("ws-demo", 0, second), { ok: true, action: { title: "second", data: { n: 2 } } });
  // Một handle đúc cho workspace khác không giải được ở workspace này (cùng một store, khác workspace).
  const foreign = store.mint("ws-other", 0, { title: "foreign", data: {} });
  assert.deepEqual(store.resolve("ws-demo", 0, foreign), { ok: false, reason: "unknown" });
});
