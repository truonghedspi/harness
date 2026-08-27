// Oracle cho phần nối dây production của đường notification (feat-tool-layer-core, quyết định của
// feature-planner 2026-08-23 lượt 2).
//
// Bất biến vòng đời đang bị kiểm chứng: `diagnostics-cache.attach()` và sink của `file-sync-watcher`
// chạy ĐÚNG MỘT LẦN cho mỗi tiến trình JDT LS — ngay sau khi pool spawn — chứ không phải một lần cho
// mỗi lease. Một tiến trình ấm phục vụ nhiều lease, nên attach theo lease làm mảng handler của
// LspClient dài thêm sau mỗi lời gọi tool: một rò rỉ tăng tuyến tính theo lưu lượng, và không lời
// gọi nào gỡ được đăng ký của lời gọi trước.
//
// Đối xứng: hàm detach chạy đúng một lần lúc evict, và sau đó cache thôi hấp thụ. Chỉ `forget()` là
// chưa đủ — một handler còn sống sẽ dựng lại mục vừa bị xoá ngay ở publish kế tiếp, nên ca cuối
// publish thêm một lần SAU evict. Thứ được chứng minh là CẢ HAI việc phải chạy; thứ tự giữa
// `detach()` và `forget()` thì không, vì `detach` hiện là một phép lật cờ đồng bộ.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  createWorkspacePool,
  diagnosticsAttachment,
  type SpawnWorkspaceArgs,
  type SpawnedWorkspace,
  type WorkspaceAttachContext,
} from "../../src/workspace/workspace-pool.ts";
import {
  createDiagnosticsCache,
  PUBLISH_DIAGNOSTICS_METHOD,
} from "../../src/lsp/diagnostics-cache.ts";
import { attachFileSync, type FileSyncWatcher } from "../../src/workspace/file-sync-watcher.ts";

/**
 * Một LspClient giả có định tuyến notification thật: `handlers` là đại lượng mà bất biến
 * một-attach-một-client được đo trên đó — nó phải dừng ở 1 dù có bao nhiêu lease đi qua.
 */
class FakeClient {
  public readonly handlers = new Map<string, Array<(params: unknown) => void>>();
  public readonly sent: Array<{ method: string; params: unknown }> = [];

  public onNotification(method: string, handler: (params: unknown) => void): () => void {
    const list = this.handlers.get(method) ?? [];
    list.push(handler);
    this.handlers.set(method, list);
    return () => {
      const current = this.handlers.get(method) ?? [];
      const index = current.indexOf(handler);
      if (index >= 0) current.splice(index, 1);
    };
  }

  public notify(method: string, params?: unknown): void {
    this.sent.push({ method, params });
  }

  public publish(method: string, params: unknown): void {
    for (const handler of [...(this.handlers.get(method) ?? [])]) handler(params);
  }

  public handlerCount(method: string): number {
    return (this.handlers.get(method) ?? []).length;
  }
}

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
}

function deferred<T = void>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

function makeProject(root: string, name: string): string {
  const projectRoot = path.join(root, name);
  mkdirSync(path.join(projectRoot, "src", "main", "java"), { recursive: true });
  return projectRoot;
}

function makeSpawner(): {
  spawnWorkspace: (args: SpawnWorkspaceArgs) => Promise<SpawnedWorkspace>;
  clients: FakeClient[];
  stops: number;
} {
  const state = { clients: [] as FakeClient[], stops: 0 };
  let nextPid = 7_100;
  return {
    clients: state.clients,
    get stops(): number {
      return state.stops;
    },
    spawnWorkspace: async (): Promise<SpawnedWorkspace> => {
      const client = new FakeClient();
      state.clients.push(client);
      return {
        pid: nextPid++,
        client: client as unknown as SpawnedWorkspace["client"],
        stop: async () => {
          state.stops += 1;
        },
      };
    },
  };
}

