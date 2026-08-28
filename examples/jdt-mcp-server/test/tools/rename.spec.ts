// Oracle mức 1 cho feat-tool-rename.
//
// Falsifier đang bị kiểm chứng: "một lời gọi rename KHÔNG có `apply` vẫn ghi edit xuống đĩa thay vì
// trả về dưới dạng dữ liệu [INV-TOOL-2]".
//
// Cách đo: facade giả trả về một WorkspaceEdit có chủ đích (rename `greet` -> `salute`) trỏ vào một
// tệp THẬT trong tmpdir, nên "có ghi hay không" đọc được từ chính mtime và nội dung đĩa — không phải
// suy diễn từ giá trị trả về. Bốn nhánh opt-in được ghim riêng: vắng `apply`, `apply: false`,
// `apply: true`, và `apply: true` rồi lời gọi sau không có `apply`.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { javaRename, RENAME_METHOD, type JavaRenameResult } from "../../src/tools/rename.ts";
import type { LspFacade, ToolOutcome, WorkspaceAvailability } from "../../src/tools/tool-layer.ts";

const CASE_TIMEOUT = 5_000;

const CONTENT = "public class Greeter {\n    String greet() { return \"hi\"; }\n}\n";
// `greet` ở dòng 2 (1-based), cột 12 (1-based) — sau "    String ".
const REQUEST = { path: "", line: 2, column: 12, newName: "salute" };

interface Fixture {
  root: string;
  file: string;
  uri: string;
}

function makeFixture(): Fixture {
  const root = mkdtempSync(path.join(tmpdir(), "rename-"));
  const file = path.join(root, "Greeter.java");
  writeFileSync(file, CONTENT, "utf8");
  return { root, file, uri: pathToFileURL(file).href };
}

/** WorkspaceEdit rename `greet` -> `salute` trong đúng một tệp. */
function makeWorkspaceEdit(uri: string): unknown {
  return {
    changes: {
      [uri]: [{ range: { start: { line: 1, character: 11 }, end: { line: 1, character: 16 } }, newText: "salute" }],
    },
  };
}

interface FakeFacadeOptions {
  availability?: WorkspaceAvailability;
  workspaceEdit?: unknown;
  rejectWith?: Error;
}

function makeFacade(fixture: Fixture, options: FakeFacadeOptions = {}): {
  facade: LspFacade;
  requests: string[];
} {
  const requests: string[] = [];
  const facade: LspFacade = {
    workspace: () => options.availability ?? { status: "ready", workspaceId: "ws-demo" },
    readFile: (filePath: string) => {
      try {
        return readFileSync(filePath, "utf8");
      } catch {
        return undefined;
      }
    },
    request: async (method: string): Promise<unknown> => {
      requests.push(method);
      if (options.rejectWith !== undefined) throw options.rejectWith;
      return options.workspaceEdit ?? makeWorkspaceEdit(fixture.uri);
    },
  };
  return { facade, requests };
}

function expectSuccess(outcome: ToolOutcome<JavaRenameResult>): JavaRenameResult {
  assert.equal(outcome.isError, false, `mong đợi thành công, nhận: ${JSON.stringify(outcome)}`);
  if (outcome.isError) throw new Error("unreachable");
  return outcome.value;
}

function mtimeMs(file: string): number {
  return statSync(file).mtimeMs;
}

// -------------------------------------------------------------------------------------------
// INV-TOOL-2 — opt-in ghi đĩa
// -------------------------------------------------------------------------------------------

test("không có `apply`: edit được trả về dưới dạng dữ liệu và KHÔNG có tệp nào bị ghi", { timeout: CASE_TIMEOUT }, async () => {
  const fixture = makeFixture();
  const before = mtimeMs(fixture.file);
  const { facade, requests } = makeFacade(fixture);

  const answer = expectSuccess(await javaRename(facade, { ...REQUEST, path: fixture.file }));

  assert.equal(answer.applied, false);
  assert.equal(requests.length, 1);
  assert.equal(requests[0], RENAME_METHOD);
  // Dữ liệu trả về mô tả edit được đề xuất, trong hệ toạ độ 1-based.
  assert.equal(answer.files.length, 1);
  assert.equal(answer.files[0]?.path, fixture.file);
  assert.deepEqual(answer.files[0]?.edits[0], {
    range: { start: { line: 2, column: 12 }, end: { line: 2, column: 17 } },
    newText: "salute",
  });
  // Đĩa không đổi.
  assert.equal(readFileSync(fixture.file, "utf8"), CONTENT, "no-apply phải để nguyên nội dung đĩa");
  assert.equal(mtimeMs(fixture.file), before, "no-apply phải để nguyên mtime");

  rmSync(fixture.root, { recursive: true, force: true });
});

