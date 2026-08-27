// Traceability (skills/test-design/SKILL.md, role: Test-Implementer).
//
// Conditions: TCON-POOL-0004, TCON-POOL-0005, TCON-POOL-0006
// Requirements: INV-POOL-3
// Plan: TP-POOL-0002 | Feature: feat-prove-pool-crash-handling
//
// INV-POOL-3: khi một process JDT LS chết, mọi request đang bay tới nó phải kết thúc bằng lỗi —
// không bao giờ treo quá deadline và không bao giờ trả về câu trả lời dở dang. Oracle này đứng ở
// đúng chỗ nối giữa hai thành phần: workspace-pool sở hữu quyết định spawn/kill, còn lsp-client sở
// hữu bảng pending-request.
//
// Ba lựa chọn thiết kế của oracle, và lý do:
//
//  1. Process con là process THẬT. Ranh giới process là ranh giới hệ thống duy nhất được phép giả
//     lập ở đây, nên `spawnWorkspace` (seam đã được workspace-pool công bố) trả về một process Node
//     thật nói JSON-RPC theo khung Content-Length qua stdio. Test giết process bằng tín hiệu thật
//     (SIGKILL), không chỉ đóng stdio stream, để đi qua đúng đường phát hiện exit.
//  2. Deadline là tham số của test, không phải hằng số 30 s. X-001 (ngân sách deadline mỗi lời gọi)
//     vẫn còn mở trong docs/cross-cutting.md, nên oracle chỉ khẳng định "settle trong deadline được
//     cấu hình", với deadline lấy từ một tham số duy nhất (`SETTLE_DEADLINE_MS`, có thể ghi đè qua
//     biến môi trường). Không có literal 30 s nào trong file này.
//  3. Nội dung thông điệp lỗi không bị ghim. X-003 (bảng phân loại lỗi) cũng còn mở, nên oracle chỉ
//     đòi một Error tường minh, có thông điệp khác rỗng — đúng mức mà điều kiện cam kết, không hơn.
//
// Ngoài phạm vi có chủ đích: không có case nào cho graceful exit lúc rảnh, và không có case nào
// ghim thứ tự SIGTERM-trước-SIGKILL của terminate(). Cả hai đều nằm ngoài falsifier INV-POOL-3
// (xem spec_gaps của TP-POOL-0002).

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { LspClient, type LspProcess } from "../../src/lsp/lsp-client.ts";
import {
  createWorkspacePool,
  terminate,
  type SpawnWorkspaceArgs,
  type SpawnedWorkspace,
  type WorkspacePool,
} from "../../src/workspace/workspace-pool.ts";

// Tham số deadline của oracle (điều kiện yêu cầu tham số hoá; X-001 chưa chốt giá trị mặc định).
const SETTLE_DEADLINE_MS = Number.parseInt(process.env.JDT_SETTLE_DEADLINE_MS ?? "2000", 10);
// Ngân sách thời gian của cả test case, suy ra từ tham số trên chứ không đặt độc lập.
const CASE_TIMEOUT_MS = SETTLE_DEADLINE_MS * 6;

// Các method mà process giả lập cố tình KHÔNG bao giờ trả lời, nên request thật sự đang bay khi
// process chết. Ba tên method khác nhau để TCON-POOL-0005 quan sát nhiều entry trong bảng pending.
const NEVER_ANSWERED_METHODS = [
  "textDocument/definition",
  "textDocument/references",
  "workspace/symbol",
] as const;

const ANSWERED_METHOD = "textDocument/hover";
const PARTIAL_METHOD = "textDocument/documentSymbol";
const PARTIAL_BODY_MARKER = "PARTIAL-BODY-MARKER";

