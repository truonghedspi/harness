// Traceability (harness/skills/test-design/SKILL.md, role: Test-Implementer).
//
// Conditions:   TCON-SYNC-0001, TCON-SYNC-0002, TCON-SYNC-0003
// Requirements: INV-SYNC-1
// Plan:         TP-SYNC-0001 | Feature: feat-prove-sync
//
// Level 3 (process-boundary) oracle for INV-SYNC-1: "no tool result is ever computed from a JDT LS
// view older than the last on-disk change observed in that workspace". It reproduces spike C
// (spikes/jdtls-disk-sync.mjs) against the real components — a real per-workspace pool spawns a real
// JDT LS, the real file-sync-watcher watches the project root and hands `workspace/didChangeWatchedFiles`
// to the real LspClient.notify(), and `withSyncQuiescence` (the INV-SYNC-1 blocking seam) gates the
// probe. The only thing this file builds itself is the composition root: the production daemon does
// not exist yet (feat-prove-cross-process-integration owns that wiring), so the test wires the four
// published interfaces together, exactly as navigation-tools.integration.spec.ts does.
//
// The probe is `textDocument/definition` of a method call site — spike C's exact mechanism — rather
// than `workspace/symbol`: the readiness probe resolves top-level *types* only, so it cannot observe
// a method rename (measured, see harness/docs/design/evidence.md and the adaptation note in
// TP-SYNC-0001 spec_gaps). "Stale" is spike C's `2_afterSilentDiskEdit` state: the definition still
// resolves after the edit because JDT LS has not been told. "Corrected" is spike C's
// `3_afterDidChangeWatchedFiles` state: the definition no longer resolves.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { createFileSyncWatcher, type FileSyncWatcher } from "../../src/workspace/file-sync-watcher.ts";
import { resolveWorkspace } from "../../src/workspace/project-router.ts";
import { createWorkspacePool, type WorkspacePool } from "../../src/workspace/workspace-pool.ts";
import { ResyncingError, withSyncQuiescence } from "../../src/workspace/sync-guard.ts";

// -------------------------------------------------------------------------------------------
// Fixture: Greeter.greet(String) declared in Greeter.java, called from App.java. Spike C's shape.
// -------------------------------------------------------------------------------------------

const GREETER_SOURCE = [
  "package fixture;",
  "public class Greeter {",
  '    public String greet(String name) { return "hi " + name; }',
  "}",
  "",
].join("\n");

const APP_LINES = [
  /* 1 */ "package fixture;",
  /* 2 */ "public class App {",
  /* 3 */ "    public static void main(String[] args) {",
  /* 4 */ "        Greeter g = new Greeter();",
  /* 5 */ '        System.out.println(g.greet("w"));',
  /* 6 */ "    }",
  /* 7 */ "}",
  /* 8 */ "",
];
const APP_SOURCE = APP_LINES.join("\n");

/** Preinstalled JDT LS distribution (harness init installs it; the pool's spawner reads JDTLS_HOME). */
const JDTLS_FIXTURE_HOME = path.resolve(".cache/jdtls-fixture/1.61.0.202607231254");
process.env.JDTLS_HOME = JDTLS_FIXTURE_HOME;

/** 0-based {line, character} of the `greet` token in App.java — spike C's probe position. */
function greetPosition(): { line: number; character: number } {
  const lineText = APP_LINES[4]!;
  const index = lineText.indexOf("greet");
  assert.ok(index >= 0, "fixture: App.java must contain the greet call site");
  return { line: 4, character: index };
}

// -------------------------------------------------------------------------------------------
// Composition root: project-router + workspace-pool + file-sync-watcher + a real JDT LS.
// -------------------------------------------------------------------------------------------

interface SyncHarness {
  appUri: string;
  /** True when textDocument/definition still resolves `g.greet(...)` into Greeter.java (spike C). */
  resolves(): Promise<boolean>;
  /** The guarded probe: the sync-guard must keep this from answering stale. */
  guardedResolves(deadlineMs: number): Promise<boolean>;
  watcher: FileSyncWatcher;
  lease: { release(): Promise<void> };
}

