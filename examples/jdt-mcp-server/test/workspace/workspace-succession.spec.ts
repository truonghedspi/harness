// condition_id: TCON-DIAG-0004 (harness/tests/design/plans/TP-DIAG-0001)
// requirement_id: INV-DIAG-1 (docs/design/tool-surface.md) — đọc lại luôn trả về payload gần nhất,
// hoặc mốc "chưa báo cáo" tường minh; feature: feat-prove-evict-succession.
//
// Điều đang được chứng minh: khi một lời gọi đồng thời tái acquire một project root mà workspace
// TRƯỚC ĐÓ vẫn đang dừng, tiến trình MỚI tiếp quản ĐÚNG CÙNG `workspaceId` — `#identify` băm
// `sha256(canonicalRoot)`, độc lập với thế hệ tiến trình. Một publishDiagnostics mà tiến trình mới
// hấp thụ phải còn đọc được SAU KHI tiến trình cũ dừng xong: dọn dẹp của kẻ tiền nhiệm không bao giờ
// được xoá cache của kẻ kế nhiệm.
//
// Vì sao thứ tự trong `#evict` chịu lực, và vì sao mối nguy KHÔNG phải chiều thường được kể: một
// notification tới muộn rơi vào cache của workspace đang chết bị chính `forget()` trong cùng hàm
// detach xoá ngay sau đó, nên chiều đó không quan sát được. Chiều thật là chiều ngược lại —
// `cache.forget(workspaceId)` muộn của kẻ tiền nhiệm XOÁ cache của kẻ kế nhiệm vừa tiếp quản cùng
// identity, biến một tệp JDT LS ĐÃ báo cáo thành "chưa báo cáo".
//
// Ca này cần HAI lời gọi acquire chạy SONG SONG: `#ensureCapacityFor` await TRỌN `#evict`, nên một
// chuỗi acquire tuần tự không bao giờ dựng được cửa sổ này (cùng lý do INV-POOL-5 tồn tại). Seam
// `spawnWorkspace` giả có `stop()` điều khiển được thay cho hạn ân xá STOP_GRACE_MS = 5 000 ms thật
// của `terminate()`; JDT LS thật biến cửa sổ này thành phụ thuộc thời gian. Đường diagnostics đi qua
// `diagnosticsAttachment()` và `createDiagnosticsCache()` thật, và payload vào cache qua sink
// notification thật của tiến trình, không bơm thẳng.

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
} from "../../src/workspace/workspace-pool.ts";
import {
  createDiagnosticsCache,
  PUBLISH_DIAGNOSTICS_METHOD,
} from "../../src/lsp/diagnostics-cache.ts";

/** LspClient giả có định tuyến notification thật: `publish` là đường một server đẩy về client. */
class FakeClient {
  public readonly handlers = new Map<string, Array<(params: unknown) => void>>();

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

  public notify(): void {
    // Pool không nói LSP; ca này không gửi gì lên server.
  }

  public publish(method: string, params: unknown): void {
    for (const handler of [...(this.handlers.get(method) ?? [])]) handler(params);
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

interface SpawnRecord {
  projectRoot: string;
  workspaceId: string;
  pid: number;
  client: FakeClient;
}

function diagnostic(message: string): { range: unknown; message: string } {
  return { range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } }, message };
}