test(
  "diagnostics attach chạy đúng một lần cho mỗi tiến trình, không phải một lần cho mỗi lease",
  { timeout: 10_000 },
  async (t) => {
    const root = mkdtempSync(path.join(tmpdir(), "jdt-attach-once-"));
    t.after(() => rmSync(root, { recursive: true, force: true }));
    const projectRoot = makeProject(root, "alpha");
    const spawner = makeSpawner();

    const attachCalls: string[] = [];
    const contexts: WorkspaceAttachContext[] = [];
    const cache = createDiagnosticsCache();
    const recordingCache = {
      attach: (workspaceId: string, source: Parameters<typeof cache.attach>[1]) => {
        attachCalls.push(workspaceId);
        return cache.attach(workspaceId, source);
      },
      forget: (workspaceId: string) => cache.forget(workspaceId),
    };

    const pool = createWorkspacePool({
      cacheRoot: path.join(root, "cache"),
      maxWorkspaces: 3,
      spawnWorkspace: spawner.spawnWorkspace,
      attachments: [
        diagnosticsAttachment(recordingCache),
        (context) => {
          contexts.push(context);
        },
      ],
    });
    t.after(() => pool.close());

    // Năm vòng acquire/release trên cùng một dự án: đây là hình dạng của năm lời gọi tool liên tiếp.
    for (let index = 0; index < 5; index += 1) {
      const lease = await pool.acquire(projectRoot);
      await lease.release();
    }

    assert.equal(spawner.clients.length, 1, "năm lease phải dùng chung một tiến trình JDT LS ấm");
    assert.equal(
      attachCalls.length,
      1,
      `cache.attach() phải chạy đúng một lần cho mỗi tiến trình, đã chạy ${attachCalls.length} lần`,
    );
    assert.equal(
      spawner.clients[0].handlerCount(PUBLISH_DIAGNOSTICS_METHOD),
      1,
      "mảng handler của client không được dài thêm sau mỗi lease",
    );
    assert.equal(contexts.length, 1, "mọi attachment đều theo vòng đời tiến trình, không theo lease");
    assert.equal(
      contexts[0].client,
      spawner.clients[0] as unknown as WorkspaceAttachContext["client"],
      "attachment phải nhận đúng client của tiến trình vừa spawn",
    );
  },
);

test(
  "hai dự án khác nhau được attach riêng, mỗi tiến trình đúng một lần",
  { timeout: 10_000 },
  async (t) => {
    const root = mkdtempSync(path.join(tmpdir(), "jdt-attach-two-"));
    t.after(() => rmSync(root, { recursive: true, force: true }));
    const alpha = makeProject(root, "alpha");
    const beta = makeProject(root, "beta");
    const spawner = makeSpawner();
    const attachCalls: string[] = [];
    const cache = createDiagnosticsCache();

    const pool = createWorkspacePool({
      cacheRoot: path.join(root, "cache"),
      maxWorkspaces: 3,
      spawnWorkspace: spawner.spawnWorkspace,
      attachments: [
        diagnosticsAttachment({
          attach: (workspaceId, source) => {
            attachCalls.push(workspaceId);
            return cache.attach(workspaceId, source);
          },
          forget: (workspaceId) => cache.forget(workspaceId),
        }),
      ],
    });
    t.after(() => pool.close());

    for (const projectRoot of [alpha, beta, alpha, beta]) {
      const lease = await pool.acquire(projectRoot);
      await lease.release();
    }

    assert.equal(attachCalls.length, 2, "hai tiến trình là hai lần attach, không phải bốn");
    assert.equal(new Set(attachCalls).size, 2, "mỗi workspace id được attach dưới tên của chính nó");
  },
);