interface AfterRegistrar {
  after(fn: () => void | Promise<void>): void;
}

function cleanupStack(t: AfterRegistrar): (step: () => void | Promise<void>) => void {
  const steps: Array<() => void | Promise<void>> = [];
  t.after(async () => {
    for (let i = steps.length - 1; i >= 0; i -= 1) {
      try {
        await steps[i]!();
      } catch {
        /* best-effort */
      }
    }
  });
  return (step) => steps.push(step);
}

/**
 * Spawn a real JDT LS for a real Maven fixture, perform the initialize handshake, attach the real
 * file-sync-watcher (sink = the real LspClient.notify), and wait until the definition of the greet
 * call site resolves — the spike-C baseline.
 */
async function startSyncHarness(
  t: AfterRegistrar,
): Promise<{ harness: SyncHarness; cleanup: (step: () => void | Promise<void>) => void; root: string; greeterPath: string }> {
  const cleanup = cleanupStack(t);
  const root = mkdtempSync(path.join(tmpdir(), "jdt-sync-"));
  cleanup(() => rmSync(root, { recursive: true, force: true }));

  const projectRoot = path.join(root, "project");
  const greeterPath = path.join(projectRoot, "src/main/java/fixture/Greeter.java");
  const appPath = path.join(projectRoot, "src/main/java/fixture/App.java");
  mkdirSync(path.dirname(greeterPath), { recursive: true });
  writeFileSync(
    path.join(projectRoot, "pom.xml"),
    "<project><modelVersion>4.0.0</modelVersion><groupId>fixture</groupId>" +
      "<artifactId>sync</artifactId><version>1</version></project>\n",
  );
  writeFileSync(greeterPath, GREETER_SOURCE, "utf8");
  writeFileSync(appPath, APP_SOURCE, "utf8");

  const pool: WorkspacePool = createWorkspacePool({ cacheRoot: path.join(root, "cache"), maxWorkspaces: 3 });
  cleanup(() => pool.close());

  const routed = resolveWorkspace(appPath);
  assert.ok(!("error" in routed), `fixture must route: ${JSON.stringify(routed)}`);
  const lease = await pool.acquire(routed.projectRoot);
  cleanup(() => lease.release());
  const client = lease.client;
  assert.ok(client, "pool must return the real JDT LS LspClient");

  // server->client half of the handshake: JDT LS hangs without these three answers.
  client.onRequest("workspace/configuration", (params) => {
    const items = (params as { items?: unknown[] } | undefined)?.items;
    return Array.from({ length: Array.isArray(items) ? items.length : 0 }, () => ({}));
  });
  client.onRequest("client/registerCapability", () => null);
  client.onRequest("window/workDoneProgress/create", () => null);

  const projectUri = pathToFileURL(routed.projectRoot).href;
  await client.request("initialize", {
    processId: process.pid,
    rootUri: projectUri,
    workspaceFolders: [{ uri: projectUri, name: "sync" }],
    capabilities: {
      workspace: { configuration: true, workspaceFolders: true, didChangeWatchedFiles: { dynamicRegistration: true } },
      textDocument: { definition: {}, hover: {}, publishDiagnostics: {} },
    },
  });
  client.notify("initialized", {});
  client.notify("textDocument/didOpen", {
    textDocument: { uri: pathToFileURL(appPath).href, languageId: "java", version: 1, text: APP_SOURCE },
  });

  // The real watcher, sink wired to the real LspClient.notify — not a fake sink (feat-lsp-notifications).
  const watcher = createFileSyncWatcher({ projectRoot: routed.projectRoot, notifications: client });
  await watcher.start();
  cleanup(() => watcher.close());

  const appUri = pathToFileURL(appPath).href;
  const position = greetPosition();
  const resolves = async (): Promise<boolean> => {
    const raw = await client.request("textDocument/definition", {
      textDocument: { uri: appUri },
      position,
    });
    const result = Array.isArray(raw) ? raw : [];
    return result.length > 0;
  };

  // Warm up to spike C's baseline: wait until the definition of g.greet(...) resolves into Greeter.
  const warmDeadline = Date.now() + 120_000;
  while (!(await resolves()) && Date.now() < warmDeadline) {
    await new Promise((r) => setTimeout(r, 250));
  }
  assert.ok(await resolves(), "precondition: definition of the greet call site must resolve before the edit");

  const harness: SyncHarness = {
    appUri,
    resolves,
    guardedResolves: (deadlineMs: number) =>
      withSyncQuiescence(watcher, { withinMs: deadlineMs }, async () => (await resolves()), (result) => result === true),
    watcher,
    lease,
  };

  return { harness, cleanup, root, greeterPath };
}