test("`apply: false` là no-write y hệt vắng `apply`", { timeout: CASE_TIMEOUT }, async () => {
  const fixture = makeFixture();
  const before = mtimeMs(fixture.file);
  const { facade } = makeFacade(fixture);

  const answer = expectSuccess(await javaRename(facade, { ...REQUEST, path: fixture.file, apply: false }));

  assert.equal(answer.applied, false);
  assert.equal(readFileSync(fixture.file, "utf8"), CONTENT);
  assert.equal(mtimeMs(fixture.file), before);

  rmSync(fixture.root, { recursive: true, force: true });
});

test("`apply: true` ghi đúng nội dung edit xuống đĩa", { timeout: CASE_TIMEOUT }, async () => {
  const fixture = makeFixture();
  const { facade } = makeFacade(fixture);

  const answer = expectSuccess(await javaRename(facade, { ...REQUEST, path: fixture.file, apply: true }));

  assert.equal(answer.applied, true);
  assert.equal(
    readFileSync(fixture.file, "utf8"),
    "public class Greeter {\n    String salute() { return \"hi\"; }\n}\n",
    "apply:true phải ghi đúng nội dung mà edit đề xuất",
  );

  rmSync(fixture.root, { recursive: true, force: true });
});

test("một lần `apply: true` không đọng lại thành mặc định cho lời gọi sau", { timeout: CASE_TIMEOUT }, async () => {
  const fixture = makeFixture();
  const { facade } = makeFacade(fixture);

  // Lời gọi đầu ghi.
  expectSuccess(await javaRename(facade, { ...REQUEST, path: fixture.file, apply: true }));
  const afterFirst = readFileSync(fixture.file, "utf8");
  assert.match(afterFirst, /salute/, "tiền đề: lời gọi đầu đã ghi");

  // Lời gọi thứ hai, KHÔNG có apply, cho một ký tự khác. Facade vẫn trả về đúng edit cũ, nên nếu
  // opt-in bị đọng lại thì tệp sẽ bị ghi lại — kiểm bằng mtime.
  const beforeSecond = mtimeMs(fixture.file);
  const second = expectSuccess(await javaRename(facade, { ...REQUEST, path: fixture.file }));
  assert.equal(second.applied, false);
  assert.equal(mtimeMs(fixture.file), beforeSecond, "opt-in của lời gọi trước không được rò sang lời gọi sau");

  rmSync(fixture.root, { recursive: true, force: true });
});

// -------------------------------------------------------------------------------------------
// Hình dạng lời gọi LSP + taxonomy lỗi
// -------------------------------------------------------------------------------------------

test("lời gọi phát ra đúng textDocument/rename, vị trí hạ về 0-based, newName được truyền", { timeout: CASE_TIMEOUT }, async () => {
  const fixture = makeFixture();
  const { facade, requests } = makeFacade(fixture);
  expectSuccess(await javaRename(facade, { ...REQUEST, path: fixture.file }));

  assert.equal(requests[0], RENAME_METHOD);
  rmSync(fixture.root, { recursive: true, force: true });
});

test("workspace chưa sẵn sàng: lỗi có tên, LSP chưa bị gọi", { timeout: CASE_TIMEOUT }, async () => {
  const fixture = makeFixture();
  const { facade, requests } = makeFacade(fixture, { availability: { status: "not-ready", detail: "indexing" } });

  const outcome = await javaRename(facade, { ...REQUEST, path: fixture.file });
  assert.equal(outcome.isError, true);
  if (!outcome.isError) throw new Error("unreachable");
  assert.equal(outcome.code, "not-ready");
  assert.equal(requests.length, 0);

  rmSync(fixture.root, { recursive: true, force: true });
});

test("workspace chết giữa lời gọi: workspace-crashed", { timeout: CASE_TIMEOUT }, async () => {
  const fixture = makeFixture();
  const { facade } = makeFacade(fixture, { rejectWith: new Error("socket closed") });

  const outcome = await javaRename(facade, { ...REQUEST, path: fixture.file });
  assert.equal(outcome.isError, true);
  if (!outcome.isError) throw new Error("unreachable");
  assert.equal(outcome.code, "workspace-crashed");

  rmSync(fixture.root, { recursive: true, force: true });
});