test(
  "evict vừa gỡ đăng ký vừa quên workspace: cache thôi hấp thụ, kể cả với publish tới sau",
  { timeout: 10_000 },
  async (t) => {
    const root = mkdtempSync(path.join(tmpdir(), "jdt-attach-evict-"));
    t.after(() => rmSync(root, { recursive: true, force: true }));
    const projectRoot = makeProject(root, "alpha");
    const spawner = makeSpawner();
    const cache = createDiagnosticsCache();
    const forgotten: string[] = [];

    const pool = createWorkspacePool({
      cacheRoot: path.join(root, "cache"),
      maxWorkspaces: 3,
      spawnWorkspace: spawner.spawnWorkspace,
      attachments: [
        diagnosticsAttachment({
          attach: (workspaceId, source) => cache.attach(workspaceId, source),
          forget: (workspaceId) => {
            forgotten.push(workspaceId);
            cache.forget(workspaceId);
          },
        }),
      ],
    });
    // close() phải nằm trong cleanup, không chỉ ở giữa ca: một khẳng định đỏ trước nó sẽ để lại
    // tiến trình đã spawn và mọi handle của attachment còn sống, và node --test treo thay vì báo đỏ.
    t.after(() => pool.close());

    const lease = await pool.acquire(projectRoot);
    const workspaceId = lease.workspaceId;
    await lease.release();
    const client = spawner.clients[0];
    const uri = "file:///alpha/src/main/java/Alpha.java";

    // Mỏ neo dương: khi đăng ký còn hiệu lực, cache PHẢI hấp thụ. Không có nó, mọi khẳng định phủ
    // định bên dưới xanh một cách rỗng.
    client.publish(PUBLISH_DIAGNOSTICS_METHOD, {
      uri,
      diagnostics: [{ range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } }, message: "before" }],
    });
    assert.equal(cache.get(workspaceId, uri).reported, true, "đăng ký còn hiệu lực thì publish phải tới cache");

    await pool.close();

    assert.deepEqual(forgotten, [workspaceId], "evict phải quên đúng workspace đó, đúng một lần");
    assert.equal(cache.get(workspaceId, uri).reported, false, "evict xoá sạch mục của workspace");

    // Đây là câu giết mutant "chỉ gọi forget, không gọi detach": handler còn sống sẽ dựng lại mục.
    client.publish(PUBLISH_DIAGNOSTICS_METHOD, {
      uri,
      diagnostics: [{ range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } }, message: "after" }],
    });
    assert.equal(
      cache.get(workspaceId, uri).reported,
      false,
      "sau khi gỡ đăng ký, một publish tới muộn không được dựng lại workspace đã bị evict",
    );
  },
);

test(
  "file-sync sink gắn một lần lúc spawn và được đóng lúc evict",
  { timeout: 10_000 },
  async (t) => {
    const root = mkdtempSync(path.join(tmpdir(), "jdt-attach-sync-"));
    t.after(() => rmSync(root, { recursive: true, force: true }));
    const projectRoot = makeProject(root, "alpha");
    const spawner = makeSpawner();
    const started: Array<{ workspaceId: string; watcher: FileSyncWatcher }> = [];

    const pool = createWorkspacePool({
      cacheRoot: path.join(root, "cache"),
      maxWorkspaces: 3,
      spawnWorkspace: spawner.spawnWorkspace,
      attachments: [
        attachFileSync({
          debounceMs: 20,
          onStarted: (context, watcher) => started.push({ workspaceId: context.workspaceId, watcher }),
        }),
      ],
    });
    // `fs.watch` là handle persistent, nên ca này phải tự cấp ngân sách cho chính nó. Cleanup đóng
    // mọi watcher đã dựng NGOÀI đường evict: nếu không, một mutant bỏ hẳn detach lúc evict sẽ làm
    // tệp spec treo và ta mất luôn dòng đỏ có tên mà ca này viết ra.
    t.after(async () => {
      await pool.close();
      for (const entry of started) await entry.watcher.close();
    });

    for (let index = 0; index < 4; index += 1) {
      const lease = await pool.acquire(projectRoot);
      await lease.release();
    }

    assert.equal(started.length, 1, "bốn lease phải dùng chung một watcher, không dựng bốn cái");

    await pool.close();

    // Watcher đã đóng là một trạng thái quan sát được: khởi động lại phải bị từ chối có tên.
    await assert.rejects(
      () => started[0].watcher.start(),
      /closed and cannot be restarted/,
      "evict phải đóng watcher, không để nó quét đĩa cho một tiến trình đã chết",
    );
  },
);

