// Traceability (harness/skills/test-design/SKILL.md, role: Test-Implementer).
//
// Conditions: TCON-TOOL-0001, TCON-TOOL-0002, TCON-TOOL-0003, TCON-TOOL-0004, TCON-TOOL-0005,
// TCON-TOOL-0006, TCON-TOOL-0007, TCON-TOOL-0008, TCON-TOOL-0009, TCON-TOOL-0010
// Requirements: INV-TOOL-1, INV-TOOL-3, INV-TOOL-4, INV-TOOL-5, INV-TOOL-6
// Plan: TP-TOOL-0001 | Feature: feat-prove-navigation-tools
//
// Level 3 integration test: `java_hover`, `java_definition` and `java_references` run through a
// REAL JDT LS process started by real per-workspace pool. There are no fake facades here; section
// the only file that builds itself is composition root — where project-router, workspace-pool,
// readiness-gate and file content on disk to `LspFacade` required by the tool layer. Product daemon
// there is no such place for wiring yet (feat-prove-cross-process-integration owns that), so
// composition root is in the test file and calls only the published interfaces of the four components.
//
// Ground truth of all coordinates is calculated from the fixture text ITSELF using the UTF-16 code unit's index
// JavaScript, then add 1 to convert to published system (X-007). There is no assertion that takes the value and sets it
// just returned as an expectation.
//
// Fixture intentionally makes counting difficult in two different ways, because of two different failure modes:
// * BMP line carries é ☕ ñ 日本語 ✓ ß — number of code units EQUAL to number of codepoints but SMALLER than number of UTF-8 bytes,
// so it captures byte counting and only byte counting (TCON-TOOL-0001);
// * astral line carries a sequence of astral-plane characters (each character is a surrogate pair) — code unit number
// LARGER THAN the codepoint number, so it captures additional codepoint counting that the BMP line cannot capture
// (TCON-TOOL-0002).
//
// Both lines must be FAR MORE THAN THE WIDTH OF THE TOKEN, and that is a condition of teeth, not one
// decorative details. The first fixture just puts two surrogate pairs before `counter`: equal counting
// The codepoint is then exactly two code units off, meaning it falls in the middle of a seven-character token, JDT LS still solves it
// output the correct symbol and all assertions are still green. Mutant "counting by codepoint" survives. So deviation// where each resulting line is explicitly stated to be GREATER THAN `SYMBOL.length` within the scan.
//
// Intentionally out of scope: `resyncing` and `workspace-crashed` of taxonomy X-003 belong to
// feat-prove-sync and feat-prove-pool-crash-handling (see spec_gaps of TP-TOOL-0001).
//
// About cleanup: all resources go through `cleanupStack`, not through `t.after` directly. The reason lies with you
// like that function — node:test's `after` hook runs in order of registration, so the writing is familiar
// (`t.after(rmSync)` then `t.after(pool.close)`) deletes the directory while the JVM is alive and suspends the test process.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { definition, type DefinitionAnswer } from "../../src/tools/definition.ts";
import { javaHover, type JavaHoverResult } from "../../src/tools/hover.ts";
import { references, type ReferencesAnswer } from "../../src/tools/references.ts";
import type {
  LspFacade,
  SourceRange,
  ToolOutcome,
  WorkspaceAvailability,
} from "../../src/tools/tool-layer.ts";
import { resolveWorkspace } from "../../src/workspace/project-router.ts";
import {
  createReadinessGate,
  WorkspaceNotReadyError,
  type ReadinessGate,
  type ReadinessTarget,
} from "../../src/workspace/readiness-gate.ts";
import { createWorkspacePool, type WorkspacePool } from "../../src/workspace/workspace-pool.ts";

// -------------------------------------------------------------------------------------------
// Time parameter. X-001 (budget deadline per call) is open, so all deadlines here are
// test parameters, not product constants.
// -------------------------------------------------------------------------------------------

/** Time limit for index to be ready for warm workspace. Cold start measures approximately 4 s on this fixture. */
const READY_DEADLINE_MS = Number.parseInt(process.env.JDT_READY_DEADLINE_MS ?? "120000", 10);
/** The waiting period for the not-ready case: short enough to be sure to fall while the index is being built. */const WARMING_DEADLINE_MS = Number.parseInt(process.env.JDT_WARMING_DEADLINE_MS ?? "100", 10);
const SWEEP_TIMEOUT_MS = 300_000;

const JDTLS_FIXTURE_HOME = path.resolve(".cache/jdtls-fixture/1.61.0.202607231254");

// -------------------------------------------------------------------------------------------
// Fixture the source. The line number in the comment is the 1-based line number that every assertion uses.
// -------------------------------------------------------------------------------------------

