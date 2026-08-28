// Traceability (harness/skills/test-design/SKILL.md, role: Test-Implementer).
//
// Requirements: INV-CA-1
// Feature:      feat-prove-code-actions | Tools: java_code_actions + java_apply_code_action
//
// Level 3 (process-boundary) oracle for INV-CA-1: a code-action handle minted before an edit must
// never resolve after that edit. A real JDT LS returns real (unresolved) code actions; the handle is
// minted against the real file-sync-watcher's generation; the file is then edited on disk, the
// watcher settles to a new generation, and resolve must fail with resyncing rather than return a
// stale edit.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { createCodeActionStore } from "../../src/tools/code-action-store.ts";
import { javaCodeActions } from "../../src/tools/code-actions.ts";
import { javaApplyCodeAction } from "../../src/tools/apply-code-action.ts";
import { createFileSyncWatcher } from "../../src/workspace/file-sync-watcher.ts";
import type { LspFacade, WorkspaceAvailability } from "../../src/tools/tool-layer.ts";
import { createReadinessGate, type ReadinessGate, type ReadinessTarget } from "../../src/workspace/readiness-gate.ts";
import { resolveWorkspace } from "../../src/workspace/project-router.ts";
import { createWorkspacePool, type WorkspacePool } from "../../src/workspace/workspace-pool.ts";

const JDTLS_FIXTURE_HOME = path.resolve(".cache/jdtls-fixture/1.61.0.202607231254");
process.env.JDTLS_HOME = JDTLS_FIXTURE_HOME;

const READY_DEADLINE_MS = 120_000;

const SOURCE = 'package fixture;\npublic class Greeter {\n    void use() {\n        int unused = 42;\n        System.out.println("hi");\n    }\n}\n';

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

test(
  "INV-CA-1: a code-action handle minted before an on-disk edit fails to resolve after it",
  { timeout: 180_000 },
  async (t) => {
    const cleanup = cleanupStack(t);
    const root = mkdtempSync(path.join(tmpdir(), "jdt-ca-"));
    cleanup(() => rmSync(root, { recursive: true, force: true }));

    const projectRoot = path.join(root, "project");
    const sourcePath = path.join(projectRoot, "src/main/java/fixture/Greeter.java");
    mkdirSync(path.dirname(sourcePath), { recursive: true });
    writeFileSync(path.join(projectRoot, "pom.xml"), "<project><modelVersion>4.0.0</modelVersion><groupId>fixture</groupId><artifactId>ca</artifactId><version>1</version></project>\n");
    writeFileSync(sourcePath, SOURCE, "utf8");

    const pool: WorkspacePool = createWorkspacePool({ cacheRoot: path.join(root, "cache"), maxWorkspaces: 3 });
    cleanup(() => pool.close());

    const routed = resolveWorkspace(sourcePath);
    assert.ok(!("error" in routed), `fixture must route: ${JSON.stringify(routed)}`);
    const lease = await pool.acquire(routed.projectRoot);
    cleanup(() => lease.release());
    const client = lease.client;
    assert.ok(client, "pool must return the real JDT LS LspClient");

    client.onRequest("workspace/configuration", (params) => {
      const items = (params as { items?: unknown[] } | undefined)?.items;
      return Array.from({ length: Array.isArray(items) ? items.length : 0 }, () => ({}));
    });
    client.onRequest("client/registerCapability", () => null);
    client.onRequest("window/workDoneProgress/create", () => null);

    const targets = new Map<string, ReadinessTarget>();
    const gate: ReadinessGate = createReadinessGate({ resolveTarget: (id) => targets.get(id) });
    cleanup(() => gate.close());
    client.onNotification("language/status", (params) => {
      const note = params as { type?: unknown; message?: unknown };
      if (typeof note.type === "string") gate.noteStatus(lease.workspaceId, { type: note.type, message: typeof note.message === "string" ? note.message : undefined });
    });

    const projectUri = pathToFileURL(routed.projectRoot).href;
    await client.request("initialize", {
      processId: process.pid,
      rootUri: projectUri,
      workspaceFolders: [{ uri: projectUri, name: "ca" }],
      capabilities: { workspace: { configuration: true, workspaceFolders: true }, textDocument: { codeAction: { codeActionLiteralSupport: { codeActionKind: { valueSet: ["quickfix", "refactor"] } } }, publishDiagnostics: {} } },
    });
    client.notify("initialized", {});
    targets.set(lease.workspaceId, { workspaceId: lease.workspaceId, projectRoot: routed.projectRoot, client });
    client.notify("textDocument/didOpen", { textDocument: { uri: pathToFileURL(sourcePath).href, languageId: "java", version: 1, text: SOURCE } });

    // Real watcher — the generation the handles are bound to.
    const watcher = createFileSyncWatcher({ projectRoot: routed.projectRoot, notifications: client });
    await watcher.start();
    cleanup(() => watcher.close());

    // Warm up the FSEvents stream: on macOS libuv starts the FSEvents thread AFTER fs.watch returns,
    // so an edit in that window is never delivered. A non-watched probe file confirms the stream is
    // live before we rely on it (the probe is not *.java/pom.xml, so it does not bump generation).
    writeFileSync(path.join(routed.projectRoot, ".fs-watch-probe"), "probe", "utf8");
    for (let i = 0; i < 100 && watcher.lastChangeAt === undefined; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    assert.ok(watcher.lastChangeAt !== undefined, "the watcher must observe events before the edit");

    const facade: LspFacade = {
      workspace: async (filePath: string): Promise<WorkspaceAvailability> => {
        const resolution = resolveWorkspace(filePath);
        if ("error" in resolution) return { status: "unroutable", detail: resolution.error };
        const held = await pool.acquire(resolution.projectRoot);
        try {
          await gate.awaitReady(held.workspaceId, { withinMs: READY_DEADLINE_MS });
        } catch (error) {
          if (error instanceof Error && error.name === "WorkspaceNotReadyError") {
            return { status: "not-ready", detail: error.message, progress: (error as { progress?: unknown }).progress };
          }
          throw error;
        } finally {
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
        const shaped = params as { textDocument: { uri: string } };
        return client.request(method, { ...shaped, textDocument: { ...shaped.textDocument, uri: pathToFileURL(shaped.textDocument.uri).href } });
      },
    };

    // Position: the `unused` token (line 4, column 13 in 1-based).
    const position = { line: 4, column: 13 };
    const store = createCodeActionStore();

    const minted = await javaCodeActions(facade, store, watcher.generation, { path: sourcePath, line: position.line, column: position.column });
    assert.equal(minted.isError, false, `code actions must succeed: ${JSON.stringify(minted)}`);
    if (minted.isError) throw new Error("unreachable");
    assert.ok(minted.value.actions.length > 0, "the fixture must yield at least one code action");

    const handle = minted.value.actions[0]!;
    const mintGeneration = watcher.generation;

    // Edit the file on disk; wait for the watcher to settle to a NEW generation.
    writeFileSync(sourcePath, SOURCE.replace("int unused = 42;", "int unused = 43;"), "utf8");
    await watcher.whenSettled();
    assert.ok(watcher.generation > mintGeneration, "the watcher generation must advance after the edit");

    // Resolve the handle at the new generation — must fail as resyncing, never return a stale edit.
    const resolved = await javaApplyCodeAction(facade, store, lease.workspaceId, watcher.generation, { actionId: handle.actionId });
    assert.equal(resolved.isError, true, "a handle minted before the edit must not resolve after it");
    if (!resolved.isError) throw new Error("unreachable");
    assert.equal(resolved.code, "resyncing", "the stale handle must fail with the resyncing error, not return an edit");
  },
);
