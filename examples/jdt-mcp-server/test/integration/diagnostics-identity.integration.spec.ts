/*
 * Conditions: TCON-DIAG-0005, TCON-DIAG-0006
 * Requirements: INV-DIAG-3, INV-DIAG-1
 *
 * The two assertions evaluate the same thing: the identity of the key (workspaceId, canonical URI).
 * TCON-DIAG-0005 — two workspaceIds hitting the SAME canonical URI; Only the workspace has absorbed the report
 * the fox can only serve it.
 * TCON-DIAG-0006 — ONE physical file gives EXACTLY one entry in the project scope answer, even if
 * The caller writes the URI via symlink and the cache stores the actual path.
 *
 * One fixture, one real JDT LS. Symlink directory <root>/link -> <root>/real produces two writing methods
 * same file on all POSIX hosts; fixture does NOT rely on the difference between /var and /private/var of macOS.
 * The report goes through the real notification path (cache.attach), no payload is manually pumped into the cache.
 */

import assert from "node:assert/strict";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

import { createDiagnosticsCache, type DiagnosticsCache } from "../../src/lsp/diagnostics-cache.ts";
import { LspClient, type LspProcess } from "../../src/lsp/lsp-client.ts";
import {
  javaDiagnostics,
  type DiagnosticsAnswer,
  type DiagnosticsFacade,
  type FileDiagnostics,
} from "../../src/tools/diagnostics.ts";

const JDTLS_ROOT = path.resolve(".cache/jdtls-fixture");

const WORKSPACE_A = "workspace-a";
const WORKSPACE_B = "workspace-b";

const BROKEN = "package fixture; public class Sample { int value = \"wrong\"; }\n";
const CLEAN = "package fixture; public class Untouched { int value = 1; }\n";

interface LiveFixture {
  child: ChildProcessWithoutNullStreams;
  client: LspClient;
  /** TRUE (canonical) path to the project root on which JDT LS was initialized. */
  realProjectRoot: string;
  realSamplePath: string;
  realSampleUri: string;
  realUntouchedUri: string;
  /** Same files but written via symlink — caller's writing. */linkProjectRoot: string;
  linkSampleUri: string;
  linkUntouchedUri: string;
}

function locateJdtls(): string {
  const installs = readdirSync(JDTLS_ROOT, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(JDTLS_ROOT, entry.name));
  const install = installs.find((candidate) => existsSync(path.join(candidate, "plugins")));
  assert.ok(install, `a pinned JDT LS fixture must exist below ${JDTLS_ROOT}`);
  return install;
}

/** Waits until `read` returns a value other than undefined, or expires. */
function waitFor<T>(
  read: () => T | undefined | Promise<T | undefined>,
  detail: string,
  timeoutMs = 60_000,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + timeoutMs;
    const poll = async(): Promise<void> => {
      const value = await read();
      if (value !== undefined) return resolve(value);
      if (Date.now() >= deadline) return reject(new Error(`timed out waiting for ${detail}`));
      setTimeout(() => void poll(), 25);
    };
    void poll();
  });
}

async function startFixture(root: string): Promise<LiveFixture> {
  const install = locateJdtls();
  const plugins = path.join(install, "plugins");
  const launcher = readdirSync(plugins).find(
    (file) => file.startsWith("org.eclipse.equinox.launcher_") && file.endsWith(".jar"),
  );
  const configuration = ["config_mac_arm", "config_mac", "config_linux_arm", "config_linux", "config_win"]
    .map((candidate) => path.join(install, candidate))
    .find(existsSync);
  assert.ok(launcher, "the pinned fixture must contain an Equinox launcher jar");
  assert.ok(configuration, "the pinned fixture must contain a configuration for this host");

  // <root>/real holds the real file; <root>/link is the directory symlink pointing to it. Two ways to write, one file.
  const realRoot = path.join(root, "real");
  const realProjectRoot = path.join(realRoot, "proj");
  const sources = path.join(realProjectRoot, "src/main/java/fixture");
  mkdirSync(sources, { recursive: true });
  writeFileSync(
    path.join(realProjectRoot, "pom.xml"),"<project><modelVersion>4.0.0</modelVersion><groupId>fixture</groupId><artifactId>sample</artifactId><version>1</version></project>\n",
  );
  writeFileSync(path.join(sources, "Sample.java"), BROKEN);
  writeFileSync(path.join(sources, "Untouched.java"), CLEAN);
  symlinkSync(realRoot, path.join(root, "link"), "dir");

  const linkProjectRoot = path.join(root, "link", "proj");
  assert.notEqual(linkProjectRoot, realProjectRoot, "fixture must have two different spellings");
  assert.equal(
    realpathSync(path.join(linkProjectRoot, "src/main/java/fixture/Sample.java")),
    path.join(sources, "Sample.java"),
    "the two spellings must point to exactly the same physical file",
  );

  const dataDir = path.join(root, "data");
  mkdirSync(dataDir, { recursive: true });

  const child = spawn(
    "java",
    [
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
    ],
    { stdio: ["pipe", "pipe", "pipe"] },
  );
  const client = new LspClient(child as unknown as LspProcess);
  client.onRequest("workspace/configuration", (params) => {
    const count = Array.isArray((params as { items?: unknown[] } | undefined)?.items)
      ? (params as { items: unknown[] }).items.length
      : 0;
    return Array.from({ length: count }, () => ({}));
  });
  client.onRequest("client/registerCapability", () => null);
  client.onRequest("window/workDoneProgress/create", () => null);

  const projectUri = pathToFileURL(realProjectRoot).href;
  await client.request("initialize", {
    processId: process.pid,
    rootUri: projectUri,
    workspaceFolders: [{ uri: projectUri, name: WORKSPACE_A }],
    capabilities: {
      workspace: { configuration: true, workspaceFolders: true },
      textDocument: { publishDiagnostics: {} },
    },
  });

  return {
    child,
    client,
    realProjectRoot,realSamplePath: path.join(sources, "Sample.java"),
    realSampleUri: pathToFileURL(path.join(sources, "Sample.java")).href,
    realUntouchedUri: pathToFileURL(path.join(sources, "Untouched.java")).href,
    linkProjectRoot,
    linkSampleUri: pathToFileURL(path.join(linkProjectRoot, "src/main/java/fixture/Sample.java")).href,
    linkUntouchedUri: pathToFileURL(path.join(linkProjectRoot, "src/main/java/fixture/Untouched.java")).href,
  };
}

