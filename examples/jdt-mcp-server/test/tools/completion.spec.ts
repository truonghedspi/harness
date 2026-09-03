// Level-1 oracle for feat-tool-completion.
//
// Falsifier under test: "a completion result from a large domain is returned UNTRUNCATED instead of
// with `truncated: true` and its true total [INV-TOOL-3]".
//
// Measurement: the fake facade generates an arbitrary number of completion items, so “over cap” is
// an exact constructed quantity rather than luck. The three boundaries—below cap, exactly cap, and
// above cap—are pinned separately because an off-by-one error appears only when all three are
// queried. The cap comes from options rather than being hard-coded (X-008 remains open), so the
// “changing cap changes truncation behavior” case is direct evidence for that policy.
//
// Position validation (INV-TOOL-5) and item shaping (INV-TOOL-1) belong to tool-layer and are
// proved by `tool-layer.spec.ts`; this file tests only the cap/truncation responsibility added by
// the thin wrapper.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_COMPLETION_CAP,
  javaCompletion,
  type JavaCompletionOptions,
  type JavaCompletionResult,
} from "../../src/tools/completion.ts";
import { COMPLETION_METHOD, type LspFacade, type ToolOutcome, type WorkspaceAvailability } from "../../src/tools/tool-layer.ts";

const CASE_TIMEOUT = 5_000;

const FIXTURE_LINES = [
  "package demo;", // LSP line 0
  "", // 1
  "public class Greeter {", // 2
  '  private final String prefix = "Hello 🚀";', // 3
  "  String grēet(String name) {", // 4
  "    return prefix + name;", // 5
  "  }", // 6
  "}", // 7
];
const FIXTURE = FIXTURE_LINES.join("\n");
const FIXTURE_PATH = "/tmp/demo/src/main/java/demo/Greeter.java";

/** Queried position: line 5, column 10 in the 1-based system—on token `grēet`. */
const REQUEST = { path: FIXTURE_PATH, line: 5, column: 10 };

interface RecordedRequest {
  method: string;
  params: unknown;
}

interface FakeFacadeOptions {
  availability?: WorkspaceAvailability;
  content?: string | undefined;
  completions?: unknown;
  rejectWith?: Error;
}

function makeFacade(options: FakeFacadeOptions = {}): {
  facade: LspFacade;
  requests: RecordedRequest[];
} {
  const requests: RecordedRequest[] = [];
  const facade: LspFacade = {
    workspace: () => options.availability ?? { status: "ready", workspaceId: "ws-demo" },
    readFile: () => ("content" in options ? options.content : FIXTURE),
    request: async (method: string, params: unknown) => {
      requests.push({ method, params });
      if (options.rejectWith !== undefined) throw options.rejectWith;
      return options.completions ?? [];
    },
  };
  return { facade, requests };
}

/**
 * `count` fake completion items, each with a distinct `range` on the same line, so each item's
 * identity is readable from its coordinates—the over-cap case asserts EXACTLY which items remain.
 */
function makeItems(count: number): unknown[] {
  return Array.from({ length: count }, (_unused, index) => ({
    label: `item-${index}`,
    detail: `detail-${index}`,
    range: {
      start: { line: 0, character: index },
      end: { line: 0, character: index + 4 },
    },
  }));
}

function expectSuccess(outcome: ToolOutcome<JavaCompletionResult>): JavaCompletionResult {
  assert.equal(outcome.isError, false, `expected a successful result, got: ${JSON.stringify(outcome)}`);
  if (outcome.isError) throw new Error("unreachable");
  return outcome.value;
}

async function callWith(completions: unknown, options?: JavaCompletionOptions): Promise<JavaCompletionResult> {
  const { facade } = makeFacade({ completions });
  return expectSuccess(await javaCompletion(facade, REQUEST, options));
}

// -------------------------------------------------------------------------------------------
// INV-TOOL-3 — three boundaries around the cap
// -------------------------------------------------------------------------------------------

test("below cap: every item is returned, truncated is false, and total is exact", { timeout: CASE_TIMEOUT }, async () => {
  const answer = await callWith(makeItems(3), { cap: 5 });

  assert.equal(answer.items.length, 3);
  assert.equal(answer.truncated, false);
  assert.equal(answer.total, 3);
  assert.equal(answer.cap, 5);

  // Published coordinates are 1-based: LSP range line 0 column 0 must become line 1 column 1.
  assert.deepEqual(answer.items[0], {
    label: "item-0",
    detail: "detail-0",
    range: { start: { line: 1, column: 1 }, end: { line: 1, column: 5 } },
  });
  assert.deepEqual(answer.items[2]?.range.start, { line: 1, column: 3 });
  // The queried position is also echoed in the same 1-based system.
  assert.deepEqual(answer.position, { line: 5, column: 10 });
});

test(
  "OVER cap: the result has exactly cap items, truncated is true, and total is the TRUE pre-truncation count",
  { timeout: CASE_TIMEOUT },
  async () => {
    const answer = await callWith(makeItems(250));

    assert.equal(answer.cap, DEFAULT_COMPLETION_CAP);
    assert.equal(answer.items.length, DEFAULT_COMPLETION_CAP, "an over-cap list must not leave the tool with more than cap items");
    assert.equal(answer.truncated, true, "a truncated result must declare that it was truncated");
    assert.equal(answer.total, 250, "total must be the true pre-truncation count, not the remaining item count");
    assert.notEqual(answer.total, answer.items.length);

    // The retained section is the prefix in the exact order returned by LSP.
    assert.equal(answer.items[0]?.label, "item-0");
    assert.equal(answer.items[DEFAULT_COMPLETION_CAP - 1]?.label, `item-${DEFAULT_COMPLETION_CAP - 1}`);
  },
);