const FIXTURE_LINES = [
  /* 1 */ "package fixture;",
  /* 2 */ "",
  /* 3 */ "// a plain prose comment line, with no identifier to resolve",
  /* 4 */ "public class Nav {",
  /* 5 */ " int counter;",
  /* 6 */ "",
  /* 7 */ ' int bmpUse() { String bmp = "café ☕ ñ 日本語 ✓ ß"; return counter; }',
  /* 8 */ ' int astralUse() { String astral = "𝄞𝒜𝔸𝔹𝔻𝔼𝔽𝔾𝕀𝕁𝕂𝕃 cafe ☕ ñ 日本語 ✓ ß"; return counter; }',
  /* 9 */ " int useA() { return counter; }",
  /* 10 */ " int useB() { return counter + 1; }",
  /* 11 */ " int useC() { return counter * 2; }",
  /* 12 */ " void useD() { counter = 0; }",
  /* 13 */ " void useE() { counter += 1; }",
  /* 14 */ "}",
  /* 15 */ "",
];
const FIXTURE_SOURCE = FIXTURE_LINES.join("\n");

const SYMBOL = "counter";
const DECLARATION_LINE = 5;
const BMP_LINE = 7;
const ASTRAL_LINE = 8;
const COMMENT_LINE = 3;
const BLANK_LINE = 6;
/**
 * Plain ASCII anchor for two cap conditions. INV-TOOL-3 talks about list slicing, not permissions
 * coordinate conversion; Asking from a line with non-ASCII characters will cause a column count error to redden them as well
 * and we can no longer distinguish between the two invariants.
 */
const PLAIN_LINE = 9;

/** Text of a 1-based line; throws an error instead of returning `undefined` so the fixture doesn't quietly slip. */
function lineText(line: number): string {
  const text = FIXTURE_LINES[line - 1];
  assert.ok(text !== undefined, `fixture does not have ${line}`);
  return text;
}

/** 1-based column of `needle` on a line, counted in UTF-16 code units — the exact units announced by X-007. */
function columnOf(line: number, needle: string): number {
  const index = lineText(line).indexOf(needle);assert.ok(index >= 0, `fixture: "${needle}" not found on line ${line}`);
  return index + 1;
}

/** Range ground-truth of a `SYMBOL` occurrence starting at the given 1-based column. */
function symbolRangeAt(line: number, column: number): SourceRange {
  return {
    start: { line, column },
    end: { line, column: column + SYMBOL.length },
  };
}

function symbolRangeOn(line: number): SourceRange {
  return symbolRangeAt(line, columnOf(line, SYMBOL));
}

/**
 * Every occurrence of `counter` in the fixture EXCEPT the declaration itself — that is, the correct reference set
 * `java_references` must return when `includeDeclaration: false`. Read straight from the fixture text, so
 * it is the independent ground truth, not the value that the setting just generated.
 */
function expectedReferenceRanges(): SourceRange[] {
  const ranges: SourceRange[] = [];
  for (let line = 1; line <= FIXTURE_LINES.length; line += 1) {
    if (line === DECLARATION_LINE) continue;
    const pattern = new RegExp(`\\b${SYMBOL}\\b`, "g");
    for (const match of lineText(line).matchAll(pattern)) {
      ranges.push(symbolRangeAt(line, match.index + 1));
    }
  }
  return ranges;
}

function sortRanges(ranges: readonly SourceRange[]): SourceRange[] {
  return [...ranges].sort(
    (a, b) => a.start.line - b.start.line || a.start.column - b.start.column,
  );
}

// -------------------------------------------------------------------------------------------
// Stack cleanup
// -------------------------------------------------------------------------------------------

interfaceAfterRegistrar {
  after(fn: () => void | Promise<void>): void;
}

/** Registers a cleanup step. The steps run in REVERSE order of registration. */
type Cleanup = (step: () => void | Promise<void>) => void;

/**
 * `node:test` runs `after` hooks in the correct REGISTRATION ORDER (test directly on node 22).
 * Register `rmSync(root)` first and then `pool.close()` later thus deleting the directory while the JVM is alive: command
 * removes throwing errors, the JDT LS process survives and keeps stdio, and the test process itself never exits.
 *
 * This function reverses that order using a single stack. The test writer registers the correct steps* initialization sequence — directory first, pool second — and the stack unwinds in reverse. Every step
 * is wrapped separately, so a failed step does not block the remaining steps: a red assertion in the middle remains
 * A clean machine must be left behind.
 */
function cleanupStack(t: AfterRegistrar): Cleanup {
  const steps: Array<() => void | Promise<void>> = [];
  t.after(async () => {
    for (let index = steps.length - 1; index >= 0; index -= 1) {
      try {
        await steps[index]!();
      } catch {
        /* cleaning is the best-effort */
      }
    }
  });
  return (step) => {
    steps.push(step);
  };
}

