/*
 * Conditions: TCON-DIAG-0001, TCON-DIAG-0002, TCON-DIAG-0003
 * Requirements: INV-DIAG-1, INV-DIAG-2, INV-DIAG-3
 */

import assert from "node:assert/strict";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

import { createDiagnosticsCache } from "../../src/lsp/diagnostics-cache.ts";
import { LspClient, type LspProcess } from "../../src/lsp/lsp-client.ts";
import {
  javaDiagnostics,
  type DiagnosticsAnswer,
  type DiagnosticsFacade,
} from "../../src/tools/diagnostics.ts";

const JDTLS_ROOT = path.resolve(".cache/jdtls-fixture");

interface LiveWorkspace {
  child: ChildProcessWithoutNullStreams;
  client: LspClient;
  projectRoot: string;
  sourcePath: string;
  sourceUri: string;
  workspaceId: string;
}

function locateJdtls(): string {
  const installs = readdirSync(JDTLS_ROOT, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(JDTLS_ROOT, entry.name));
  const install = installs.find((candidate) => existsSync(path.join(candidate, "plugins")));
  assert.ok(install, `a pinned JDT LS fixture must exist below ${JDTLS_ROOT}`);
  return install;
}

function facadeFor(workspace: LiveWorkspace): DiagnosticsFacade {
  return {
    workspace: async () => ({ status: "ready", workspaceId: workspace.workspaceId }),
    scopeOf: (candidate) => candidate === workspace.sourcePath
      ? { kind: "file", uri: workspace.sourceUri }
      : undefined,
    projectFiles: () => [workspace.sourceUri],
  };
}

async function answer(workspace: LiveWorkspace, cache: ReturnType<typeof createDiagnosticsCache>): Promise<DiagnosticsAnswer> {
  const result = await javaDiagnostics(facadeFor(workspace), cache, { path: workspace.sourcePath });
  assert.equal(result.isError, false, `java_diagnostics must succeed: ${JSON.stringify(result)}`);
  return result.value;
}

function waitFor<T>(read: () => T | undefined | Promise<T | undefined>, detail: string, timeoutMs = 30_000): Promise<T> {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + timeoutMs;
    const poll = async (): Promise<void> => {
      const value = await read();
      if (value !== undefined) return resolve(value);
      if (Date.now() >= deadline) return reject(new Error(`timed out waiting for ${detail}`));
      setTimeout(() => void poll(), 25);
    };
    void poll();
  });
}

async function startWorkspace(root: string, name: string, source: string): Promise<LiveWorkspace> {
  const install = locateJdtls();
  const plugins = path.join(install, "plugins");
  const launcher = readdirSync(plugins).find((file) => file.startsWith("org.eclipse.equinox.launcher_") && file.endsWith(".jar"));
  const configuration = ["config_mac_arm", "config_mac", "config_linux_arm", "config_linux", "config_win"]
    .map((candidate) => path.join(install, candidate))
    .find(existsSync);
  assert.ok(launcher, "the pinned fixture must contain an Equinox launcher jar");
  assert.ok(configuration, "the pinned fixture must contain a configuration for this host");

  const projectRoot = path.join(root, name);
  const sourcePath = path.join(projectRoot, "src/main/java/fixture/Sample.java");
  mkdirSync(path.dirname(sourcePath), { recursive: true });
  writeFileSync(path.join(projectRoot, "pom.xml"), "<project><modelVersion>4.0.0</modelVersion><groupId>fixture</groupId><artifactId>sample</artifactId><version>1</version></project>\n");
  writeFileSync(sourcePath, source);
  const dataDir = path.join(root, `data-${name}`);
  mkdirSync(dataDir, { recursive: true });

  const child = spawn("java", [
    "-Declipse.application=org.eclipse.jdt.ls.core.id1",
    "-Dosgi.bundles.defaultStartLevel=4",
    "-Declipse.product=org.eclipse.jdt.ls.core.product",
    "-Dlog.level=ERROR",
    "-Xmx512m",
    "--add-modules=ALL-SYSTEM",
    "--add-opens", "java.base/java.util=ALL-UNNAMED",
    "--add-opens", "java.base/java.lang=ALL-UNNAMED",
    "-jar", path.join(plugins, launcher),
    "-configuration", configuration,
    "-data", dataDir,
  ], { stdio: ["pipe", "pipe", "pipe"] });
  const client = new LspClient(child as unknown as LspProcess);
  client.onRequest("workspace/configuration", (params) => {
    const count = Array.isArray((params as { items?: unknown[] } | undefined)?.items)
      ? (params as { items: unknown[] }).items.length
      : 0;
    return Array.from({ length: count }, () => ({}));
  });
  client.onRequest("client/registerCapability", () => null);
  client.onRequest("window/workDoneProgress/create", () => null);

  const projectUri = pathToFileURL(projectRoot).href;
  await client.request("initialize", {
    processId: process.pid,
    rootUri: projectUri,
    workspaceFolders: [{ uri: projectUri, name }],
    capabilities: { workspace: { configuration: true, workspaceFolders: true }, textDocument: { publishDiagnostics: {} } },
  });
  return { child, client, projectRoot, sourcePath, sourceUri: pathToFileURL(sourcePath).href, workspaceId: name };
}