// -------------------------------------------------------------------------------------------
// Cửa sổ giữa spawn và attach — evict rơi vào đúng đó là sự kiện thường, không phải trường hợp biên.
//
// Cold start của JDT LS khoảng 2,3 giây theo chú thích của pool. Một SIGTERM tới daemon trong khoảng
// đó gặp một entry đang ở trạng thái "starting": tiến trình đã sinh ra hoặc sắp sinh ra, nhưng danh
// sách detach của entry vẫn còn rỗng vì attachment chưa chạy. Nếu evict gỡ đăng ký ở thời điểm đó,
// nó gỡ trên một mảng rỗng, rồi attachment mới đẩy các hàm detach vào và không ai chạy chúng nữa —
// handle `fs.watch` của file-sync ở lại và tiến trình node không bao giờ thoát tự nhiên.
// -------------------------------------------------------------------------------------------

test(
  "close() trong lúc spawn còn dở vẫn chạy mọi detach, kể cả detach đăng ký sau khi evict bắt đầu",
  { timeout: 15_000 },
  async (t) => {
    const root = mkdtempSync(path.join(tmpdir(), "jdt-attach-race-"));
    t.after(() => rmSync(root, { recursive: true, force: true }));
    const projectRoot = makeProject(root, "alpha");

    // Hai chốt chặn quanh spawn seam biến "evict rơi vào giữa cold start" thành một sự kiện xác
    // định, không phụ thuộc vào bất kỳ khoảng chờ nào.
    const spawnReached = deferred();
    const spawnGate = deferred();
    const state = { stops: 0 };
    const clients: FakeClient[] = [];
    const spawnWorkspace = async (): Promise<SpawnedWorkspace> => {
      spawnReached.resolve();
      await spawnGate.promise;
      const client = new FakeClient();
      clients.push(client);
      return {
        pid: 7_311,
        client: client as unknown as SpawnedWorkspace["client"],
        stop: async () => {
          state.stops += 1;
        },
      };
    };

    const attached: string[] = [];
    const detached: string[] = [];
    const watchers: FileSyncWatcher[] = [];

    const pool = createWorkspacePool({
      cacheRoot: path.join(root, "cache"),
      maxWorkspaces: 3,
      spawnWorkspace,
      attachments: [
        attachFileSync({ debounceMs: 20, onStarted: (_context, watcher) => watchers.push(watcher) }),
        (context) => {
          attached.push(context.workspaceId);
          return () => {
            detached.push(context.workspaceId);
          };
        },
      ],
    });
    // Lưới an toàn KHÔNG đi qua đường evict: nếu bất biến này gãy, `fs.watch` còn sống sẽ giữ event
    // loop và cả tệp spec treo thay vì báo một dòng đỏ có tên. Mở luôn chốt chặn để không ca nào
    // kẹt lại sau một khẳng định đỏ.
    t.after(async () => {
      spawnGate.resolve();
      for (const watcher of watchers) await watcher.close();
    });

    const acquiring = pool.acquire(projectRoot);
    await spawnReached.promise; // entry đang "starting"; chưa attachment nào chạy

    const closing = pool.close(); // evict rơi đúng vào cửa sổ đó
    spawnGate.resolve(); // spawn hoàn tất SAU khi evict đã bắt đầu
    await closing;
    await acquiring.then(async (lease) => lease.release()).catch(() => {});

    // Mỏ neo dương: tiến trình vẫn thật sự ra đời, nên vẫn thật sự có thứ để dọn.
    assert.equal(clients.length, 1, "spawn seam đã hoàn tất, nên có đúng một tiến trình để dọn");
    assert.equal(attached.length, 1, "attachment vẫn chạy đúng một lần cho tiến trình vừa sinh ra");
    assert.deepEqual(
      detached,
      attached,
      `mọi detach đã đăng ký phải chạy, kể cả khi đăng ký sau lúc evict bắt đầu; đã chạy ${detached.length}/${attached.length}`,
    );
    assert.equal(state.stops, 1, "tiến trình vừa sinh ra phải bị dừng");

    assert.equal(watchers.length, 1, "file-sync dựng đúng một watcher cho tiến trình đó");
    await assert.rejects(
      () => watchers[0]!.start(),
      /closed and cannot be restarted/,
      "handle fs.watch phải được đóng lúc evict, nếu không tiến trình không bao giờ thoát",
    );
  },
);