// Process con: một Node process riêng biệt, nói đúng khung Content-Length như JDT LS thật.
//  - `textDocument/hover`  -> trả lời đầy đủ, hợp lệ (chứng minh seam không rỗng nghĩa).
//  - ba method trong NEVER_ANSWERED_METHODS -> chỉ báo đã nhận (notification `$/ack`), không trả lời.
//  - `textDocument/documentSymbol` -> ghi header Content-Length rồi chỉ ghi MỘT PHẦN thân response,
//    và dừng lại ở đó, để test giết process khi frame còn dở dang.
const CHILD_SCRIPT = `
const NEVER_ANSWERED = ${JSON.stringify(NEVER_ANSWERED_METHODS)};
const PARTIAL_METHOD = ${JSON.stringify(PARTIAL_METHOD)};
const PARTIAL_BODY_MARKER = ${JSON.stringify(PARTIAL_BODY_MARKER)};

function frame(payload) {
  const body = Buffer.from(JSON.stringify(payload));
  return Buffer.concat([Buffer.from("Content-Length: " + body.byteLength + "\\r\\n\\r\\n"), body]);
}
function send(payload) {
  process.stdout.write(frame(payload));
}
function ack(method) {
  send({ jsonrpc: "2.0", method: "$/ack", params: { acked: method } });
}

let buffer = Buffer.alloc(0);
process.stdin.on("data", (chunk) => {
  buffer = Buffer.concat([buffer, chunk]);
  while (true) {
    const separator = buffer.indexOf("\\r\\n\\r\\n");
    if (separator < 0) return;
    const header = buffer.subarray(0, separator).toString("ascii");
    const match = /Content-Length:\\s*(\\d+)/i.exec(header);
    if (!match) return;
    const bodyLength = Number.parseInt(match[1], 10);
    const frameEnd = separator + 4 + bodyLength;
    if (buffer.byteLength < frameEnd) return;
    const body = buffer.subarray(separator + 4, frameEnd);
    buffer = buffer.subarray(frameEnd);
    const message = JSON.parse(body.toString());

    if (NEVER_ANSWERED.includes(message.method)) {
      ack(message.method);
      continue;
    }
    if (message.method === PARTIAL_METHOD) {
      ack(message.method);
      const full = Buffer.from(
        JSON.stringify({
          jsonrpc: "2.0",
          id: message.id,
          result: PARTIAL_BODY_MARKER + "-" + "x".repeat(200),
        }),
      );
      // Header khai báo đủ độ dài, nhưng chỉ 60 byte đầu của thân được ghi ra rồi im lặng.
      process.stdout.write(Buffer.from("Content-Length: " + full.byteLength + "\\r\\n\\r\\n"));
      process.stdout.write(full.subarray(0, 60));
      continue;
    }
    send({ jsonrpc: "2.0", id: message.id, result: "ok:" + message.method });
  }
});
`;

type Settlement =
  | { status: "resolved"; value: unknown }
  | { status: "rejected"; reason: unknown }
  | { status: "pending" };