// -------------------------------------------------------------------------------------------
// Composition root: project-router + workspace-pool + readiness-gate + file content on disk.
// -------------------------------------------------------------------------------------------

interface LiveHarness {
  facade: LspFacade;
  sourcePath: string;
  projectRoot: string;
  /** The number of LSP requests that actually left the tool layer via the facade — the basis of the INV-TOOL-5 assertion. */
  lspRequests(): number;
}

interface HarnessOptions {
  /** Readiness waiting period for each tool call. Ca not-ready uses a very short value. */
  readyDeadlineMs: number;
  /** Skip the step of waiting for the index to warm up during build, so that the tool is called while the workspace is still starting up. */
  warmUp: boolean;
}

/**
 * Build a live workspace: real Maven project on disk, real JDT LS process spawned by the pool,
 * real initialize handshake, real readiness-gate.
 *
 * Each resource is pushed into `cleanup` AS SOON as it exists, not after the function returns. If
 * handshake throws error midway, spawned pool remains closed; If you wait until you return to register
 * an orphaned JVM will keep the retest process going forever.
 */
async function startLiveWorkspace(
  root: string,
  name: string,
  options: HarnessOptions,
  cleanup: Cleanup,
): Promise<LiveHarness> {
  const projectRoot = path.join(root, name);
  const sourcePath = path.join(projectRoot, "src/main/java/fixture/Nav.java");
  mkdirSync(path.dirname(sourcePath), { recursive: true });
  writeFileSync(
    path.join(projectRoot, "pom.xml"),"<project><modelVersion>4.0.0</modelVersion><groupId>fixture</groupId>" +
      `<artifactId>${name}</artifactId><version>1</version></project>\n`,
  );
  writeFileSync(sourcePath, FIXTURE_SOURCE, "utf8");

  const pool: WorkspacePool = createWorkspacePool({
    cacheRoot: path.join(root, `cache-${name}`),
    maxWorkspaces: 3,
  });
  cleanup(() => pool.close());

  const targets = new Map<string, ReadinessTarget>();
  const gate: ReadinessGate = createReadinessGate({
    resolveTarget: (workspaceId) => targets.get(workspaceId),
  });
  cleanup(() => gate.close());

  const routed = resolveWorkspace(sourcePath);
  assert.ok(!("error" in routed), `fixture must be routable: ${JSON.stringify(routed)}`);
  const lease = await pool.acquire(routed.projectRoot);
  cleanup(() => lease.release());
  const client = lease.client;
  assert.ok(client, "pool must return the LspClient of the real JDT LS process");

  // Server→client half of the handshake. JDT LS hangs if no one responds to these three requests.
  client.onRequest("workspace/configuration", (params) => {
    const items = (params as { items?: unknown[] } | undefined)?.items;
    return Array.from({ length: Array.isArray(items) ? items.length : 0 }, () => ({}));
  });
  client.onRequest("client/registerCapability", () => null);
  client.onRequest("window/workDoneProgress/create", () => null);
  client.onNotification("language/status", (params) => {
    const note = params as { type?: unknown; message?: unknown };
    if (typeof note.type !== "string") return;
    gate.noteStatus(lease.workspaceId, {
      type: note.type,
      message: typeof note.message === "string" ? note.message : undefined,
    });
  });

  const projectUri = pathToFileURL(routed.projectRoot).href;
  await client.request("initialize", {
    processId: process.pid,
    rootUri: projectUri,
    workspaceFolders: [{ uri: projectUri, name }],
    capabilities: {
      workspace: { configuration: true, workspaceFolders: true },
      textDocument: {
        hover: { contentFormat: ["plaintext", "markdown"] },
        publishDiagnostics: {},
      },
    },
  });
  client.notify("initialized", {});
  targets.set(lease.workspaceId, {workspaceId: lease.workspaceId,
    projectRoot: routed.projectRoot,
    client,
  });
  client.notify("textDocument/didOpen", {
    textDocument: {
      uri: pathToFileURL(sourcePath).href,
      languageId: "java",
      version: 1,
      text: FIXTURE_SOURCE,
    },
  });

  let lspRequests = 0;
  const facade: LspFacade = {
    workspace: async (filePath: string): Promise<WorkspaceAvailability> => {
      const resolution = resolveWorkspace(filePath);
      if ("error" in resolution) return { status: "unroutable", detail: resolution.error };
      const held = await pool.acquire(resolution.projectRoot);
      try {
        await gate.awaitReady(held.workspaceId, { withinMs: options.readyDeadlineMs });
      } catch (error) {
        if (error instanceof WorkspaceNotReadyError) {
          return { status: "not-ready", detail: error.message, progress: error.progress };
        }
        throw error;
      } finally {
        // Return lease immediately: each tool call borrows the workspace exactly once, and a forgotten lease will
        // accumulates over dozens of calls and then keeps the pool when closed.
        await held.release();
      }
      return { status: "ready", workspaceId: held.workspaceId };
    },
    readFile: (filePath: string): string | undefined => {
      try {
        return readFileSync(filePath, "utf8");
      } catch {
        return undefined;
      }
    },
    request: async (method: string, params: unknown): Promise<unknown> => {
      lspRequests += 1;
      // The tool layer sets `uri` to the correct path it received; Converting to URI file is the job
      // composition root, because only it knows which file system the file is on.
      const shaped = params as { textDocument: { uri: string } };
      return client.request(method, {
        ...shaped,
        textDocument: { ...shaped.textDocument, uri: pathToFileURL(shaped.textDocument.uri).href },
      });
    },
  };

  if (options.warmUp) {
    await gate.awaitReady(lease.workspaceId, { withinMs: READY_DEADLINE_MS });
  }

  return {
    facade,
    sourcePath,
    projectRoot: routed.projectRoot,
    lspRequests: () => lspRequests,
  };
}// -------------------------------------------------------------------------------------------
// Assertion help
// -------------------------------------------------------------------------------------------

