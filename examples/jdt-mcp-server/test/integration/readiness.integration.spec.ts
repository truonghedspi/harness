// Traceability (harness/skills/test-design/SKILL.md, role: Test-Implementer).
//
// Conditions:   TCON-READY-0001, TCON-READY-0002, TCON-READY-0003
// Requirements: INV-READY-1, INV-READY-3
// Plan:         TP-READY-0001 | Feature: feat-prove-readiness
//
// Level 3 (process-boundary) oracle for the readiness gate's deadline path — the half navigation-
// tools does not exercise, because there the workspace always warms up. Here the workspace is one
// that can never become index-ready: it has no Java source, so the real probeSemanticIndex keeps
// answering "no known symbol" and the gate never opens. A real per-workspace pool spawns a real
// JDT LS, and the real readiness-gate is wired to its LspClient. The claim is INV-READY-1 + 3:
// every waiting call settles within its deadline with an explicit isError + progress payload,
// never a successful empty answer and never a hang past the deadline.
//
// X-001 is open, so the deadline is a parameter (env JDT_READY_DEADLINE_MS), not a hard-coded 30s.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import {
  createReadinessGate,
  WorkspaceNotReadyError,
  type ReadinessGate,
  type ReadinessTarget,
} from "../../src/workspace/readiness-gate.ts";
import { createWorkspacePool, type WorkspacePool } from "../../src/workspace/workspace-pool.ts";

const JDTLS_FIXTURE_HOME = path.resolve(".cache/jdtls-fixture/1.61.0.202607231254");
process.env.JDTLS_HOME = JDTLS_FIXTURE_HOME;

/** X-001 is open: the deadline is a test parameter, not a product constant. */
const DEADLINE_MS = Number.parseInt(process.env.JDT_READY_DEADLINE_MS ?? "1500", 10);
/** Margin over the deadline: the call must settle, not hang, but timers are not exact. */
const SETTLE_MARGIN_MS = 3_000;

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

/** A real JDT LS whose workspace has a pom.xml but NO Java source — it can never become ready. */
async function startNeverReadyWorkspace(
  t: AfterRegistrar,
): Promise<{ gate: ReadinessGate; workspaceId: string }> {
  const cleanup = cleanupStack(t);
  const root = mkdtempSync(path.join(tmpdir(), "jdt-ready-"));
  cleanup(() => rmSync(root, { recursive: true, force: true }));

  const projectRoot = path.join(root, "project");
  mkdirSync(projectRoot, { recursive: true });
  writeFileSync(
    path.join(projectRoot, "pom.xml"),
    "<project><modelVersion>4.0.0</modelVersion><groupId>fixture</groupId>" +
      "<artifactId>empty</artifactId><version>1</version></project>\n",
  );

  const pool: WorkspacePool = createWorkspacePool({ cacheRoot: path.join(root, "cache"), maxWorkspaces: 3 });
  cleanup(() => pool.close());

  const lease = await pool.acquire(projectRoot);
  cleanup(() => lease.release());
  const client = lease.client;
  assert.ok(client, "pool must return the real JDT LS LspClient");

  client.onRequest("workspace/configuration", (params) => {
    const items = (params as { items?: unknown[] } | undefined)?.items;
    return Array.from({ length: Array.isArray(items) ? items.length : 0 }, () => ({}));
  });
  client.onRequest("client/registerCapability", () => null);
  client.onRequest("window/workDoneProgress/create", () => null);

  const projectUri = pathToFileURL(projectRoot).href;
  await client.request("initialize", {
    processId: process.pid,
    rootUri: projectUri,
    workspaceFolders: [{ uri: projectUri, name: "empty" }],
    capabilities: {
      workspace: { configuration: true, workspaceFolders: true },
      textDocument: { publishDiagnostics: {} },
    },
  });
  client.notify("initialized", {});

  const targets = new Map<string, ReadinessTarget>();
  const gate: ReadinessGate = createReadinessGate({ resolveTarget: (id) => targets.get(id) });
  cleanup(() => gate.close());
  targets.set(lease.workspaceId, {
    workspaceId: lease.workspaceId,
    projectRoot,
    client,
  });

  return { gate, workspaceId: lease.workspaceId };
}

test(
  "INV-READY-1/3: every call against a never-ready workspace settles within its deadline with an explicit not-ready error, never an empty success",
  { timeout: 60_000 },
  async (t) => {
    const { gate, workspaceId } = await startNeverReadyWorkspace(t);

    // Three concurrent callers, dispatched together so none has settled before the others wait.
    const startedAt = Date.now();
    const results = await Promise.all(
      [0, 1, 2].map(async () => {
        try {
          await gate.awaitReady(workspaceId, { withinMs: DEADLINE_MS });
          return { settled: true, error: null as WorkspaceNotReadyError | null };
        } catch (error) {
          return { settled: false, error: error as WorkspaceNotReadyError };
        }
      }),
    );
    const elapsedMs = Date.now() - startedAt;

    // TCON-READY-0003 [INV-READY-1]: every settled outcome is an explicit error, never a success.
    for (const [index, outcome] of results.entries()) {
      assert.equal(outcome.settled, false, `caller ${index} succeeded — an empty ready result is exactly INV-READY-1's forbidden outcome`);
      assert.ok(
        outcome.error instanceof WorkspaceNotReadyError,
        `caller ${index} must fail with WorkspaceNotReadyError, got ${String(outcome.error)}`,
      );
      assert.equal(outcome.error.code, "not-ready");
      assert.equal(outcome.error.isError, true, "the outcome must be isError, not a successful result");
      assert.ok(
        outcome.error.progress.probeAttempts > 0,
        "the error must carry a progress payload showing the gate actually probed (probeAttempts > 0)",
      );
      assert.ok(
        outcome.error.progress.phase !== "ready",
        "the progress payload must describe a non-ready phase",
      );
    }

    // TCON-READY-0001 + 0002 [INV-READY-3]: all three settled within the deadline + margin — none
    // hung waiting for a workspace that can never become ready.
    assert.ok(
      elapsedMs < DEADLINE_MS + SETTLE_MARGIN_MS,
      `all ${results.length} callers must settle within ~${DEADLINE_MS}ms, they took ${elapsedMs}ms`,
    );
  },
);