/** Chạy đua promise với deadline: `pending` nghĩa là request treo quá deadline. */
async function settleWithin(promise: Promise<unknown>, deadlineMs: number): Promise<Settlement> {
  let timer: NodeJS.Timeout | undefined;
  const observed: Promise<Settlement> = promise.then(
    (value) => ({ status: "resolved", value }),
    (reason) => ({ status: "rejected", reason }),
  );
  const expiry = new Promise<Settlement>((resolve) => {
    timer = setTimeout(() => resolve({ status: "pending" }), deadlineMs);
  });
  try {
    return await Promise.race([observed, expiry]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/** Khẳng định của INV-POOL-3: settle trong deadline, bằng lỗi tường minh, không bao giờ thành công. */
function assertSettledAsExplicitError(settlement: Settlement, label: string): void {
  if (settlement.status === "pending") {
    assert.fail(
      `${label}: vẫn treo sau ${SETTLE_DEADLINE_MS} ms kể từ khi process chết; INV-POOL-3 đòi mọi request đang bay phải settle trong deadline`,
    );
  }
  if (settlement.status === "resolved") {
    assert.fail(
      `${label}: trả về kết quả thành công ${JSON.stringify(settlement.value)} từ một process đã chết; INV-POOL-3 cấm câu trả lời dở dang hoặc cũ`,
    );
  }
  const reason = settlement.reason;
  assert.ok(
    reason instanceof Error,
    `${label}: lý do từ chối phải là một Error tường minh, nhận được ${typeof reason}`,
  );
  assert.ok(
    (reason as Error).message.trim().length > 0,
    `${label}: Error phải mang thông điệp giải thích, không được rỗng`,
  );
}

interface LiveChild {
  child: ChildProcess;
  /** Chờ tới khi stdout thô của process con chứa chuỗi đánh dấu — đồng bộ theo sự kiện, không ngủ. */
  waitForOutput(needle: string): Promise<void>;
}

/**
 * Seam ranh giới process của workspace-pool. Đây là chỗ duy nhất được giả lập, và bản thân nó vẫn
 * spawn một process con THẬT, nối stdio thật vào LspClient thật — giống hệt cách production nối.
 */
function createScriptedSpawner(scriptPath: string): {
  spawnWorkspace: (args: SpawnWorkspaceArgs) => Promise<SpawnedWorkspace>;
  live: Map<number, LiveChild>;
} {
  const live = new Map<number, LiveChild>();

  const spawnWorkspace = async ({ canonicalRoot }: SpawnWorkspaceArgs): Promise<SpawnedWorkspace> => {
    const child = spawn(process.execPath, [scriptPath], {
      cwd: canonicalRoot,
      stdio: ["pipe", "pipe", "inherit"],
    });
    if (child.pid === undefined) throw new Error("fixture không spawn được process con");

    let raw = "";
    const waiters: Array<{ needle: string; resolve: () => void }> = [];
    // Gắn listener ngay lúc spawn, trước khi bất kỳ byte nào có thể tới, nên không mất chunk.
    child.stdout?.on("data", (chunk: Buffer) => {
      raw += chunk.toString();
      for (const waiter of [...waiters]) {
        if (!raw.includes(waiter.needle)) continue;
        waiters.splice(waiters.indexOf(waiter), 1);
        waiter.resolve();
      }
    });

    live.set(child.pid, {
      child,
      waitForOutput: (needle: string) =>
        new Promise<void>((resolve, reject) => {
          if (raw.includes(needle)) {
            resolve();
            return;
          }
          const timer = setTimeout(() => {
            reject(new Error(`fixture không thấy "${needle}" trên stdout của process con trong ${SETTLE_DEADLINE_MS} ms`));
          }, SETTLE_DEADLINE_MS);
          waiters.push({
            needle,
            resolve: () => {
              clearTimeout(timer);
              resolve();
            },
          });
        }),
    });

    return {
      pid: child.pid,
      client: new LspClient(child as unknown as LspProcess),
      stop: () => terminate(child),
    };
  };

  return { spawnWorkspace, live };
}

interface Harness {
  pool: WorkspacePool;
  client: LspClient;
  child: ChildProcess;
  waitForOutput(needle: string): Promise<void>;
}

async function startWorkspace(t: { after(fn: () => void | Promise<void>): void }, label: string): Promise<Harness> {
  const root = mkdtempSync(path.join(tmpdir(), `jdt-pool-crash-${label}-`));
  t.after(() => rmSync(root, { recursive: true, force: true }));

  const scriptPath = path.join(root, "scripted-jdtls.cjs");
  writeFileSync(scriptPath, CHILD_SCRIPT);
  const projectRoot = path.join(root, "project");
  mkdirSync(projectRoot, { recursive: true });

  const spawner = createScriptedSpawner(scriptPath);
  const pool = createWorkspacePool({
    cacheRoot: path.join(root, "cache"),
    spawnWorkspace: spawner.spawnWorkspace,
  });
  t.after(async () => {
    await pool.close();
    for (const { child } of spawner.live.values()) {
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    }
  });

  const lease = await pool.acquire(projectRoot);
  const entry = spawner.live.get(lease.pid);
  assert.ok(entry, "fixture phải giữ được process con mà pool đã spawn cho workspace này");
  assert.ok(lease.client, "lease phải mang LspClient của workspace thì request mới có chỗ để bay");

  // Không rỗng nghĩa: khung Content-Length và tương quan id thật sự chạy qua ranh giới process
  // này TRƯỚC khi ta giết nó — nếu không, "settle bằng lỗi" là kết quả tầm thường.
  assert.equal(
    await lease.client!.request(ANSWERED_METHOD),
    `ok:${ANSWERED_METHOD}`,
    "process con phải trả lời được một request bình thường trước khi bị giết",
  );

  return { pool, client: lease.client!, child: entry!.child, waitForOutput: entry!.waitForOutput };
}

/** Giết process con bằng tín hiệu thật, rồi khẳng định nó thật sự chết (không chỉ đóng stream). */
function killRealProcess(child: ChildProcess): void {
  assert.ok(child.kill("SIGKILL"), "fixture phải gửi được tín hiệu tới process con thật");
}

function assertProcessReallyDied(child: ChildProcess): void {
  assert.ok(
    child.exitCode !== null || child.signalCode !== null,
    "process con phải thật sự thoát, nếu không thì oracle chỉ đo việc đóng stream chứ không đo đường phát hiện exit",
  );
}

// TCON-POOL-0004 — đúng một request đang bay khi process bị giết.
test(
  "TCON-POOL-0004: một request đang bay settle thành lỗi trong deadline khi process JDT LS bị giết [INV-POOL-3]",
  { timeout: CASE_TIMEOUT_MS },
  async (t) => {
    const { client, child, waitForOutput } = await startWorkspace(t, "single");

    const method = NEVER_ANSWERED_METHODS[0];
    const inFlight = client.request(method, { uri: "file:///Greeter.java" });
    // Process con đã nhận được request: nó thật sự đang bay, không chỉ nằm trong bộ đệm của ta.
    await waitForOutput(`"acked":"${method}"`);

    killRealProcess(child);
    const settlement = await settleWithin(inFlight, SETTLE_DEADLINE_MS);

    assertSettledAsExplicitError(settlement, `request ${method} đang bay`);
    assertProcessReallyDied(child);
  },
);

// TCON-POOL-0005 — nhiều request đồng thời: mọi entry trong bảng pending, không chỉ entry đầu.
test(
  "TCON-POOL-0005: mọi request đang bay đồng thời đều settle thành lỗi khi process bị giết, không sót entry nào [INV-POOL-3]",
  { timeout: CASE_TIMEOUT_MS },
  async (t) => {
    const { client, child, waitForOutput } = await startWorkspace(t, "concurrent");

    const inFlight = NEVER_ANSWERED_METHODS.map((method) =>
      client.request(method, { uri: "file:///Greeter.java" }),
    );
    // Cả ba đã tới process con trước khi bất kỳ cái nào được trả lời.
    for (const method of NEVER_ANSWERED_METHODS) await waitForOutput(`"acked":"${method}"`);

    killRealProcess(child);
    // Đếm deadline song song từ cùng một mốc: không request nào được phép treo trong khi các
    // request anh em của nó đã settle.
    const settlements = await Promise.all(
      inFlight.map((promise) => settleWithin(promise, SETTLE_DEADLINE_MS)),
    );

    NEVER_ANSWERED_METHODS.forEach((method, index) => {
      assertSettledAsExplicitError(settlements[index]!, `request đồng thời ${method}`);
    });
    assertProcessReallyDied(child);
  },
);

// TCON-POOL-0006 — process chết giữa chừng một frame Content-Length đã ghi dở.
test(
  "TCON-POOL-0006: response bị cắt cụt giữa frame không bao giờ thành kết quả thành công hay câu trả lời cũ [INV-POOL-3]",
  { timeout: CASE_TIMEOUT_MS },
  async (t) => {
    const { client, child, waitForOutput } = await startWorkspace(t, "partial");

    // Một câu trả lời hợp lệ, khác biệt, có sẵn trước đó: nếu bảng pending trả nhầm câu trả lời cũ,
    // giá trị này chính là thứ sẽ lộ ra.
    const earlierAnswer = await client.request(ANSWERED_METHOD);
    assert.equal(earlierAnswer, `ok:${ANSWERED_METHOD}`);

    const truncated = client.request(PARTIAL_METHOD, { uri: "file:///Greeter.java" });
    // Chờ tới khi các byte dở dang của thân response đã thật sự nằm trên stream.
    await waitForOutput(PARTIAL_BODY_MARKER);

    killRealProcess(child);
    const settlement = await settleWithin(truncated, SETTLE_DEADLINE_MS);

    assertSettledAsExplicitError(settlement, `request ${PARTIAL_METHOD} có response bị cắt cụt`);
    assertProcessReallyDied(child);
  },
);