test(
  "một attachment ném lỗi làm hỏng cả start: lỗi đi ra ngoài, không workspace nối dây dở nào được trả về",
  { timeout: 15_000 },
  async (t) => {
    const root = mkdtempSync(path.join(tmpdir(), "jdt-attach-throw-"));
    t.after(() => rmSync(root, { recursive: true, force: true }));
    const projectRoot = makeProject(root, "alpha");
    const spawner = makeSpawner();

    const detachOrder: string[] = [];
    const attachOrder: string[] = [];
    const pool = createWorkspacePool({
      cacheRoot: path.join(root, "cache"),
      maxWorkspaces: 3,
      spawnWorkspace: spawner.spawnWorkspace,
      attachments: [
        () => {
          attachOrder.push("first");
          return () => {
            detachOrder.push("first");
          };
        },
        () => {
          attachOrder.push("second");
          throw new Error("attachment thứ hai không nối được dây");
        },
        () => {
          attachOrder.push("third");
        },
      ],
    });
    t.after(() => pool.close());

    await assert.rejects(
      () => pool.acquire(projectRoot),
      /attachment thứ hai không nối được dây/,
      "một attachment hỏng là một start hỏng: lỗi phải đi ra tới người gọi, không bị nuốt",
    );

    assert.deepEqual(attachOrder, ["first", "second"], "attachment sau cái hỏng không được chạy");
    assert.deepEqual(
      detachOrder,
      ["first"],
      "attachment đã thành công trước đó phải được gỡ, nếu không đường dây nửa vời ở lại",
    );
    assert.equal(
      spawner.stops,
      1,
      "tiến trình vừa sinh ra phải chết cùng start hỏng, nếu không pool để lại một JVM không ai sở hữu",
    );

    // Một start hỏng không được cache: lần gọi sau phải spawn lại từ đầu, không thừa hưởng entry chết.
    await assert.rejects(() => pool.acquire(projectRoot), /attachment thứ hai không nối được dây/);
    assert.equal(spawner.clients.length, 2, "lần acquire sau phải spawn một tiến trình mới");
  },
);

test(
  "detach chạy ngược thứ tự attach: thứ dựng sau được gỡ trước",
  { timeout: 15_000 },
  async (t) => {
    const root = mkdtempSync(path.join(tmpdir(), "jdt-attach-order-"));
    t.after(() => rmSync(root, { recursive: true, force: true }));
    const projectRoot = makeProject(root, "alpha");
    const spawner = makeSpawner();

    const detachOrder: string[] = [];
    const pool = createWorkspacePool({
      cacheRoot: path.join(root, "cache"),
      maxWorkspaces: 3,
      spawnWorkspace: spawner.spawnWorkspace,
      attachments: ["first", "second", "third"].map((name) => () => () => {
        detachOrder.push(name);
      }),
    });
    t.after(() => pool.close());

    const lease = await pool.acquire(projectRoot);
    await lease.release();
    await pool.close();

    // Một attachment sau có thể dựng trên thứ mà attachment trước mở ra, nên gỡ theo đúng chiều
    // ngược là thứ tự duy nhất an toàn — cùng quy ước với defer/unwind ở mọi nơi khác.
    assert.deepEqual(detachOrder, ["third", "second", "first"]);
  },
);
