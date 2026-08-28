// Oracle mức 1 cho feat-tool-code-actions (java_code_actions).
//
// Falsifier: "trao blob `data` mờ đục của JDT LS ra ngoài (hoặc nhét trong) `actionId` thay vì giữ
// phía server và đúc một handle mờ đục [INV-CA-2]".
//
// Cách đo: facade giả trả các action CHƯA giải mang `data` đặc trưng; oracle khẳng định kết quả chỉ
// chứa `title` + `actionId` mờ đục, không chứa `data`, và actionId là một chuỗi do store sinh ra chứ
// không phải blob nội bộ.

import { test } from "node:test";
import assert from "node:assert/strict";

import { CODE_ACTION_METHOD, javaCodeActions } from "../../src/tools/code-actions.ts";
import { createCodeActionStore, type CodeActionStore } from "../../src/tools/code-action-store.ts";
import type { LspFacade, WorkspaceAvailability } from "../../src/tools/tool-layer.ts";

const CASE_TIMEOUT = 5_000;

const FIXTURE = "package demo;\npublic class Greeter {\n    String greet() { return \"hi\"; }\n}\n";
const FIXTURE_PATH = "/tmp/demo/src/main/java/demo/Greeter.java";
const REQUEST = { path: FIXTURE_PATH, line: 3, column: 12 };

const RAW_ACTIONS = [
  { title: "Organize imports", data: { opaque: "blob-1" } },
  { title: "Generate toString()", data: { opaque: "blob-2" } },
];

interface FakeFacadeOptions {
  availability?: WorkspaceAvailability;
  actions?: unknown;
  rejectWith?: Error;
}

function makeFacade(options: FakeFacadeOptions = {}): { facade: LspFacade; requests: string[] } {
  const requests: string[] = [];
  const facade: LspFacade = {
    workspace: () => options.availability ?? { status: "ready", workspaceId: "ws-demo" },
    readFile: () => FIXTURE,
    request: async (method: string) => {
      requests.push(method);
      if (options.rejectWith !== undefined) throw options.rejectWith;
      return options.actions ?? RAW_ACTIONS;
    },
  };
  return { facade, requests };
}

test("mỗi action được đúc một actionId mờ đục, và blob data không bao giờ lọt ra ngoài", { timeout: CASE_TIMEOUT }, async () => {
  const store: CodeActionStore = createCodeActionStore();
  const { facade, requests } = makeFacade();

  const outcome = await javaCodeActions(facade, store, 0, REQUEST);
  assert.equal(outcome.isError, false, `mong đợi thành công, nhận ${JSON.stringify(outcome)}`);
  if (outcome.isError) throw new Error("unreachable");

  assert.equal(requests[0], CODE_ACTION_METHOD);
  assert.equal(outcome.value.actions.length, 2);
  assert.deepEqual(
    outcome.value.actions.map((a) => a.title),
    ["Organize imports", "Generate toString()"],
  );
  // actionId là chuỗi mờ đục do store sinh, không chứa blob.
  for (const action of outcome.value.actions) {
    assert.match(action.actionId, /^ca-\d+$/, "actionId phải là handle mờ đục, không phải blob");
    assert.doesNotMatch(action.actionId, /opaque|blob/, "actionId không được nhét dữ liệu nội bộ");
  }
  // Và blob vẫn giải được phía server (store giữ nó), không bị đưa ra ngoài.
  assert.deepEqual(store.resolve("ws-demo", 0, outcome.value.actions[0]!.actionId), {
    ok: true,
    action: RAW_ACTIONS[0],
  });
});

test("action không có title bị bỏ qua, không làm hỏng cả danh sách", { timeout: CASE_TIMEOUT }, async () => {
  const store = createCodeActionStore();
  const { facade } = makeFacade({ actions: [{ data: { x: 1 } }, ...RAW_ACTIONS] });

  const outcome = await javaCodeActions(facade, store, 0, REQUEST);
  assert.equal(outcome.isError, false);
  if (outcome.isError) throw new Error("unreachable");
  assert.equal(outcome.value.actions.length, 2);
});

test("workspace chưa sẵn sàng: lỗi có tên, LSP chưa bị gọi", { timeout: CASE_TIMEOUT }, async () => {
  const store = createCodeActionStore();
  const { facade, requests } = makeFacade({ availability: { status: "not-ready", detail: "indexing" } });

  const outcome = await javaCodeActions(facade, store, 0, REQUEST);
  assert.equal(outcome.isError, true);
  if (!outcome.isError) throw new Error("unreachable");
  assert.equal(outcome.code, "not-ready");
  assert.equal(requests.length, 0);
});

test("workspace chết giữa lời gọi: workspace-crashed", { timeout: CASE_TIMEOUT }, async () => {
  const store = createCodeActionStore();
  const { facade } = makeFacade({ rejectWith: new Error("socket closed") });

  const outcome = await javaCodeActions(facade, store, 0, REQUEST);
  assert.equal(outcome.isError, true);
  if (!outcome.isError) throw new Error("unreachable");
  assert.equal(outcome.code, "workspace-crashed");
});