test(
  "workspace tiếp quản một identity vừa bị evict giữ được diagnostics của chính nó khi kẻ tiền nhiệm dừng xong",
  { timeout: 15_000 },
  async (t) => {
    const root = mkdtempSync(path.join(tmpdir(), "jdt-succession-"));
    t.after(() => rmSync(root, { recursive: true, force: true }));
    const alpha = makeProject(root, "alpha");
    const beta = makeProject(root, "beta");
    const gamma = makeProject(root, "gamma");
    const delta = makeProject(root, "delta");

    // Hai chốt chặn quanh `stop()` của tiến trình ĐẦU TIÊN của alpha: chúng biến "evict còn đang
    // dừng tiến trình" thành một sự kiện xác định, không phụ thuộc vào bất kỳ khoảng chờ nào. Chỉ
    // thế hệ đầu của alpha dừng chậm; mọi tiến trình khác dừng ngay.
    const stopReached = deferred();
    const stopGate = deferred();
    const spawns: SpawnRecord[] = [];
    let nextPid = 7_400;

    const spawnWorkspace = async (args: SpawnWorkspaceArgs): Promise<SpawnedWorkspace> => {
      const client = new FakeClient();
      const generation = spawns.filter((record) => record.projectRoot === args.projectRoot).length;
      const pid = nextPid++;
      spawns.push({ projectRoot: args.projectRoot, workspaceId: args.workspaceId, pid, client });
      const stopsSlowly = args.projectRoot === alpha && generation === 0;
      return {
        pid,
        client: client as unknown as SpawnedWorkspace["client"],
        stop: async () => {
          if (!stopsSlowly) return;
          stopReached.resolve();
          await stopGate.promise;
        },
      };
    };

    const cache = createDiagnosticsCache();
    const pool = createWorkspacePool({
      cacheRoot: path.join(root, "cache"),
      maxWorkspaces: 3,
      spawnWorkspace,
      attachments: [diagnosticsAttachment(cache)],
    });
    // Cleanup phải mở chốt chặn TRƯỚC khi đóng pool: một khẳng định đỏ ở giữa ca sẽ để `#evict` kẹt
    // vĩnh viễn trong `stop()`, và node --test treo thay vì báo dòng đỏ có tên.
    t.after(async () => {
      stopGate.resolve();
      await pool.close();
    });

    // 1–2. Lấp đầy cap: acquire + release lần lượt alpha, beta, gamma. alpha là LRU.
    const firstAlphaLease = await pool.acquire(alpha);
    const alphaId = firstAlphaLease.workspaceId;
    const predecessorPid = firstAlphaLease.pid;
    await firstAlphaLease.release();
    for (const projectRoot of [beta, gamma]) {
      const lease = await pool.acquire(projectRoot);
      await lease.release();
    }
    assert.equal(spawns.length, 3, "ba dự án là ba tiến trình; cap đã đầy trước khi cửa sổ mở ra");

    const uri = "file:///alpha/src/main/java/Alpha.java";

    // 3. acquire(delta) evict alpha (LRU) và DỪNG LẠI bên trong `stop()` của alpha.
    const acquiringDelta = pool.acquire(delta);
    await stopReached.promise;

    // 4. TRONG LÚC alpha cũ vẫn đang dừng, một acquire(alpha) khác chạy SONG SONG và sinh tiến trình
    //    THỨ HAI dưới ĐÚNG cùng workspaceId.
    const successorLease = await pool.acquire(alpha);
    assert.equal(
      successorLease.workspaceId,
      alphaId,
      "identity là hàm của canonical root, không của thế hệ tiến trình: kẻ kế nhiệm tiếp quản cùng workspaceId",
    );
    assert.notEqual(
      successorLease.pid,
      predecessorPid,
      "mỏ neo dương: đây phải là một tiến trình MỚI, không phải entry cũ được dùng lại",
    );
    const alphaSpawns = spawns.filter((record) => record.projectRoot === alpha);
    assert.equal(alphaSpawns.length, 2, "alpha phải có đúng hai thế hệ tiến trình trong cửa sổ này");
    const successorClient = alphaSpawns[1]!.client;

    // 5–6. Publish một diagnostic qua sink notification THẬT của tiến trình mới, rồi đọc lại ngay.
    successorClient.publish(PUBLISH_DIAGNOSTICS_METHOD, {
      uri,
      diagnostics: [diagnostic("successor")],
    });
    assert.equal(
      cache.get(alphaId, uri).reported,
      true,
      "mỏ neo dương: đăng ký của kẻ kế nhiệm còn hiệu lực thì publish của nó phải tới cache",
    );

    // 7. Mở cổng cho tiến trình CŨ hoàn tất việc dừng, rồi chờ trọn lượt evict của nó.
    stopGate.resolve();
    const deltaLease = await acquiringDelta;
    await deltaLease.release();

    // 8. Câu chịu lực: dọn dẹp của kẻ tiền nhiệm KHÔNG được xoá cache của kẻ kế nhiệm. Dưới mutant
    //    đảo `spawned.stop()` lên trước `#runDetachments(victim)`, `forget()` muộn của alpha cũ xoá
    //    mục này và một tệp JDT LS ĐÃ báo cáo đọc lại thành "chưa báo cáo" — INV-DIAG-1 gãy.
    assert.equal(
      cache.get(alphaId, uri).reported,
      true,
      "kẻ tiền nhiệm dừng xong không được xoá diagnostics mà kẻ kế nhiệm vừa hấp thụ dưới cùng identity",
    );
    assert.equal(
      cache.list(alphaId)[0]?.diagnostics[0]?.message,
      "successor",
      "bản báo cáo đọc lại phải đúng là bản của kẻ kế nhiệm, nguyên vẹn",
    );

    // Đối trọng: kẻ tiền nhiệm vẫn phải bị GỠ ĐĂNG KÝ. Nếu ai đó "sửa" ca trên bằng cách bỏ hẳn
    // detach, publish muộn của tiến trình đã chết sẽ đè lên cache của kẻ kế nhiệm.
    alphaSpawns[0]!.client.publish(PUBLISH_DIAGNOSTICS_METHOD, {
      uri,
      diagnostics: [diagnostic("predecessor ghost")],
    });
    assert.equal(
      cache.list(alphaId)[0]?.diagnostics[0]?.message,
      "successor",
      "publish của tiến trình đã chết không được ghi vào cache của kẻ kế nhiệm",
    );

    await successorLease.release();
  },
);
