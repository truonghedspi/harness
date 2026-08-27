/*
 * Conditions: TCON-DIAG-0005, TCON-DIAG-0006
 * Requirements: INV-DIAG-3, INV-DIAG-1
 *
 * Hai khẳng định cùng phán xét MỘT thứ: identity của khoá (workspaceId, URI canonical).
 *   TCON-DIAG-0005 — hai workspaceId va vào CÙNG một URI canonical; chỉ workspace đã hấp thụ báo
 *                    cáo mới được phục vụ nó.
 *   TCON-DIAG-0006 — MỘT tệp vật lý cho ĐÚNG một mục trong câu trả lời phạm vi project, kể cả khi
 *                    người gọi viết URI qua symlink còn cache lưu theo đường dẫn thật.
 *
 * Một fixture, một JDT LS thật. Symlink thư mục <root>/link -> <root>/real tạo ra hai cách viết cho
 * cùng một tệp trên mọi host POSIX; fixture KHÔNG dựa vào khác biệt /var với /private/var của macOS.
 * Báo cáo đi qua đường notification thật (cache.attach), không có payload nào bị bơm tay vào cache.
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
  /** Đường dẫn THẬT (đã canonical) tới gốc project mà JDT LS được khởi tạo trên đó. */
  realProjectRoot: string;
  realSamplePath: string;
  realSampleUri: string;
  realUntouchedUri: string;
  /** Cùng những tệp đó nhưng viết qua symlink — cách viết của người gọi. */
  linkProjectRoot: string;
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

/** Chờ tới khi `read` trả về một giá trị khác undefined, hoặc hết hạn. */
function waitFor<T>(
  read: () => T | undefined | Promise<T | undefined>,
  detail: string,
  timeoutMs = 60_000,
): Promise<T> {
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

  // <root>/real giữ tệp thật; <root>/link là symlink thư mục trỏ vào nó. Hai cách viết, một tệp.
  const realRoot = path.join(root, "real");
  const realProjectRoot = path.join(realRoot, "proj");
  const sources = path.join(realProjectRoot, "src/main/java/fixture");
  mkdirSync(sources, { recursive: true });
  writeFileSync(
    path.join(realProjectRoot, "pom.xml"),
    "<project><modelVersion>4.0.0</modelVersion><groupId>fixture</groupId><artifactId>sample</artifactId><version>1</version></project>\n",
  );
  writeFileSync(path.join(sources, "Sample.java"), BROKEN);
  writeFileSync(path.join(sources, "Untouched.java"), CLEAN);
  symlinkSync(realRoot, path.join(root, "link"), "dir");

  const linkProjectRoot = path.join(root, "link", "proj");
  assert.notEqual(linkProjectRoot, realProjectRoot, "fixture phải có hai cách viết khác nhau");
  assert.equal(
    realpathSync(path.join(linkProjectRoot, "src/main/java/fixture/Sample.java")),
    path.join(sources, "Sample.java"),
    "hai cách viết phải trỏ vào đúng một tệp vật lý",
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
    realProjectRoot,
    realSamplePath: path.join(sources, "Sample.java"),
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
    /* tiến trình đã thoát */
  }
  fixture.child.kill("SIGKILL");
}

/** Facade phạm vi một tệp: workspace nào hỏi, URI nào được hỏi — hai thứ được điều khiển riêng. */
function fileFacade(workspaceId: string, uri: string): DiagnosticsFacade {
  return {
    workspace: async () => ({ status: "ready", workspaceId }),
    scopeOf: () => ({ kind: "file", uri }),
    projectFiles: () => [],
  };
}

/** Facade phạm vi project: người gọi viết MỌI tệp qua symlink. */
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
  assert.equal(result.isError, false, `java_diagnostics phải thành công: ${JSON.stringify(result)}`);
  return (result as { isError: false; value: DiagnosticsAnswer }).value;
}

/**
 * Các mục nói về CÙNG một tệp vật lý. Spec không chốt câu trả lời mang cách viết nào, nên cả hai
 * cách viết đều được tính; điều bị phán xét là SỐ LƯỢNG mục cho một tệp.
 */
function entriesForFile(
  answer: DiagnosticsAnswer,
  spellings: readonly string[],
): readonly FileDiagnostics[] {
  return answer.files.filter((file) => spellings.includes(file.uri));
}

test("khoá cache diagnostics là (workspaceId, tệp vật lý)", { timeout: 180_000 }, async (t) => {
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

  // Điều kiện tiên quyết: workspace A có một báo cáo THẬT, do JDT LS đẩy về qua cache.attach.
  const planted = await waitFor(async () => {
    const answer = await ask(
      fileFacade(WORKSPACE_A, fixture.realSampleUri),
      cache,
      fixture.realSamplePath,
    );
    const file = answer.files[0];
    return file?.status === "reported" && file.problems.length > 0 ? file : undefined;
  }, "báo cáo type-error thật của JDT LS cho Sample.java");
  assert.ok(
    planted.status === "reported" &&
      planted.problems.some((problem) => problem.message.includes("String") && problem.message.includes("int")),
    "fixture phải đứng trên một diagnostic thật, không phải một publish rỗng",
  );

  await t.test(
    "TCON-DIAG-0005: một workspace khác hỏi ĐÚNG URI đó vẫn đọc ra 'chưa báo cáo' [INV-DIAG-3]",
    async () => {
      const answer = await ask(
        fileFacade(WORKSPACE_B, fixture.realSampleUri),
        cache,
        fixture.realSamplePath,
      );

      assert.equal(answer.workspaceId, WORKSPACE_B, "câu trả lời phải thuộc về workspace đã hỏi");
      assert.equal(answer.files.length, 1, "phạm vi một tệp cho đúng một mục");
      assert.deepEqual(
        answer.files[0],
        { uri: fixture.realSampleUri, status: "not-reported" },
        "báo cáo hấp thụ dưới workspace A không bao giờ được phục vụ cho workspace B",
      );
    },
  );

  await t.test(
    "TCON-DIAG-0006: một tệp vật lý cho đúng một mục dù người gọi viết URI qua symlink [INV-DIAG-1]",
    async () => {
      const answer = await ask(
        projectFacade(WORKSPACE_A, fixture),
        cache,
        fixture.linkProjectRoot,
      );
      assert.equal(answer.scope, "project");

      const sample = entriesForFile(answer, [fixture.realSampleUri, fixture.linkSampleUri]);
      assert.equal(
        sample.length,
        1,
        `Sample.java là MỘT tệp vật lý nên phải cho đúng một mục; nhận được ${sample.length}: ${JSON.stringify(sample)}`,
      );
      const only = sample[0];
      assert.ok(only !== undefined && only.status === "reported", "mục duy nhất đó phải mang báo cáo thật");
      assert.ok(
        only.problems.some((problem) => problem.message.includes("String") && problem.message.includes("int")),
        "hợp nhất theo tệp vật lý không được làm mất problem đã publish",
      );

      // Vế còn lại của phép hợp: tệp project chưa từng có publish vẫn phải xuất hiện, đúng một lần.
      const untouched = entriesForFile(answer, [fixture.realUntouchedUri, fixture.linkUntouchedUri]);
      assert.equal(
        untouched.length,
        1,
        `Untouched.java cũng phải cho đúng một mục; nhận được ${untouched.length}: ${JSON.stringify(untouched)}`,
      );
    },
  );
});