function stop(fixture: LiveFixture): void {
  try {
    fixture.client.notify("exit");
  } catch {
    /* process exited */
  }
  fixture.child.kill("SIGKILL");
}

/** Facade scopes a file: which workspace asks, which URI is asked — the two are controlled separately. */
function fileFacade(workspaceId: string, uri: string): DiagnosticsFacade {
  return {
    workspace: async () => ({ status: "ready", workspaceId }),
    scopeOf: () => ({ kind: "file", uri }),
    projectFiles: () => [],
  };
}

/** Project scope facade: caller writes EVERY file via symlink. */
function projectFacade(workspaceId: string, fixture: LiveFixture): DiagnosticsFacade {
  return {
    workspace: async () => ({ status: "ready", workspaceId }),
    scopeOf: (candidate) =>
      candidate === fixture.linkProjectRoot ? { kind: "project" } : undefined,
    projectFiles: () => [fixture.linkSampleUri, fixture.linkUntouchedUri],
  };
}

async function ask(
  facade: DiagnosticsFacade,
  cache: DiagnosticsCache,
  requestPath: string,
): Promise<DiagnosticsAnswer> {
  const result = await javaDiagnostics(facade, cache, { path: requestPath });
  assert.equal(result.isError, false, `java_diagnostics must succeed: ${JSON.stringify(result)}`);
  return (result as { isError: false; value: DiagnosticsAnswer }).value;
}

/**
 * Entries refer to the SAME physical file. Spec doesn't specify which spelling to answer, so it's both
 * spelling counts; what is judged is the NUMBER of entries for a file.
 */
function entriesForFile(
  answer: DiagnosticsAnswer,
  spellings: readonly string[],
): readonly FileDiagnostics[] {
  return answer.files.filter((file) => spellings.includes(file.uri));
}test("diagnostics cache key is (workspaceId, physical file)", { timeout: 180_000 }, async (t) => {
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), "jdt-diag-identity-")));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const fixture = await startFixture(root);
  t.after(() => stop(fixture));

  const cache = createDiagnosticsCache();
  cache.attach(WORKSPACE_A, fixture.client);
  fixture.client.notify("initialized", {});
  fixture.client.notify("textDocument/didOpen", {
    textDocument: { uri: fixture.realSampleUri, languageId: "java", version: 1, text: BROKEN },
  });

  // Prerequisite: workspace A has a REAL report, pushed back by JDT LS via cache.attach.
  const planted = await waitFor(async () => {
    const answer = await ask(
      fileFacade(WORKSPACE_A, fixture.realSampleUri),
      cache,
      fixture.realSamplePath,
    );
    const file = response.files[0];
    return file?.status === "reported" && file.problems.length > 0 ? file : undefined;
  }, "JDT LS true type-error report for Sample.java");
  assert.ok(
    planted.status === "reported" &&
      planted.problems.some((problem) => problem.message.includes("String") && problem.message.includes("int")),
    "fixture must be on a real diagnostic, not an empty publication",
  );

  await t.test(
    "TCON-DIAG-0005: another workspace asks TRUE that URI still reads 'unreported' [INV-DIAG-3]",
    async() => {
      const answer = await ask(
        fileFacade(WORKSPACE_B, fixture.realSampleUri),
        cache,
        fixture.realSamplePath,
      );

      assert.equal(answer.workspaceId, WORKSPACE_B, "the answer must belong to the asked workspace");
      assert.equal(answer.files.length, 1, "range of one file to exactly one item");
      assert.deepEqual(
        answer.files[0],
        { uri: fixture.realSampleUri, status: "not-reported" },
        "reports absorbed under workspace A are never served to workspace B",
      );
    },
  );

  await t.test(
    "TCON-DIAG-0006: a physical file gives exactly one entry even though the caller wrote the URI via symlink [INV-DIAG-1]",
    async() => {
      const answer = await ask(projectFacade(WORKSPACE_A, fixture),
        cache,
        fixture.linkProjectRoot,
      );
      assert.equal(answer.scope, "project");

      const sample = entriesForFile(answer, [fixture.realSampleUri, fixture.linkSampleUri]);
      assert.equal(
        sample.length,
        1,
        `Sample.java is ONE physical file so it must give exactly one entry; get ${sample.length}: ${JSON.stringify(sample)}`,
      );
      const only = sample[0];
      assert.ok(only !== undefined && only.status === "reported", "the only item that must carry a true report");
      assert.ok(
        only.problems.some((problem) => problem.message.includes("String") && problem.message.includes("int")),
        "merging by physical file must not destroy the published problem",
      );

      // The remaining part of the union: the project file that has never been published must still appear, exactly once.
      const untouched = entriesForFile(answer, [fixture.realUntouchedUri, fixture.linkUntouchedUri]);
      assert.equal(
        untouched.length,
        1,
        `Untouched.java must also return exactly one item; get ${untouched.length}: ${JSON.stringify(untouched)}`,
      );
    },
  );
});