/** Rewrite Greeter.java on disk, renaming greet -> salute (spike C's silent edit). */
function renameGreetOnDisk(greeterPath: string): void {
  writeFileSync(greeterPath, GREETER_SOURCE.replace("greet(", "salute("), "utf8");
}

test(
  "INV-SYNC-1: a probe guarded by the sync-guard never answers from the pre-edit view — spike C's 2_afterSilentDiskEdit is unreachable",
  { timeout: 180_000 },
  async (t) => {
    const { harness, greeterPath } = await startSyncHarness(t);

    // Baseline: the call site resolves (spike C state 1).
    assert.ok(await harness.resolves(), "baseline: definition of g.greet(...) resolves into Greeter.java");

    // Silent edit, then probe through the guard before the watcher's notification lands. The edit is
    // a synchronous write; the raw fs.watch event arrives on a later tick, so wait until the watcher
    // has OBSERVED it (lastChangeAt advances) — the guard's job starts from an observed change.
    const observedBefore = harness.watcher.lastChangeAt;
    renameGreetOnDisk(greeterPath);
    for (let i = 0; i < 100 && harness.watcher.lastChangeAt === observedBefore; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    assert.ok(harness.watcher.lastChangeAt !== observedBefore, "the watcher must observe the edit before the guarded probe");

    // The guard must either wait for the watcher to settle and return the corrected answer, or fail
    // explicitly as resyncing. It must never hand back the stale "still resolves" answer.
    let stale: boolean;
    try {
      stale = await harness.guardedResolves(15_000);
    } catch (error) {
      if (error instanceof ResyncingError) {
        // Explicit resyncing is a valid, non-stale outcome — TCON-SYNC-0001's second half.
        return;
      }
      throw error;
    }
    assert.equal(
      stale,
      false,
      "TCON-SYNC-0001: the guarded probe returned the stale pre-edit answer (g.greet still resolved) — INV-SYNC-1 is violated",
    );

    // TCON-SYNC-0003: once the guarded probe has left the stale state, a later probe must not return stale.
    assert.equal(await harness.resolves(), false, "TCON-SYNC-0003: a later unguarded probe reported the stale answer again");
  },
);

test(
  "INV-SYNC-1: after the watcher's notification is delivered and JDT LS reaches quiescence, the probe returns the corrected answer",
  { timeout: 180_000 },
  async (t) => {
    const { harness, greeterPath } = await startSyncHarness(t);
    assert.ok(await harness.resolves(), "baseline resolves");

    renameGreetOnDisk(greeterPath);

    // Wait for the watcher to settle (notification dispatched) and then for JDT LS to catch up,
    // polling the unguarded probe until it leaves the stale state.
    await harness.watcher.whenSettled();
    const deadline = Date.now() + 120_000;
    while ((await harness.resolves()) && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 250));
    }
    assert.equal(
      await harness.resolves(),
      false,
      "TCON-SYNC-0002: after the notification is delivered and JDT LS reaches quiescence, the definition must no longer resolve the deleted symbol",
    );
  },
);