function unwrap<T>(outcome: ToolOutcome<T>, label: string): T {
  assert.equal(
    outcome.isError,
    false,
    `${label} must succeed, receiving ${JSON.stringify(outcome)}`,
  );
  return (outcome as { isError: false; value: T }).value;
}

/** `java_definition` returns URI, `java_references` returns path; compare the same path type. */
function asFsPath(value: string): string {
  const raw = value.startsWith("file:") ? fileURLToPath(value) : value;
  try {
    return realpathSync(raw);
  } catch {
    return raw;
  }
}

function assertResolvedHover(result: JavaHoverResult, label: string): SourceRange {
  assert.equal(
    result.resolved,
    true,
    `${label}: java_hover must resolve the symbol, receive ${JSON.stringify(result)}`,
  );
  assert.ok(
    "range" in result && result.range !== undefined && result.range !== null,
    `${label}: successful java_hover results ALWAYS have range (INV-TOOL-6)`,
  );
  return (result as { range: SourceRange }).range;
}

function assertDeclarationLocation(answer: DefinitionAnswer, sourcePath: string, label: string): void {
  assert.equal(
    answer.resolved,
    true,
    `${label}: java_definition must find the declaration, get ${JSON.stringify(answer)}`,
  );
  assert.equal(answer.locations.length, 1, `${label}: fixture has exactly one declaration of ${SYMBOL}`);
  const location = answer.locations[0]!;
  assert.equal(asFsPath(location.path), asFsPath(sourcePath), `${label}: declaration must be in the fixture file itself`);
  assert.deepEqual(
    location.range,
    symbolRangeOn(DECLARATION_LINE),
    `${label}: the declaration's range must match the actual offset of "${SYMBOL}" on line ${DECLARATION_LINE}`,
  );
}

function assertReferenceSet(answer: ReferencesAnswer, sourcePath: string, label: string): void {
  for (const reference of answer.references) {
    assert.equal(
      asFsPath(reference.path),
      asFsPath(sourcePath),
      `${label}: all references must be in the fixture file`,
    );
  }assert.deepEqual(
    sortRanges(answer.references.map((reference) => reference.range)),
    sortRanges(expectedReferenceRanges()),
    `${label}: the reference range set must match each actual offset in the fixture`,
  );
}

// -------------------------------------------------------------------------------------------
// Main scan: a warm JDT LS process serving eight conditions.
// -------------------------------------------------------------------------------------------

