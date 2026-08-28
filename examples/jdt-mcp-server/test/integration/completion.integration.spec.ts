// Traceability (harness/skills/test-design/SKILL.md, role: Test-Implementer).
//
// Requirements: INV-TOOL-3
// Feature:      feat-prove-completion | Tool: src/tools/completion.ts (java_completion)
//
// Level 3 (process-boundary) oracle for INV-TOOL-3 on java_completion: a real completion round-trip
// through the real pool + real JDT LS + real tool layer against a fixture whose member count exceeds
// the configured cap, so the cap is exercised for real rather than simulated with a mocked LSP
// response. The claim: the result is truncated:true with the true total, never a silently-shortened
// list and never the full uncapped set.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { javaCompletion } from "../../src/tools/completion.ts";
import type { LspFacade, WorkspaceAvailability } from "../../src/tools/tool-layer.ts";
import { createReadinessGate, type ReadinessGate, type ReadinessTarget } from "../../src/workspace/readiness-gate.ts";
import { resolveWorkspace } from "../../src/workspace/project-router.ts";
import { createWorkspacePool, type WorkspacePool } from "../../src/workspace/workspace-pool.ts";

const JDTLS_FIXTURE_HOME = path.resolve(".cache/jdtls-fixture/1.61.0.202607231254");
process.env.JDTLS_HOME = JDTLS_FIXTURE_HOME;

const READY_DEADLINE_MS = 120_000;
/** Cap configured for the test — low enough that the fixture comfortably exceeds it. */
const CAP = 5;
/** Members generated in the fixture: comfortably above CAP, below the 200 default. */
const MEMBER_COUNT = 15;

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

/** A class with MEMBER_COUNT members and a `use()` body whose `this.` is the completion trigger. */
function buildFixtureSource(): { source: string; triggerLine: number; triggerColumn: number } {
  const lines = ["package fixture;", "public class Greeter {"];
  for (let i = 0; i < MEMBER_COUNT; i += 1) {
    lines.push(`    void alpha${i}() {}`);
  }
  lines.push("    void use() {");
  lines.push("        this.");
  lines.push("    }");
  lines.push("}");
  const source = lines.join("\n") + "\n";

  const triggerLine = lines.findIndex((line) => line.includes("this."));
  const column = lines[triggerLine]!.indexOf("this.") + "this.".length;
  // 1-based public coordinates.
  return { source, triggerLine: triggerLine + 1, triggerColumn: column + 1 };
}

test(
  "INV-TOOL-3: java_completion over a real JDT LS returns truncated:true with the true total, never a silent cut or the uncapped set",
  { timeout: 180_000 },
  async (t) => {
    const cleanup = cleanupStack(t);
    const root = mkdtempSync(path.join(tmpdir(), "jdt-compl-"));
    cleanup(() => rmSync(root, { recursive: true, force: true }));

    const projectRoot = path.join(root, "project");
    const sourcePath = path.join(projectRoot, "src/main/java/fixture/Greeter.java");
    mkdirSync(path.dirname(sourcePath), { recursive: true });
    writeFileSync(
      path.join(projectRoot, "pom.xml"),
      "<project><modelVersion>4.0.0</modelVersion><groupId>fixture</groupId><artifactId>compl</artifactId><version>1</version></project>\n",
    );
    const { source, triggerLine, triggerColumn } = buildFixtureSource();
    writeFileSync(sourcePath, source, "utf8");

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
      workspaceFolders: [{ uri: projectUri, name: "compl" }],
      capabilities: {
        workspace: { configuration: true, workspaceFolders: true },
        textDocument: { completion: { completionItem: { snippetSupport: false } }, publishDiagnostics: {} },
      },
    });
    client.notify("initialized", {});
    targets.set(lease.workspaceId, { workspaceId: lease.workspaceId, projectRoot: routed.projectRoot, client });
    client.notify("textDocument/didOpen", {
      textDocument: { uri: pathToFileURL(sourcePath).href, languageId: "java", version: 1, text: source },
    });

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

    const outcome = await javaCompletion(facade, { path: sourcePath, line: triggerLine, column: triggerColumn }, { cap: CAP });
    assert.equal(outcome.isError, false, `completion must succeed: ${JSON.stringify(outcome)}`);
    if (outcome.isError) throw new Error("unreachable");

    const answer = outcome.value;
    assert.equal(answer.cap, CAP);
    assert.equal(answer.items.length, CAP, "the result must be capped at the configured cap");
    assert.equal(answer.truncated, true, "a capped result must declare truncated:true");
    assert.ok(answer.total > CAP, `the true total (${answer.total}) must exceed the cap (${CAP}) — the fixture has ${MEMBER_COUNT} members`);
    assert.notEqual(answer.total, answer.items.length, "the true total must not equal the post-cut length");
  },
);