function stop(workspace: LiveWorkspace): void {
  try { workspace.client.notify("exit"); } catch { /* process already exited */ }
  workspace.child.kill("SIGKILL");
}

function openDocument(workspace: LiveWorkspace, text: string): void {
  workspace.client.notify("textDocument/didOpen", {
    textDocument: { uri: workspace.sourceUri, languageId: "java", version: 1, text },
  });
}

const BROKEN = "package fixture; public class Sample { int value = \"wrong\"; }\n";
const CLEAN = "package fixture; public class Sample { int value = 1; }\n";

test("TCON-DIAG-0001: not-reported remains distinct from the first live clean publish", { timeout: 45_000 }, async (t) => {
  const root = mkdtempSync(path.join(tmpdir(), "jdt-diag-one-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const workspace = await startWorkspace(root, "one", CLEAN);
  t.after(() => stop(workspace));
  const cache = createDiagnosticsCache();
  cache.attach(workspace.workspaceId, workspace.client);

  const before = (await answer(workspace, cache)).files[0];
  assert.deepEqual(before, { uri: workspace.sourceUri, status: "not-reported" });

  workspace.client.notify("initialized", {});
  openDocument(workspace, CLEAN);
  const clean = await waitFor(async () => {
    const file = (await answer(workspace, cache)).files[0];
    return file?.status === "reported" && file.problems.length === 0 ? file : undefined;
  }, "JDT LS's first clean publish");
  assert.equal(clean.status, "reported");
  assert.ok("problems" in clean);
  assert.notDeepEqual(clean, before);
});

test("TCON-DIAG-0002: a later empty live publish fully replaces an earlier diagnostic", { timeout: 60_000 }, async (t) => {
  const root = mkdtempSync(path.join(tmpdir(), "jdt-diag-replace-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const workspace = await startWorkspace(root, "replace", BROKEN);
  t.after(() => stop(workspace));
  const cache = createDiagnosticsCache();
  cache.attach(workspace.workspaceId, workspace.client);
  workspace.client.notify("initialized", {});
  openDocument(workspace, BROKEN);

  const broken = await waitFor(async () => {
    const file = (await answer(workspace, cache)).files[0];
    return file?.status === "reported" && file.problems.length > 0 ? file : undefined;
  }, "the planted type-error diagnostic");
  assert.ok(broken.problems.some((problem) => problem.message.includes("String") && problem.message.includes("int")));

  writeFileSync(workspace.sourcePath, CLEAN);
  workspace.client.notify("textDocument/didChange", { textDocument: { uri: workspace.sourceUri, version: 2 }, contentChanges: [{ text: CLEAN }] });
  const cleared = await waitFor(async () => {
    const file = (await answer(workspace, cache)).files[0];
    return file?.status === "reported" && file.problems.length === 0 ? file : undefined;
  }, "the replacement empty publish");
  assert.deepEqual(cleared.problems, []);
});

test("TCON-DIAG-0003: two live JDT LS instances never cross-serve a diagnostic for the same relative path", { timeout: 75_000 }, async (t) => {
  const root = mkdtempSync(path.join(tmpdir(), "jdt-diag-isolation-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const [a, b] = await Promise.all([
    startWorkspace(root, "workspace-a", BROKEN),
    startWorkspace(root, "workspace-b", CLEAN),
  ]);
  t.after(() => { stop(a); stop(b); });
  const cache = createDiagnosticsCache();
  cache.attach(a.workspaceId, a.client);
  cache.attach(b.workspaceId, b.client);
  a.client.notify("initialized", {});
  b.client.notify("initialized", {});
  openDocument(a, BROKEN);
  openDocument(b, CLEAN);

  const aReport = await waitFor(async () => {
    const file = (await answer(a, cache)).files[0];
    return file?.status === "reported" && file.problems.length > 0 ? file : undefined;
  }, "workspace A's planted diagnostic");
  const bReport = await waitFor(async () => {
    const file = (await answer(b, cache)).files[0];
    return file?.status === "reported" ? file : undefined;
  }, "workspace B's own publish");

  assert.ok(aReport.problems.some((problem) => problem.message.includes("String") && problem.message.includes("int")));
  assert.deepEqual(bReport.problems, [], "workspace B's clean file must not receive workspace A's type error");
  assert.notEqual(a.child.pid, b.child.pid, "the fixture must use two distinct live JDT LS processes");
});

test("TCON-DIAG-0004: a query carrying workspace B's id but A's file URI is not-reported, never A's report", { timeout: 75_000 }, async (t) => {
  const root = mkdtempSync(path.join(tmpdir(), "jdt-diag-crosskey-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const [a, b] = await Promise.all([
    startWorkspace(root, "workspace-a", BROKEN),
    startWorkspace(root, "workspace-b", CLEAN),
  ]);
  t.after(() => { stop(a); stop(b); });
  const cache = createDiagnosticsCache();
  cache.attach(a.workspaceId, a.client);
  cache.attach(b.workspaceId, b.client);
  a.client.notify("initialized", {});
  b.client.notify("initialized", {});
  openDocument(a, BROKEN);
  openDocument(b, CLEAN);

  await waitFor(async () => {
    const file = (await answer(a, cache)).files[0];
    return file?.status === "reported" && file.problems.length > 0 ? file : undefined;
  }, "workspace A's planted diagnostic");

  // The discriminating seam the checker named: the cache key is (workspaceId, URI), so a query that
  // carries B's id but A's URI must NOT resolve A's report — a flat URI-only cache (m1) or a
  // cross-workspace scan (m2) would hand A's report back here.
  const crossFacade: DiagnosticsFacade = {
    workspace: async () => ({ status: "ready", workspaceId: b.workspaceId }),
    scopeOf: (candidate) => (candidate === a.sourcePath ? { kind: "file", uri: a.sourceUri } : undefined),
    projectFiles: () => [],
  };
  const cross = await javaDiagnostics(crossFacade, cache, { path: a.sourcePath });
  assert.equal(cross.isError, false, `java_diagnostics must succeed: ${JSON.stringify(cross)}`);
  if (cross.isError) throw new Error("unreachable");
  assert.deepEqual(
    cross.value.files,
    [{ uri: a.sourceUri, status: "not-reported" }],
    "workspace B must never serve a diagnostic published by workspace A, even for A's own file URI",
  );
});