test(
  "feat-prove-navigation-tools: hover/definition/references via real pool on non-ASCII and astral-plane fixtures",
  { timeout: SWEEP_TIMEOUT_MS },
  async(t) => {
    process.env.JDTLS_HOME = JDTLS_FIXTURE_HOME;
    const cleanup = cleanupStack(t);
    const root = realpathSync(mkdtempSync(path.join(tmpdir(), "jdt-nav-")));
    // Register according to the initialization sequence; `cleanupStack` disassembles in reverse, so the directory remains
    // delete AFTER all child processes have stopped.
    cleanup(() => rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }));

    const live = await startLiveWorkspace(
      root,
      "warm",
      { readyDeadlineMs: READY_DEADLINE_MS, warmUp: true },
      cleanup,
    );
    const { facade, sourcePath } = live;

    // Fixture expectations, precomputed once and reused — all values come from the source text.
    const bmpColumn = columnOf(BMP_LINE, SYMBOL);
    const astralColumn = columnOf(ASTRAL_LINE, SYMBOL);
    const plainColumn = columnOf(PLAIN_LINE, SYMBOL);
    const expectedReferences = expectedReferenceRanges();
    assert.equal(
      lineText(PLAIN_LINE),
      Buffer.from(lineText(PLAIN_LINE), "utf8").toString("latin1"),
      "the anchor of the two cases must be pure ASCII, otherwise it measures INV-TOOL-1 again",
    );

    // Fixture must actually make counting difficult, otherwise both first conditions are meaningless. Every way
    // wrong count pushes the asked position one distance; That interval must EXCEED the token width, otherwise the call will be made
    // still falls in the middle of `counter`, JDT LS still solves the correct symbol and the wrong count leaves no trace.
    const bmpPrefix = lineText(BMP_LINE).slice(0, bmpColumn - 1);const astralPrefix = lineText(ASTRAL_LINE).slice(0, astralColumn - 1);
    assert.equal(
      [...bmpPrefix].length,
      bmpPrefix.length,
      "the BMP stream must not contain surrogate pairs: it exists to isolate the byte count",
    );
    assert.ok(
      Buffer.byteLength(bmpPrefix, "utf8") - bmpPrefix.length > SYMBOL.length,
      "the byte offset↔code unit of the BMP stream must exceed the token width, otherwise the byte count error will still fall in the token",
    );
    assert.ok(
      astralPrefix.length - [...astralPrefix].length > SYMBOL.length,
      "the astral line's code unit↔codepoint deviation must exceed the token width, otherwise the count error " +
        "codepoint still falls in token and corresponding mutant survives",
    );

    await t.test(
      "TCON-TOOL-0001: all three tools correctly report the true offset on a line containing a non-ASCII character in a code unit [INV-TOOL-1]",
      async() => {
        const hover = unwrap(
          await javaHover(facade, { path: sourcePath, line: BMP_LINE, column: bmpColumn }),
          "java_hover on BMP stream",
        );
        const range = assertResolvedHover(hover, "BMP line");
        assert.deepEqual(hover.position, { line: BMP_LINE, column: bmpColumn });
        assert.deepEqual(
          range,
          symbolRangeAt(BMP_LINE, bmpColumn),
          "hover's range must match the actual UTF-16 offset, not the number of UTF-8 bytes or codepoints",
        );

        const declaration = unwrap(
          await definition(facade, { path: sourcePath, line: BMP_LINE, column: bmpColumn }),
          "java_definition on BMP line",
        );
        assert.deepEqual(declaration.position, { line: BMP_LINE, column: bmpColumn });
        assertDeclarationLocation(declaration, sourcePath, "BMP line");

        const found = unwrap(
          await references(
            facade,
            { path: sourcePath, line: BMP_LINE, column: bmpColumn, includeDeclaration: false },
            { cap: expectedReferences.length },
          ),
          "java_references on BMP line",
        );
        assert.deepEqual(found.position, { line: BMP_LINE, column: bmpColumn });
        assertReferenceSet(found, sourcePath, "BMP stream");
      },
    );

    await t.test("TCON-TOOL-0002: all three tools correctly report the true offset on the line containing the astral-plane surrogate pair [INV-TOOL-1]",
      async() => {
        const hover = unwrap(
          await javaHover(facade, { path: sourcePath, line: ASTRAL_LINE, column: astralColumn }),
          "java_hover on astral line",
        );
        const range = assertResolvedHover(hover, "astral line");
        assert.deepEqual(hover.position, { line: ASTRAL_LINE, column: astralColumn });
        assert.deepEqual(
          range,
          symbolRangeAt(ASTRAL_LINE, astralColumn),
          "an astral-plane character takes up TWO code units; counting it as a codepoint shifts the range to another token",
        );

        const declaration = unwrap(
          await definition(facade, { path: sourcePath, line: ASTRAL_LINE, column: astralColumn }),
          "java_definition on astral line",
        );
        assert.deepEqual(declaration.position, { line: ASTRAL_LINE, column: astralColumn });
        assertDeclarationLocation(declaration, sourcePath, "astral line");

        const found = unwrap(
          await references(
            facade,
            { path: sourcePath, line: ASTRAL_LINE, column: astralColumn, includeDeclaration: false },
            { cap: expectedReferences.length },
          ),
          "java_references on astral line",
        );
        assert.deepEqual(found.position, { line: ASTRAL_LINE, column: astralColumn });
        assertReferenceSet(found, sourcePath, "astral stream");
      },
    );

    await t.test(
      "TCON-TOOL-0003: three tools talk about the same coordinate system for the same symbol position [INV-TOOL-1]",
      async() => {
        const request = { path: sourcePath, line: ASTRAL_LINE, column: astralColumn };
        const hover = unwrap(await javaHover(facade, request), "java_hover in general sweep");
        const declaration = unwrap(await definition(facade, request), "java_definition in general scan");
        const found = unwrap(
          await references(facade, { ...request, includeDeclaration: true }, { cap: 1_000 }),
          "java_references in general scan",
        );// The same position is echoed by three tools exactly the same — no tool lowers or raises the base itself.
        const echoed = { line: ASTRAL_LINE, column: astralColumn };
        assert.deepEqual(hover.position, echoed);
        assert.deepEqual(declaration.position, echoed);
        assert.deepEqual(found.position, echoed);

        const hoverRange = assertResolvedHover(hover, "general scan");
        assert.equal(declaration.resolved, true);
        const declarationRange = declaration.locations[0]!.range;

        // Cross-reference between tools: output of java_definition is fed directly as input of
        // java_hover. If either one speaks with another base, the round falls to another token and range
        // returns no more duplicates.
        const hoverAtDeclaration = unwrap(
          await javaHover(facade, {
            path: sourcePath,
            line: declarationRange.start.line,
            column: declarationRange.start.column,
          }),
          "java_hover at the specified java_definition location",
        );
        assert.deepEqual(
          assertResolvedHover(hoverAtDeclaration, "hover definition→hover"),
          declarationRange,
          "hover at the position returned by the definition must include that exact token — the two tools must have the same base",
        );

        // java_references with includeDeclaration includes the exact declaration that java_definition specified.
        assert.ok(
          found.references.some(
            (reference) =>
              reference.range.start.line === declarationRange.start.line &&
              reference.range.start.column === declarationRange.start.column,
          ),
          `java_references must contain a declaration at ${JSON.stringify(declarationRange)}; `+
            `get ${JSON.stringify(found.references.map((reference) => reference.range))}`,
        );
        // And all three tools say the 1-based line, none of them returns 0-based.
        assert.deepEqual(hoverRange, symbolRangeAt(ASTRAL_LINE, astralColumn));
        assert.deepEqual(declarationRange, symbolRangeOn(DECLARATION_LINE));
      },
    );

    await t.test(
      "TCON-TOOL-0004: overcap list always includes truncated:true and TOTAL [INV-TOOL-3]",async() => {
        const trueTotal = expectedReferences.length;
        assert.ok(trueTotal >= 2, "fixture must have at least two references to cut");
        const cap = trueTotal - 1;

        const found = unwrap(
          await references(
            facade,
            { path: sourcePath, line: PLAIN_LINE, column: plainColumn, includeDeclaration: false },
            { cap },
          ),
          "java_references under cap is less than the actual reference number",
        );

        assert.equal(found.cap, cap, "the result must clearly state which cap was applied");
        assert.equal(found.truncated, true, "a truncated list should NEVER be silent");
        assert.equal(
          found.total,
          trueTotal,
          "total must be the REAL total before cutting, not the length after cutting",
        );
        assert.equal(found.references.length, cap, "the returned list must be exactly as long as cap");
        for (const reference of found.references) {
          assert.ok(
            expectedReferences.some(
              (expected) =>
                expected.start.line === reference.range.start.line &&
                expected.start.column === reference.range.start.column,
            ),
            `the remaining element after slicing must be a true reference: ${JSON.stringify(reference.range)}`,
          );
        }
      },
    );

    await t.test(
      "TCON-TOOL-0005: if the cap is correct, the list is complete and NOT truncated [INV-TOOL-3]",
      async() => {
        const trueTotal = expectedReferences.length;
        const found = unwrap(
          await references(
            facade,
            { path: sourcePath, line: PLAIN_LINE, column: plainColumn, includeDeclaration: false },
            { cap: trueTotal },
          ),
          "java_references under the cap is exactly equal to the actual reference number",
        );

        assert.equal(found.cap, trueTotal);
        assert.equal(
          found.truncated,
          false,
          "no cut element is never reported as cut (compare > not >=)",
        );
        assert.equal(found.total, trueTotal);assert.equal(found.references.length, trueTotal, "last reference must not be missing");
        assertReferenceSet(found, sourcePath, "cap correct boundary");
      },
    );

    await t.test(
      "TCON-TOOL-0008: oversized coordinates rejected BEFORE all LSP calls, with error invalid-position [INV-TOOL-5]",
      async() => {
        const oversized = [
          { label: "lines beyond the end of the file", line: FIXTURE_LINES.length + 1, column: 1 },
          {
            label: "column beyond end of line",
            line: BMP_LINE,
            column: lineText(BMP_LINE).length + 5,
          },
        ];

        for (const { label, line, column } of oversized) {
          const before = live.lspRequests();
          const = outcomes [
            await javaHover(facade, { path: sourcePath, line, column }),
            await definition(facade, { path: sourcePath, line, column }),
            await references(facade, { path: sourcePath, line, column, includeDeclaration: false }),
          ];
          const names = ["java_hover", "java_definition", "java_references"];

          outcomes.forEach((outcome, index) => {
            assert.equal(
              outcome.isError,
              true,
              `${names[index]} with ${label}: must be an explicit error, not a success ${JSON.stringify(outcome)}`,
            );
            const failure = outcome as { isError: true; code: string; message: string };
            assert.equal(
              failure.code,
              "invalid-position",
              `${names[index]} with ${label}: error code must be the invalid-position of the tool layer itself`,
            );
            assert.match(
              failure.message,
              /^invalid-position: /,
              `${names[index]} with ${label}: the message must name the error type itself`,
            );
          });

          assert.equal(
            live.lspRequests(),
            before,
            `${label}: no LSP calls are allowed to leave the tool layer when the coordinates are wrong (INV-TOOL-5)`,
          );
        }
      },
    );

    await t.test("TCON-TOOL-0009: hovering between tokens always returns the range of the RESOLVED token, not the asked position [INV-TOOL-6]",
      async() => {
        const midTokenColumn = astralColumn + 3;
        assert.ok(
          midTokenColumn > astralColumn && midTokenColumn < astralColumn + SYMBOL.length,
          "the query position must be BETWEEN the token, otherwise a range echo of the input will be trivially correct",
        );

        const hover = unwrap(
          await javaHover(facade, { path: sourcePath, line: ASTRAL_LINE, column: midTokenColumn }),
          "java_hover between tokens on astral line",
        );
        const range = assertResolvedHover(hover, "hover between token");

        assert.deepEqual(
          range,
          symbolRangeAt(ASTRAL_LINE, astralColumn),
          "range must cover the resolved token, calculated based on the actual UTF-16 offset of the fixture",
        );
        assert.notDeepEqual(
          range.start,
          hover.position,
          "range cannot be a duplicate of the location the caller asked for",
        );
        assert.notDeepEqual(
          range.end,
          hover.position,
          "range must not degenerate to a point at the asked location",
        );
      },
    );

    await t.test(
      "TCON-TOOL-0010: location failed to resolve any element as no-result WITH NAME, not successful hover [INV-TOOL-6]",
      async() => {
        const emptyPositions = [
          { label: "blank line", line: BLANK_LINE, column: 1 },
          { label: "plain prose comment line", line: COMMENT_LINE, column: 20 },
        ];

        for (const { label, line, column } of emptyPositions) {
          const result = unwrap(
            await javaHover(facade, { path: sourcePath, line, column }),
            `java_hover at ${label}`,
          );
          assert.equal(
            result.resolved,
            false,
            `${label}: must be an explicit no-result, receive ${JSON.stringify(result)}`,
          );
          assert.equal(
            "range" in result,
            false,
            `${label}: no-result branch does not carry range — "success but missing range" forbidden`,
          );          const unresolved = result as { reason: string };
          assert.ok(
            typeof unresolved.reason === "string" && unresolved.reason.trim().length > 0,
            `${label}: no-result phải nêu lý do đọc được, nhận được ${JSON.stringify(unresolved.reason)}`,
          );
          assert.deepEqual(
            result.position,
            { line, column },
            `${label}: no-result vẫn phải nói rõ nó nói về vị trí nào`,
          );
        }
      },
    );
  },
);