test("at cap: no off-by-one—exactly cap is not truncated", { timeout: CASE_TIMEOUT }, async () => {
  const answer = await callWith(makeItems(7), { cap: 7 });

  assert.equal(answer.items.length, 7);
  assert.equal(answer.truncated, false, "exactly at cap fits; it is not over cap");
  assert.equal(answer.total, 7);

  const overByOne = await callWith(makeItems(8), { cap: 7 });
  assert.equal(overByOne.items.length, 7);
  assert.equal(overByOne.truncated, true);
  assert.equal(overByOne.total, 8);
});

test("cap comes FROM configuration: changing cap changes truncation for the same LSP response", { timeout: CASE_TIMEOUT }, async () => {
  const completions = makeItems(250);

  const tight = await callWith(completions, { cap: 10 });
  assert.equal(tight.cap, 10);
  assert.equal(tight.items.length, 10);
  assert.equal(tight.truncated, true);
  assert.equal(tight.total, 250);

  const wide = await callWith(completions, { cap: 300 });
  assert.equal(wide.cap, 300);
  assert.equal(wide.items.length, 250);
  assert.equal(wide.truncated, false);
  assert.equal(wide.total, 250);
});

// -------------------------------------------------------------------------------------------
// LSP call shape and response shape
// -------------------------------------------------------------------------------------------

test("the call emits textDocument/completion with a position lowered to 0-based", { timeout: CASE_TIMEOUT }, async () => {
  const { facade, requests } = makeFacade({ completions: makeItems(2) });
  expectSuccess(await javaCompletion(facade, REQUEST));

  assert.equal(requests.length, 1);
  assert.equal(requests[0]?.method, COMPLETION_METHOD);
  assert.deepEqual(requests[0]?.params, {
    textDocument: { uri: FIXTURE_PATH },
    position: { line: 4, character: 9 },
  });
});

test("an LSP CompletionList { items: [...] } response is also shaped correctly", { timeout: CASE_TIMEOUT }, async () => {
  const answer = await callWith({ items: makeItems(2) }, { cap: 5 });

  assert.equal(answer.items.length, 2);
  assert.equal(answer.items[0]?.label, "item-0");
});

test("an item without a readable label is skipped without corrupting the list", { timeout: CASE_TIMEOUT }, async () => {
  const answer = await callWith([{ range: { start: { line: 0, character: 0 }, end: { line: 0, character: 4 } } }, ...makeItems(2)], { cap: 5 });

  assert.equal(answer.total, 2);
  assert.equal(answer.items[0]?.label, "item-0");
});

// -------------------------------------------------------------------------------------------
// X-003 taxonomy / INV-TOOL-4 — no failure becomes a successful empty list
// -------------------------------------------------------------------------------------------

test("workspace not ready: named error and LSP is never called", { timeout: CASE_TIMEOUT }, async () => {
  const { facade, requests } = makeFacade({
    availability: { status: "not-ready", detail: "indexing 40%", progress: { percent: 40 } },
    completions: makeItems(3),
  });

  const outcome = await javaCompletion(facade, REQUEST);
  assert.equal(outcome.isError, true);
  if (!outcome.isError) throw new Error("unreachable");
  assert.equal(outcome.code, "not-ready");
  assert.match(outcome.message, /^not-ready: /);
  assert.equal(requests.length, 0, "no request may be emitted while the workspace is unavailable");
  assert.equal("value" in outcome, false, "an error envelope never carries a value");
});

test("a resyncing workspace is reported by its proper name", { timeout: CASE_TIMEOUT }, async () => {
  const { facade } = makeFacade({ availability: { status: "resyncing", detail: "pom.xml changed" } });

  const outcome = await javaCompletion(facade, REQUEST);
  assert.equal(outcome.isError, true);
  if (!outcome.isError) throw new Error("unreachable");
  assert.equal(outcome.code, "resyncing");
});

test("line/column outside file bounds is rejected BEFORE the LSP call (INV-TOOL-5)", { timeout: CASE_TIMEOUT }, async () => {
  const { facade, requests } = makeFacade({ completions: makeItems(3) });

  const outcome = await javaCompletion(facade, { path: FIXTURE_PATH, line: 999, column: 1 });
  assert.equal(outcome.isError, true);
  if (!outcome.isError) throw new Error("unreachable");
  assert.equal(outcome.code, "invalid-position");
  assert.equal(requests.length, 0);
});

test("unreadable file content: unroutable, not an empty list", { timeout: CASE_TIMEOUT }, async () => {
  const { facade, requests } = makeFacade({ content: undefined, completions: makeItems(3) });

  const outcome = await javaCompletion(facade, REQUEST);
  assert.equal(outcome.isError, true);
  if (!outcome.isError) throw new Error("unreachable");
  assert.equal(outcome.code, "unroutable");
  assert.equal(requests.length, 0);
});

test("workspace dies during the call: workspace-crashed", { timeout: CASE_TIMEOUT }, async () => {
  const { facade } = makeFacade({ rejectWith: new Error("socket closed") });

  const outcome = await javaCompletion(facade, REQUEST);
  assert.equal(outcome.isError, true);
  if (!outcome.isError) throw new Error("unreachable");
  assert.equal(outcome.code, "workspace-crashed");
  assert.match(outcome.message, /socket closed/);
});

test("no completion items is a valid successful empty result, not an error", { timeout: CASE_TIMEOUT }, async () => {
  const answer = await callWith([]);

  assert.deepEqual(answer.items, []);
  assert.equal(answer.truncated, false);
  assert.equal(answer.total, 0);
  assert.equal(answer.workspaceId, "ws-demo");
});
