// Traceability (harness/skills/test-design/SKILL.md, role: Test-Implementer).
//
// Conditions:   TCON-TOOL-0011, TCON-TOOL-0012, TCON-TOOL-0013
// Requirements: INV-TOOL-2
// Plan:         TP-TOOL-0002 | Feature: feat-prove-rename
//
// Level 3 (process-boundary) oracle for INV-TOOL-2 on java_rename: a real rename round-trip through
// the real pool + real JDT LS against the two-file fixture (evidence.md: greet -> salute), asserting
// on REAL file mtimes across the whole fixture tree. A rename with no apply (or apply:false) must
// leave every file untouched; apply:true must write exactly the files the WorkspaceEdit names.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { javaRename } from "../../src/tools/rename.ts";
import type { LspFacade, WorkspaceAvailability } from "../../src/tools/tool-layer.ts";
import { createReadinessGate, type ReadinessGate, type ReadinessTarget } from "../../src/workspace/readiness-gate.ts";
import { resolveWorkspace } from "../../src/workspace/project-router.ts";
import { createWorkspacePool, type WorkspacePool } from "../../src/workspace/workspace-pool.ts";

const JDTLS_FIXTURE_HOME = path.resolve(".cache/jdtls-fixture/1.61.0.202607231254");
process.env.JDTLS_HOME = JDTLS_FIXTURE_HOME;

const READY_DEADLINE_MS = 120_000;

const GREETER_SOURCE = 'package fixture;\npublic class Greeter {\n    public String greet(String name) { return "hi " + name; }\n}\n';
const APP_SOURCE = 'package fixture;\npublic class App {\n    public static void main(String[] a) { Greeter g = new Greeter(); System.out.println(g.greet("w")); }\n}\n';

/** Vị trí 1-based của token `greet` trong khai báo (Greeter.java). */
function greetPosition(source: string): { line: number; column: number } {
  const lines = source.split("\n");
  const lineIndex = lines.findIndex((line) => line.includes("String greet("));
  assert.ok(lineIndex >= 0, "fixture must declare greet(String)");
  const column = lines[lineIndex]!.indexOf("greet");
  return { line: lineIndex + 1, column: column + 1 };
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

test(
  "INV-TOOL-2: a real rename round-trip writes only on apply:true; no-apply and apply:false leave every file's mtime untouched",
  { timeout: 180_000 },
  async (t) => {
    const cleanup = cleanupStack(t);
    const root = mkdtempSync(path.join(tmpdir(), "jdt-rename-"));
    cleanup(() => rmSync(root, { recursive: true, force: true }));

    const projectRoot = path.join(root, "project");
    const greeterPath = path.join(projectRoot, "src/main/java/fixture/Greeter.java");
    const appPath = path.join(projectRoot, "src/main/java/fixture/App.java");
    mkdirSync(path.dirname(greeterPath), { recursive: true });
    writeFileSync(path.join(projectRoot, "pom.xml"), "<project><modelVersion>4.0.0</modelVersion><groupId>fixture</groupId><artifactId>rename</artifactId><version>1</version></project>\n");
    writeFileSync(greeterPath, GREETER_SOURCE, "utf8");
    writeFileSync(appPath, APP_SOURCE, "utf8");

    const pool: WorkspacePool = createWorkspacePool({ cacheRoot: path.join(root, "cache"), maxWorkspaces: 3 });
    cleanup(() => pool.close());

    const routed = resolveWorkspace(greeterPath);
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
      workspaceFolders: [{ uri: projectUri, name: "rename" }],
      capabilities: { workspace: { configuration: true, workspaceFolders: true }, textDocument: { rename: {}, publishDiagnostics: {} } },
    });
    client.notify("initialized", {});
    targets.set(lease.workspaceId, { workspaceId: lease.workspaceId, projectRoot: routed.projectRoot, client });
    client.notify("textDocument/didOpen", { textDocument: { uri: pathToFileURL(greeterPath).href, languageId: "java", version: 1, text: GREETER_SOURCE } });
    client.notify("textDocument/didOpen", { textDocument: { uri: pathToFileURL(appPath).href, languageId: "java", version: 1, text: APP_SOURCE } });

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

    const position = greetPosition(GREETER_SOURCE);
    const mtimes = (): Record<string, number> => ({
      [greeterPath]: statSync(greeterPath).mtimeMs,
      [appPath]: statSync(appPath).mtimeMs,
    });

    // TCON-TOOL-0011: no apply — every mtime untouched, edit returned as data.
    const beforeNoApply = mtimes();
    const noApply = await javaRename(facade, { path: greeterPath, line: position.line, column: position.column, newName: "salute" });
    assert.equal(noApply.isError, false, `no-apply rename must succeed: ${JSON.stringify(noApply)}`);
    if (noApply.isError) throw new Error("unreachable");
    assert.equal(noApply.value.applied, false);
    assert.equal(noApply.value.files.length, 2, "the two-file rename must propose edits to both files as data");
    assert.deepEqual(mtimes(), beforeNoApply, "no-apply must leave every file's mtime untouched");

    // TCON-TOOL-0012: apply:false — same no-write outcome.
    const beforeFalse = mtimes();
    const falseApply = await javaRename(facade, { path: greeterPath, line: position.line, column: position.column, newName: "salute", apply: false });
    assert.equal(falseApply.isError, false);
    if (falseApply.isError) throw new Error("unreachable");
    assert.equal(falseApply.value.applied, false);
    assert.deepEqual(mtimes(), beforeFalse, "apply:false must leave every file's mtime untouched");

    // TCON-TOOL-0013: apply:true writes exactly the named files with the right content.
    const applied = await javaRename(facade, { path: greeterPath, line: position.line, column: position.column, newName: "salute", apply: true });
    assert.equal(applied.isError, false, `apply:true rename must succeed: ${JSON.stringify(applied)}`);
    if (applied.isError) throw new Error("unreachable");
    assert.equal(applied.value.applied, true);
    assert.equal(readFileSync(greeterPath, "utf8"), GREETER_SOURCE.replace("greet(", "salute("), "Greeter.java must reflect the declaration rename");
    assert.equal(readFileSync(appPath, "utf8"), APP_SOURCE.replace("g.greet(", "g.salute("), "App.java call site must reflect the rename");
  },
);