// -------------------------------------------------------------------------------------------
// TCON-TOOL-0006 — đường dẫn không định tuyến được. Không cần JVM: quyết định thuộc project-router.
// -------------------------------------------------------------------------------------------

test(
  "TCON-TOOL-0006: đường dẫn không thuộc workspace nào luôn thành lỗi unroutable, không bao giờ là kết quả rỗng thành công [INV-TOOL-4]",
  { timeout: 30_000 },
  async (t) => {
    const cleanup = cleanupStack(t);
    const root = realpathSync(mkdtempSync(path.join(tmpdir(), "jdt-nav-unroutable-")));
    cleanup(() => rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }));

    const strayPath = path.join(root, "Stray.java");
    writeFileSync(strayPath, FIXTURE_SOURCE, "utf8");
    const routed = resolveWorkspace(strayPath);
    assert.ok(
      "error" in routed,
      "fixture phải thật sự không định tuyến được; nếu có pom.xml phía trên thì ca này vô nghĩa",
    );

    let lspRequests = 0;
    const facade: LspFacade = {
      workspace: (filePath: string): WorkspaceAvailability => {
        const resolution = resolveWorkspace(filePath);
        if ("error" in resolution) return { status: "unroutable", detail: resolution.error };
        return { status: "ready", workspaceId: resolution.workspaceId };
      },
      readFile: (filePath: string) => readFileSync(filePath, "utf8"),
      request: async () => {
        lspRequests += 1;
        return null;
      },
    };

    const outcomes: Array<[string, ToolOutcome<unknown>]> = [
      ["java_hover", await javaHover(facade, { path: strayPath, line: BMP_LINE, column: 1 })],
      ["java_definition", await definition(facade, { path: strayPath, line: BMP_LINE, column: 1 })],
      [
        "java_references",
        await references(facade, {
          path: strayPath,
          line: BMP_LINE,
          column: 1,
          includeDeclaration: false,
        }),
      ],
    ];

    for (const [name, outcome] of outcomes) {
      assert.equal(
        outcome.isError,
        true,
        `${name}: đường dẫn không định tuyến được phải thành lỗi, nhận được ${JSON.stringify(outcome)}`,
      );
      const failure = outcome as { isError: true; code: string; message: string };
      assert.equal(failure.code, "unroutable", `${name}: lỗi phải tự nêu tên loại unroutable`);
      assert.match(failure.message, /^unroutable: /, `${name}: thông điệp phải mang tên loại lỗi`);
      assert.equal(
        "value" in failure,
        false,
        `${name}: envelope lỗi không bao giờ mang theo một kết quả thành công`,
      );
    }
    assert.equal(lspRequests, 0, "không lời gọi LSP nào được phát ra cho một đường dẫn không định tuyến được");
  },
);

