// Level-1 oracle for feat-tool-code-actions (java_code_actions).
//
// Falsifier: "expose JDT LS's opaque `data` blob (or pack it into) `actionId` instead of retaining
// it server-side and minting an opaque handle [INV-CA-2]".
//
// Measurement: a fake facade returns unresolved actions with distinctive `data`; the oracle asserts
// that results contain only `title` and an opaque `actionId`, no `data`, and that actionId is a
// store-generated string rather than an internal blob.

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

test("every action receives an opaque actionId and the data blob never escapes", { timeout: CASE_TIMEOUT }, async () => {
  const store: CodeActionStore = createCodeActionStore();
  const { facade, requests } = makeFacade();

  const outcome = await javaCodeActions(facade, store, 0, REQUEST);
  assert.equal(outcome.isError, false, `expected success, got ${JSON.stringify(outcome)}`);
  if (outcome.isError) throw new Error("unreachable");

  assert.equal(requests[0], CODE_ACTION_METHOD);
  assert.equal(outcome.value.actions.length, 2);
  assert.deepEqual(
    outcome.value.actions.map((a) => a.title),
    ["Organize imports", "Generate toString()"],
  );
  // actionId is an opaque store-generated string, without the blob.
  for (const action of outcome.value.actions) {
    assert.match(action.actionId, /^ca-\d+$/, "actionId must be an opaque handle, not a blob");
    assert.doesNotMatch(action.actionId, /opaque|blob/, "actionId must not pack internal data");
  }
  // The blob remains resolvable server-side (the store retains it) and is not exposed.
  assert.deepEqual(store.resolve("ws-demo", 0, outcome.value.actions[0]!.actionId), {
    ok: true,
    action: RAW_ACTIONS[0],
  });
});

test("an action without a title is skipped without corrupting the list", { timeout: CASE_TIMEOUT }, async () => {
  const store = createCodeActionStore();
  const { facade } = makeFacade({ actions: [{ data: { x: 1 } }, ...RAW_ACTIONS] });

  const outcome = await javaCodeActions(facade, store, 0, REQUEST);
  assert.equal(outcome.isError, false);
  if (outcome.isError) throw new Error("unreachable");
  assert.equal(outcome.value.actions.length, 2);
});

test("workspace not ready: named error and no LSP call", { timeout: CASE_TIMEOUT }, async () => {
  const store = createCodeActionStore();
  const { facade, requests } = makeFacade({ availability: { status: "not-ready", detail: "indexing" } });

  const outcome = await javaCodeActions(facade, store, 0, REQUEST);
  assert.equal(outcome.isError, true);
  if (!outcome.isError) throw new Error("unreachable");
  assert.equal(outcome.code, "not-ready");
  assert.equal(requests.length, 0);
});

test("workspace dies during the call: workspace-crashed", { timeout: CASE_TIMEOUT }, async () => {
  const store = createCodeActionStore();
  const { facade } = makeFacade({ rejectWith: new Error("socket closed") });

  const outcome = await javaCodeActions(facade, store, 0, REQUEST);
  assert.equal(outcome.isError, true);
  if (!outcome.isError) throw new Error("unreachable");
  assert.equal(outcome.code, "workspace-crashed");
});
