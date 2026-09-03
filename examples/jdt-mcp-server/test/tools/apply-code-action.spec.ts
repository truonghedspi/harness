// Level-1 oracle for feat-tool-apply-code-action (java_apply_code_action) and code-action-store.
//
// Falsifier: "resolve an actionId against source changed since the handle was minted instead of failing [INV-CA-1]".
//
// Measurement: the store mints a generation-bound handle; the oracle asserts resolution at the same
// generation returns an edit, resolution at a DIFFERENT generation returns `resyncing`, and a missing
// actionId returns `unroutable`—never silently returning a stale edit or another action's edit (INV-CA-2).

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

/** A WorkspaceEdit that changes `greet` to `salute` in the file. */
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

test("resolution at the same generation returns an edit through codeAction/resolve", { timeout: CASE_TIMEOUT }, async () => {
  const fixture = makeFixture();
  const store: CodeActionStore = createCodeActionStore();
  const actionId = store.mint("ws-demo", 0, { title: "Rename", data: { opaque: true } });
  const { facade, requests } = makeFacade(makeWorkspaceEdit(fixture.uri));

  const outcome = await javaApplyCodeAction(facade, store, "ws-demo", 0, { actionId });
  assert.equal(outcome.isError, false, `expected success, got ${JSON.stringify(outcome)}`);
  if (outcome.isError) throw new Error("unreachable");

  assert.equal(requests[0], CODE_ACTION_RESOLVE_METHOD);
  assert.equal(outcome.value.applied, false);
  assert.equal(outcome.value.files.length, 1);
  assert.equal(outcome.value.files[0]?.path, fixture.file);
  assert.deepEqual(outcome.value.files[0]?.edits[0], {
    range: { start: { line: 2, column: 12 }, end: { line: 2, column: 17 } },
    newText: "salute",
  });
  // no-apply: does not write to disk.
  assert.equal(readFileSync(fixture.file, "utf8"), CONTENT);

  rmSync(fixture.root, { recursive: true, force: true });
});

test("generation changes after minting: resolution returns resyncing and never a stale edit", { timeout: CASE_TIMEOUT }, async () => {
  const fixture = makeFixture();
  const store = createCodeActionStore();
  const actionId = store.mint("ws-demo", 0, { data: { opaque: true } });
  const { facade, requests } = makeFacade(makeWorkspaceEdit(fixture.uri));

  const outcome = await javaApplyCodeAction(facade, store, "ws-demo", 1, { actionId });
  assert.equal(outcome.isError, true);
  if (!outcome.isError) throw new Error("unreachable");
  assert.equal(outcome.code, "resyncing", "a handle minted at generation 0 must not resolve at generation 1");
  assert.equal(requests.length, 0, "codeAction/resolve must not be called for an expired handle");

  rmSync(fixture.root, { recursive: true, force: true });
});

test("missing actionId: unroutable error", { timeout: CASE_TIMEOUT }, async () => {
  const fixture = makeFixture();
  const store = createCodeActionStore();
  const { facade } = makeFacade(makeWorkspaceEdit(fixture.uri));

  const outcome = await javaApplyCodeAction(facade, store, "ws-demo", 0, { actionId: "ca-999" });
  assert.equal(outcome.isError, true);
  if (!outcome.isError) throw new Error("unreachable");
  assert.equal(outcome.code, "unroutable");

  rmSync(fixture.root, { recursive: true, force: true });
});

test("apply:true writes the edit to disk", { timeout: CASE_TIMEOUT }, async () => {
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
    "apply:true must write the exact edit",
  );

  rmSync(fixture.root, { recursive: true, force: true });
});

test("a handle never resolves to another action (INV-CA-2)", { timeout: CASE_TIMEOUT }, async () => {
  const store = createCodeActionStore();
  const first = store.mint("ws-demo", 0, { title: "first", data: { n: 1 } });
  const second = store.mint("ws-demo", 0, { title: "second", data: { n: 2 } });

  assert.deepEqual(store.resolve("ws-demo", 0, first), { ok: true, action: { title: "first", data: { n: 1 } } });
  assert.deepEqual(store.resolve("ws-demo", 0, second), { ok: true, action: { title: "second", data: { n: 2 } } });
  // A handle minted for another workspace cannot resolve in this workspace (same store, different workspace).
  const foreign = store.mint("ws-other", 0, { title: "foreign", data: {} });
  assert.deepEqual(store.resolve("ws-demo", 0, foreign), { ok: false, reason: "unknown" });
});