// -------------------------------------------------------------------------------------------
// TCON-TOOL-0007 — workspace còn đang khởi động. Cần một tiến trình JDT LS THẬT vừa mới sinh ra.
// -------------------------------------------------------------------------------------------

test(
  "TCON-TOOL-0007: workspace chưa sẵn sàng index luôn thành lỗi not-ready, không bao giờ là kết quả rỗng thành công [INV-TOOL-4]",
  { timeout: SWEEP_TIMEOUT_MS },
  async (t) => {
    process.env.JDTLS_HOME = JDTLS_FIXTURE_HOME;
    const cleanup = cleanupStack(t);
    const root = realpathSync(mkdtempSync(path.join(tmpdir(), "jdt-nav-warming-")));
    // Cùng lý do như đợt quét chính: thư mục được đăng ký trước nên bị xoá sau cùng.
    cleanup(() => rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }));

    // `warmUp: false`: tool được gọi ngay sau handshake, trong khi index còn đang xây (cold start
    // đo được khoảng 4 s trên fixture này, so với hạn chờ WARMING_DEADLINE_MS).
    const warming = await startLiveWorkspace(
      root,
      "warming",
      { readyDeadlineMs: WARMING_DEADLINE_MS, warmUp: false },
      cleanup,
    );

    const column = columnOf(BMP_LINE, SYMBOL);
    const outcomes: Array<[string, ToolOutcome<unknown>]> = [
      [
        "java_hover",
        await javaHover(warming.facade, { path: warming.sourcePath, line: BMP_LINE, column }),
      ],
      [
        "java_definition",
        await definition(warming.facade, { path: warming.sourcePath, line: BMP_LINE, column }),
      ],
      [
        "java_references",
        await references(warming.facade, {
          path: warming.sourcePath,
          line: BMP_LINE,
          column,
          includeDeclaration: false,
        }),
      ],
    ];

    for (const [name, outcome] of outcomes) {
      assert.equal(
        outcome.isError,
        true,
        `${name}: workspace đang khởi động phải thành lỗi, nhận được ${JSON.stringify(outcome)}`,
      );
      const failure = outcome as { isError: true; code: string; message: string; detail?: unknown };
      assert.equal(failure.code, "not-ready", `${name}: lỗi phải tự nêu tên loại not-ready`);
      assert.match(failure.message, /^not-ready: /, `${name}: thông điệp phải mang tên loại lỗi`);
      assert.equal(
        "value" in failure,
        false,
        `${name}: envelope lỗi không bao giờ mang theo một kết quả thành công`,
      );
      const progress = failure.detail as { phase?: unknown } | undefined;
      assert.ok(
        progress !== undefined && typeof progress.phase === "string" && progress.phase !== "ready",
        `${name}: lỗi not-ready phải chở theo tiến độ để agent phân biệt "chưa xong" với "không có gì"`,
      );
    }

    assert.equal(
      warming.lspRequests(),
      0,
      "không lời gọi tool nào được phép chạm tới LSP khi workspace còn chưa sẵn sàng",
    );
  },
);
