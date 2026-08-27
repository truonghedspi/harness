// Traceability (skills/test-design/SKILL.md, role: Test-Implementer).
//
// Conditions:   TCON-SHIM-0001, TCON-SHIM-0002, TCON-SHIM-0003
// Requirements: INV-SHIM-1, INV-SHIM-2, INV-SHIM-4
// Plan:         TP-SHIM-0001 | Feature: feat-prove-daemon-lifecycle
//
// Ba invariant được chứng minh ở đây đều là thuộc tính của TIẾN TRÌNH THẬT, không phải của giá trị
// trả về, nên mọi "launch" trong tệp này là một tiến trình `node` con nạp thẳng `startShim` /
// `startDaemon` từ `src/`. Dự án không khai `bin` trong package.json và oracle này không cần một CLI:
// ranh giới cần đo là stdout thật, bảng tiến trình thật và ổ khoá single-instance thật, cả ba đều
// quan sát được từ một tiến trình con nạp module trực tiếp. Khẳng định nào thật sự đòi một CLI entry
// point thuộc về feat-prove-cross-process-integration, không thuộc tệp này.
//
// Bốn lựa chọn thiết kế, và lý do:
//
//  1. INV-SHIM-1 đo stdout của CHÍNH tiến trình shim. Một `Writable` tiêm qua `McpShimOptions.stdout`
//     không bao giờ nhìn thấy một `console.log` lạc, mà đó lại đúng là dòng phá vỡ hợp đồng
//     một-message-một-dòng của client. Phiên ở đây có hai shim: shim thứ nhất khởi động nguội và
//     auto-spawn daemon, shim thứ hai hội tụ vào daemon ấy — nên nhiễu mà shim thứ hai lọc đến từ
//     một TIẾN TRÌNH KHÁC, qua socket Unix thật.
//  2. INV-SHIM-2 đếm daemon bằng `lsof` trên đúng đường dẫn socket, chứ không chỉ bằng `role` mà các
//     launcher tự khai. `lsof -t <socket>` chỉ liệt kê tiến trình đang GIỮ (bind) đường dẫn đó —
//     client đã kết nối không xuất hiện — nên đó là phép đếm daemon trực tiếp trên bảng tiến trình.
//     Bốn launcher chờ ở một hàng rào (barrier) rồi mới cùng gọi `startDaemon`, để chúng thật sự
//     tranh khoá thay vì bị chính thời gian nạp module xếp thành tuần tự.
//  3. INV-SHIM-4 đo bằng `ps` sau shutdown. Các process con JDT LS ở đây là process Node thật do
//     fixture spawn (quy ước của dự án trong pool-crash-handling / pool-lifecycle: "real child
//     process" nghĩa là process con thật đóng vai giả lập, không phải nạp JDT LS binary thật), và
//     chúng là CHÁU của tiến trình test. Nếu shutdown bỏ sót một cháu, cháu ấy được reparent chứ
//     không chết theo daemon — đúng kiểu JVM mồ côi mà invariant này cấm, và `ps` nhìn thấy.
//  4. Không có khẳng định nào về việc tiến trình chết khi socket lỗi. `startDaemon` trả
//     `handle.connection` mang sẵn listener "error" thừa của `probeDaemon` (quyết định có chủ ý,
//     DECISIONS.md 2026-08-23), nên lỗi link biến mất im lặng chứ không ném. Hành vi đúng khi link
//     hỏng là ghi stderr rồi reconnect trong suốt (INV-SHIM-3) — nằm ngoài ba điều kiện của kế hoạch
//     này (xem spec_gaps của TP-SHIM-0001) và không được kiểm ở đây.

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { connect, type Socket } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";

import { SOCKET_FILE_NAME } from "../../src/daemon/daemon-supervisor.ts";

/** Đường dẫn tuyệt đối, để tiến trình con nạp đúng bản mã đang được kiểm thử. */
const SHIM_MODULE = path.resolve(import.meta.dirname, "../../src/shim/mcp-shim.ts");
const SUPERVISOR_MODULE = path.resolve(import.meta.dirname, "../../src/daemon/daemon-supervisor.ts");
const POOL_MODULE = path.resolve(import.meta.dirname, "../../src/workspace/workspace-pool.ts");

/** Tiền tố ngắn có chủ ý: sun_path chỉ có 104 byte trên macOS và tmpdir() đã ăn mất ~50 byte. */
function makeRoot(): string {
  return mkdtempSync(path.join(tmpdir(), "jdt-l-"));
}

interface Child {
  child: ChildProcess;
  stdout(): string;
  stderr(): string;
  lines(): string[];
  kill(): void;
}

/**
 * `detached` để mỗi tiến trình con là một process group riêng: lúc dọn dẹp ta giết được cả nhóm,
 * kể cả các process cháu, thay vì bỏ lại daemon hay JDT LS mồ côi giữ socket.
 */
function spawnScript(scriptPath: string, args: readonly string[]): Child {
  const child = spawn(process.execPath, ["--experimental-strip-types", scriptPath, ...args], {
    stdio: ["pipe", "pipe", "pipe"],
    detached: true,
  });
  let stdout = "";
  let stderr = "";
  child.stdout?.on("data", (chunk: Buffer) => (stdout += chunk.toString("utf8")));
  child.stderr?.on("data", (chunk: Buffer) => (stderr += chunk.toString("utf8")));
  return {
    child,
    stdout: () => stdout,
    stderr: () => stderr,
    lines: () => stdout.split("\n").filter((line) => line.length > 0),
    kill: () => {
      if (child.exitCode !== null || child.signalCode !== null || child.pid === undefined) return;
      try {
        process.kill(-child.pid, "SIGKILL");
      } catch {
        child.kill("SIGKILL");
      }
    },
  };
}

/** `describe` có thể là thunk: chuỗi dựng sẵn chỉ kể lại trạng thái lúc bắt đầu chờ, tức trạng thái vô ích. */
async function waitFor(predicate: () => boolean, budgetMs: number, describe: string | (() => string)): Promise<void> {
  const deadline = Date.now() + budgetMs;
  while (!predicate()) {
    if (Date.now() >= deadline) {
      throw new Error(
        `timed out after ${budgetMs} ms waiting for: ${typeof describe === "string" ? describe : describe()}`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function request(id: number, method: string): string {
  return `${JSON.stringify({ jsonrpc: "2.0", id, method, params: {} })}\n`;
}

/**
 * Bảng tiến trình thật. `ps -o pid= -p ...` liệt kê đúng những pid còn tồn tại; một process đã chết
 * nhưng chưa được reap (zombie) VẪN xuất hiện ở đây, nên phép đo này chặt hơn `kill(pid, 0)` chứ
 * không lỏng hơn — không có cách nào để một JVM mồ côi lọt qua.
 */
function livePids(pids: readonly number[]): number[] {
  if (pids.length === 0) return [];
  let output = "";
  try {
    output = execFileSync("ps", ["-o", "pid=", "-p", pids.join(",")], { encoding: "utf8" });
  } catch {
    // `ps` thoát khác 0 khi KHÔNG pid nào còn sống; đó là một kết quả hợp lệ, không phải lỗi công cụ.
    output = "";
  }
  return output
    .split("\n")
    .map((line) => Number.parseInt(line.trim(), 10))
    .filter((pid) => Number.isInteger(pid) && pids.includes(pid));
}

/** Những tiến trình đang GIỮ đường dẫn socket, tức những daemon đang lắng nghe trên nó. */
function pidsListeningOn(socketPath: string): number[] {
  let output = "";
  try {
    output = execFileSync("lsof", ["-t", socketPath], { encoding: "utf8" });
  } catch {
    output = "";
  }
  return output
    .split("\n")
    .map((line) => Number.parseInt(line.trim(), 10))
    .filter((pid) => Number.isInteger(pid));
}

// ---------------------------------------------------------------------------------------------
// TCON-SHIM-0001 [INV-SHIM-1]
// ---------------------------------------------------------------------------------------------

/**
 * Kịch bản của một tiến trình shim thật. Phía daemon của nó cố tình phát ra đúng những gì INV-SHIM-1
 * cấm lọt tới client: banner lúc accept, stack trace Java, dòng WARN, một `null` và một `42` (hai
 * chuỗi JSON hợp lệ nhưng KHÔNG phải message MCP), rồi mới tới câu trả lời thật. Câu trả lời được
 * ghi làm ba lần ghi tách rời và mang một trường lớn, nên nếu khung message không nguyên vẹn theo
 * từng message thì stdout sẽ có dòng vỡ.
 *
 * Mốc sẵn sàng đi ra STDERR chứ không phải stdout: stdout là thứ đang được đo, một mốc trên đó sẽ tự
 * làm hỏng phép đo.
 */
function shimProcessScript(): string {
  return `import { startShim } from ${JSON.stringify(SHIM_MODULE)};

const [socketPath] = process.argv.slice(2);
const NEWLINE = String.fromCharCode(10);
const NOISE = [
  "Error: java.lang.IllegalStateException: workspace index not ready",
  "    at org.eclipse.jdt.ls.core.internal.Handler.handle(Handler.java:42)",
  "[jdt-mcp daemon] WARN resync in progress",
  "null",
  "42",
];

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function daemonSide(socket) {
  socket.write("[jdt-mcp daemon] INFO accepted a client connection" + NEWLINE);
  // Hàng đợi tuần tự: mỗi câu trả lời được ghi làm ba lần ghi tách rời, nên hai câu trả lời chạy
  // song song sẽ trộn byte của nhau. Đó là lỗi của phía daemon chứ không phải hazard mà shim có
  // trách nhiệm sửa, nên fixture ghi từng message một, trọn vẹn.
  const queue = [];
  let pumping = false;
  async function pump() {
    if (pumping) return;
    pumping = true;
    while (queue.length > 0) {
      const message = queue.shift();
      for (const noise of NOISE) socket.write(noise + NEWLINE);
      const answer = JSON.stringify({
        jsonrpc: "2.0",
        id: message.id,
        result: {
          servedBy: process.pid,
          // Một newline THẬT bên trong giá trị chuỗi: JSON.stringify thoát nó thành hai ký tự, nên
          // message vẫn phải nằm gọn trên một dòng.
          note: "first" + NEWLINE + "second",
          pad: "p".repeat(50000),
        },
      });
      const third = Math.ceil(answer.length / 3);
      socket.write(answer.slice(0, third));
      await delay(10);
      socket.write(answer.slice(third, third * 2));
      await delay(10);
      socket.write(answer.slice(third * 2) + NEWLINE);
    }
    pumping = false;
  }
  let buffer = "";
  socket.on("data", (chunk) => {
    buffer += chunk.toString("utf8");
    for (;;) {
      const index = buffer.indexOf(NEWLINE);
      if (index < 0) {
        void pump();
        return;
      }
      const line = buffer.slice(0, index);
      buffer = buffer.slice(index + 1);
      if (line.trim().length === 0) continue;
      queue.push(JSON.parse(line));
    }
  });
}

const shim = await startShim({ socketPath, shutdownOnSignals: [], onConnection: daemonSide });
process.stderr.write("shim-ready role=" + shim.role + NEWLINE);
await shim.done;
`;
}

interface McpLine {
  raw: string;
  parsed: { id?: number; result?: { servedBy?: number; note?: string; pad?: string } };
}

/**
 * Một lượt duy nhất trên toàn bộ những gì shim đã ghi ra stdout của chính nó: tách theo newline, mỗi
 * dòng phải parse thành ĐÚNG MỘT message MCP hợp lệ. Ba cách hỏng bị bắt ở đây — dòng log của daemon
 * lọt qua, message bị cắt ngang giữa hai lần ghi, và một giá trị JSON hợp lệ nhưng không phải object.
 */
function assertEveryStdoutLineIsOneMcpMessage(label: string, child: Child): McpLine[] {
  const raw = child.stdout();
  const lines = raw.split("\n").filter((line) => line.length > 0);
  assert.ok(lines.length > 0, `${label}: stdout rỗng, không có gì để kiểm — oracle sẽ vô nghĩa`);
  assert.equal(raw.endsWith("\n"), true, `${label}: mọi message trên stdout phải kết thúc bằng newline`);
  return lines.map((line, index) => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch (error) {
      assert.fail(
        `${label}: INV-SHIM-1 vỡ — dòng ${index + 1} của stdout không parse được thành JSON: ` +
          `${JSON.stringify(line.slice(0, 300))} (${(error as Error).message})`,
      );
    }
    assert.ok(
      typeof parsed === "object" && parsed !== null,
      `${label}: INV-SHIM-1 vỡ — dòng ${index + 1} parse được nhưng không phải một message MCP: ` +
        `${JSON.stringify(line.slice(0, 300))}`,
    );
    return { raw: line, parsed: parsed as McpLine["parsed"] };
  });
}

test(
  "TCON-SHIM-0001: qua một phiên shim+daemon thật có nhiễu phía daemon, mọi dòng trên stdout của shim là đúng một message MCP [INV-SHIM-1]",
  { timeout: 60_000 },
  async (t) => {
    const root = makeRoot();
    const socketPath = path.join(root, SOCKET_FILE_NAME);
    const scriptPath = path.join(root, "shim-child.mjs");
    writeFileSync(scriptPath, shimProcessScript());
    const children: Child[] = [];
    t.after(() => {
      for (const child of children) child.kill();
      rmSync(root, { recursive: true, force: true });
    });

    assert.equal(existsSync(socketPath), false, "tiền đề: chưa có gì phục vụ đường dẫn socket này");

    // Shim thứ nhất khởi động nguội: không có daemon nào trên đường dẫn, nên nó phải auto-spawn.
    const host = spawnScript(scriptPath, [socketPath]);
    children.push(host);
    await waitFor(
      () => host.stderr().includes("shim-ready role="),
      20_000,
      () => `shim thứ nhất khởi động xong (stderr: ${JSON.stringify(host.stderr().slice(-300))})`,
    );
    assert.match(
      host.stderr(),
      /shim-ready role=daemon/,
      `khởi động nguội phải đưa shim thứ nhất vào vai daemon, stderr: ${JSON.stringify(host.stderr().slice(-300))}`,
    );
    assert.ok(statSync(socketPath).isSocket(), "auto-spawn phải để lại một socket thật ở đúng đường dẫn");

    // Shim thứ hai hội tụ vào daemon đó: từ đây, nhiễu mà nó phải lọc đến từ một TIẾN TRÌNH KHÁC.
    const joiner = spawnScript(scriptPath, [socketPath]);
    children.push(joiner);
    await waitFor(
      () => joiner.stderr().includes("shim-ready role="),
      20_000,
      () => `shim thứ hai khởi động xong (stderr: ${JSON.stringify(joiner.stderr().slice(-300))})`,
    );
    assert.match(
      joiner.stderr(),
      /shim-ready role=delegated/,
      `shim thứ hai phải hội tụ vào daemon đang chạy, stderr: ${JSON.stringify(joiner.stderr().slice(-300))}`,
    );

    const hostIds = [1, 2, 3];
    const joinerIds = [11, 12, 13];
    for (const id of hostIds) host.child.stdin?.write(request(id, "tools/call"));
    for (const id of joinerIds) joiner.child.stdin?.write(request(id, "tools/call"));

    await waitFor(
      () => host.lines().length >= hostIds.length && joiner.lines().length >= joinerIds.length,
      30_000,
      () =>
        `cả hai shim trả lời đủ (host: ${host.lines().length}, joiner: ${joiner.lines().length}, ` +
        `host stderr: ${JSON.stringify(host.stderr().slice(-300))})`,
    );
    // Cho mọi dòng rò rỉ đủ thời gian tới nơi TRƯỚC khi khẳng định là không có dòng nào.
    await sleep(400);

    const noise = [
      "[jdt-mcp daemon] INFO accepted a client connection",
      "Error: java.lang.IllegalStateException: workspace index not ready",
      "    at org.eclipse.jdt.ls.core.internal.Handler.handle(Handler.java:42)",
      "[jdt-mcp daemon] WARN resync in progress",
    ];
    const hostPid = host.child.pid;
    assert.ok(hostPid !== undefined, "tiền đề: fixture phải biết pid của tiến trình giữ vai daemon");

    for (const [label, child, ids, expectedServer] of [
      ["shim auto-spawn", host, hostIds, hostPid],
      ["shim hội tụ", joiner, joinerIds, hostPid],
    ] as const) {
      // Một lượt quét duy nhất trên toàn bộ capture, đứng trước mọi khẳng định khác: đây là chính
      // falsifier của điều kiện, nên nó phải là thứ vỡ đầu tiên khi có dòng lạ trên stdout.
      const messages = assertEveryStdoutLineIsOneMcpMessage(label, child);
      assert.equal(
        messages.length,
        ids.length,
        `${label}: stdout chỉ được mang đúng ${ids.length} câu trả lời, nhận ${messages.length} dòng`,
      );
      assert.deepEqual(
        messages.map((message) => message.parsed.id),
        ids,
        `${label}: các câu trả lời phải tới đúng thứ tự và không bị méo`,
      );
      for (const line of noise) {
        assert.ok(
          !child.stdout().includes(line),
          `${label}: INV-SHIM-1 vỡ — stdout mang dòng nhiễu ${JSON.stringify(line)}`,
        );
        // Không rỗng nghĩa: nhiễu THẬT SỰ đã đi qua kênh daemon rồi bị chuyển sang stderr. Nếu
        // thiếu khẳng định này, "stdout sạch" chỉ nói rằng không có gì xảy ra cả.
        assert.ok(
          child.stderr().includes(JSON.stringify(line)),
          `${label}: dòng nhiễu phải hiện trên stderr để còn gỡ lỗi được: ${JSON.stringify(line)} ` +
            `(stderr: ${JSON.stringify(child.stderr().slice(-500))})`,
        );
      }
      for (const [index, message] of messages.entries()) {
        assert.equal(
          message.parsed.result?.servedBy,
          expectedServer,
          `${label}: câu trả lời ${index + 1} phải do đúng tiến trình daemon phục vụ`,
        );
        assert.equal(
          message.parsed.result?.pad?.length,
          50_000,
          `${label}: câu trả lời ${index + 1} phải nguyên vẹn, không mất byte nào ở ranh giới các lần ghi`,
        );
        // Message mang một newline thoát bên trong chuỗi: sau khi parse phải có newline thật, còn
        // dòng thô thì không — tức không message nào trải dài quá một dòng.
        assert.ok(
          message.parsed.result?.note?.includes("\n"),
          `${label}: câu trả lời ${index + 1} phải giữ nguyên newline đã thoát bên trong giá trị chuỗi`,
        );
        assert.ok(
          !message.raw.includes("\n"),
          `${label}: câu trả lời ${index + 1} không được trải dài quá một dòng trên wire`,
        );
      }
    }
  },
);

// ---------------------------------------------------------------------------------------------
// TCON-SHIM-0002 [INV-SHIM-2]
// ---------------------------------------------------------------------------------------------

/**
 * Một launcher độc lập. Nó nạp xong module rồi DỪNG ở hàng rào và báo "armed" qua stderr; chỉ khi
 * nhận được "go" trên stdin nó mới gọi `startDaemon`. Nếu không có hàng rào này, thời gian nạp module
 * của N tiến trình khác nhau tự xếp chúng thành tuần tự và cửa sổ tranh khoá — thứ duy nhất mà
 * INV-SHIM-2 tồn tại để đóng lại — không bao giờ mở ra.
 */
function launcherProcessScript(): string {
  return `import { startDaemon } from ${JSON.stringify(SUPERVISOR_MODULE)};

const [socketPath, label] = process.argv.slice(2);
const NEWLINE = String.fromCharCode(10);

process.stderr.write("armed" + NEWLINE);
await new Promise((resolve) => {
  let buffer = "";
  process.stdin.on("data", (chunk) => {
    buffer += chunk.toString("utf8");
    if (buffer.includes("go")) resolve();
  });
});

const handle = await startDaemon({
  socketPath,
  shutdownOnSignals: [],
  startTimeoutMs: 20000,
  onConnection: (socket) => socket.write(JSON.stringify({ servedBy: process.pid }) + NEWLINE),
});
console.log(JSON.stringify({ label, self: process.pid, role: handle.role, daemonPid: handle.daemonPid ?? null }));
// Giữ tiến trình sống để bảng tiến trình còn quan sát được lúc test khẳng định.
setInterval(() => {}, 1000);
`;
}

interface LauncherReport {
  label: string;
  self: number;
  role: string;
  daemonPid: number | null;
}

test(
  "TCON-SHIM-0002: bốn launcher độc lập chạy đồng thời hội tụ về đúng một daemon duy nhất [INV-SHIM-2]",
  { timeout: 60_000 },
  async (t) => {
    const root = makeRoot();
    const socketPath = path.join(root, SOCKET_FILE_NAME);
    const scriptPath = path.join(root, "launcher-child.mjs");
    writeFileSync(scriptPath, launcherProcessScript());
    const children: Child[] = [];
    const sockets: Socket[] = [];
    t.after(() => {
      for (const socket of sockets) socket.destroy();
      for (const child of children) child.kill();
      rmSync(root, { recursive: true, force: true });
    });

    const N = 4;
    assert.ok(N >= 3, "điều kiện đòi N >= 3 launcher đồng thời");
    assert.equal(existsSync(socketPath), false, "tiền đề: chưa có daemon nào chạy trên đường dẫn này");

    for (let index = 0; index < N; index += 1) {
      children.push(spawnScript(scriptPath, [socketPath, `launcher-${index}`]));
    }
    await waitFor(
      () => children.every((child) => child.stderr().includes("armed")),
      30_000,
      () => `cả ${N} launcher tới hàng rào (stderr: ${JSON.stringify(children.map((child) => child.stderr()))})`,
    );

    // Mở hàng rào trong một vòng lặp đồng bộ duy nhất: cả N đều được thả gần như cùng lúc.
    for (const child of children) child.child.stdin?.write("go\n");

    await waitFor(
      () => children.every((child) => child.lines().length >= 1),
      30_000,
      () =>
        `cả ${N} launcher báo cáo kết quả hội tụ (stdout: ${JSON.stringify(children.map((child) => child.stdout()))}, ` +
        `stderr: ${JSON.stringify(children.map((child) => child.stderr().slice(-200)))})`,
    );

    const reports = children.map((child, index) => {
      const line = child.lines()[0] ?? "";
      try {
        return JSON.parse(line) as LauncherReport;
      } catch (error) {
        return assert.fail(
          `launcher ${index} không báo cáo được: ${JSON.stringify(line.slice(0, 300))} (${(error as Error).message})`,
        );
      }
    });

    // 1. Mọi launcher phải gọi tên CÙNG MỘT daemon pid.
    const namedPids = new Set(reports.map((report) => report.daemonPid));
    assert.equal(
      namedPids.size,
      1,
      `cả ${N} launcher phải gọi tên cùng một daemon pid, nhận ${JSON.stringify([...namedPids])}`,
    );
    const daemonPid = reports[0]?.daemonPid;
    assert.ok(typeof daemonPid === "number", "daemon pid mà các launcher gọi tên phải là một pid thật");

    // 2. Đúng một launcher bind, phần còn lại delegate — không launcher nào được phép thất bại.
    const bound = reports.filter((report) => report.role === "daemon");
    const delegated = reports.filter((report) => report.role === "delegated");
    assert.equal(
      bound.length,
      1,
      `đúng một launcher được phép bind socket, có ${bound.length} (${JSON.stringify(reports)})`,
    );
    assert.equal(delegated.length, N - 1, `${N - 1} launcher còn lại phải delegate, không được hỏng`);
    assert.equal(bound[0]?.self, daemonPid, "pid được gọi tên phải chính là tiến trình đã bind socket");

    // 3. Bảng tiến trình: đúng MỘT daemon đang lắng nghe trên đường dẫn socket đó. `lsof -t` chỉ
    //    liệt kê tiến trình giữ chính đường dẫn ấy, nên đây là phép đếm daemon trực tiếp.
    const listening = pidsListeningOn(socketPath);
    assert.ok(
      listening.includes(daemonPid),
      `phép đo bảng tiến trình phải nhìn thấy daemon ${daemonPid} trên ${socketPath}, lsof trả về ${JSON.stringify(listening)}`,
    );
    assert.deepEqual(
      listening,
      [daemonPid],
      `INV-SHIM-2 vỡ: bảng tiến trình có ${listening.length} daemon lắng nghe trên ${socketPath}`,
    );
    assert.ok(statSync(socketPath).isSocket(), "và đúng một tệp socket tồn tại ở đường dẫn đã hẹn");

    // 4. Ổ khoá single-instance mang đúng pid đó — không có launcher thứ hai nào từng giữ nó.
    assert.equal(
      readFileSync(`${socketPath}.lock`, "utf8").trim(),
      String(daemonPid),
      "ổ khoá single-instance phải mang pid của đúng daemon đang chạy",
    );

    // 5. Đối chứng động: tiến trình thật sự phục vụ đường dẫn này là chính pid đó.
    const probe = await new Promise<Socket>((resolve, reject) => {
      const socket = connect(socketPath);
      socket.once("connect", () => resolve(socket));
      socket.once("error", reject);
    });
    sockets.push(probe);
    const greeting = await new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("daemon không chào lại trong 10 s")), 10_000);
      probe.once("data", (chunk: Buffer) => {
        clearTimeout(timer);
        resolve(chunk.toString("utf8").split("\n")[0] ?? "");
      });
    });
    assert.equal(
      (JSON.parse(greeting) as { servedBy?: number }).servedBy,
      daemonPid,
      "tiến trình đang phục vụ đường dẫn socket phải chính là daemon duy nhất mà cả bốn launcher gọi tên",
    );
  },
);

// ---------------------------------------------------------------------------------------------
// TCON-SHIM-0003 [INV-SHIM-4]
// ---------------------------------------------------------------------------------------------

/** Process con đóng vai JDT LS: sống cho tới khi bị giết, và báo "alive" để fixture khỏi phải ngủ. */
const FAKE_JDTLS_SCRIPT = `process.stdout.write("alive" + String.fromCharCode(10));
setInterval(() => {}, 1000);
`;

/**
 * Một daemon thật nuôi ba process con JDT LS thật, chia trên HAI pool: pool thứ nhất được trao lúc
 * khởi tạo, pool thứ hai được `adopt` sau đó. Hai pool và ba con là có chủ ý — một cài đặt chỉ giết
 * con đầu tiên, chỉ giết con dùng gần nhất, hay chỉ đóng pool khởi tạo mà bỏ pool nhận nuôi đều vẫn
 * qua được một phép thử một-con, trong khi vẫn bỏ lại JVM mồ côi.
 *
 * Các process con là CHÁU của tiến trình test, nên nếu shutdown bỏ sót một con, con đó được reparent
 * và tiếp tục sống — đúng dạng hỏng mà `ps` ở phía test nhìn thấy.
 */
function workspaceDaemonScript(): string {
  return `import { spawn } from "node:child_process";
import { startDaemon } from ${JSON.stringify(SUPERVISOR_MODULE)};
import { createWorkspacePool, terminate } from ${JSON.stringify(POOL_MODULE)};

const [socketPath, cacheRoot, fakeScript, joinedRoots] = process.argv.slice(2);
const NEWLINE = String.fromCharCode(10);
const roots = joinedRoots.split(",");

function makeSpawner() {
  return async ({ canonicalRoot }) => {
    const child = spawn(process.execPath, [fakeScript], {
      cwd: canonicalRoot,
      stdio: ["ignore", "pipe", "ignore"],
    });
    await new Promise((resolve, reject) => {
      child.stdout.on("data", (chunk) => {
        if (chunk.toString("utf8").includes("alive")) resolve();
      });
      child.once("error", reject);
    });
    return { pid: child.pid, stop: () => terminate(child, 2000) };
  };
}

const constructed = createWorkspacePool({ cacheRoot: cacheRoot + "/constructed", spawnWorkspace: makeSpawner() });
const adopted = createWorkspacePool({ cacheRoot: cacheRoot + "/adopted", spawnWorkspace: makeSpawner() });

const handle = await startDaemon({ socketPath, pools: [constructed], shutdownOnSignals: [] });
if (handle.role !== "daemon") {
  process.stderr.write("role=" + handle.role + NEWLINE);
  process.exit(3);
}
handle.adopt(adopted);

const pids = [];
for (let index = 0; index < roots.length; index += 1) {
  const pool = index === roots.length - 1 ? adopted : constructed;
  const lease = await pool.acquire(roots[index]);
  pids.push(lease.pid);
  await lease.release();
}
console.log("children " + pids.join(","));

process.stdin.on("data", (chunk) => {
  if (!chunk.toString("utf8").includes("shutdown")) return;
  handle.shutdown().then(
    () => console.log("shutdown-resolved"),
    (error) => process.stderr.write("shutdown-failed: " + error.message + NEWLINE),
  );
});
`;
}

test(
  "TCON-SHIM-0003: shutdown của daemon chấm dứt MỌI process con JDT LS nó đã spawn, không chỉ con đầu tiên [INV-SHIM-4]",
  { timeout: 60_000 },
  async (t) => {
    const root = makeRoot();
    const socketPath = path.join(root, SOCKET_FILE_NAME);
    const daemonScript = path.join(root, "workspace-daemon.mjs");
    const fakeScript = path.join(root, "fake-jdtls.mjs");
    writeFileSync(daemonScript, workspaceDaemonScript());
    writeFileSync(fakeScript, FAKE_JDTLS_SCRIPT);

    const projectRoots = ["alpha", "beta", "gamma"].map((name) => {
      const projectRoot = path.join(root, name);
      mkdirSync(projectRoot, { recursive: true });
      return projectRoot;
    });

    let workspacePids: number[] = [];
    const children: Child[] = [];
    t.after(() => {
      for (const pid of workspacePids) {
        try {
          process.kill(pid, "SIGKILL");
        } catch {
          // Đã chết — đó chính là kết quả mong đợi của ca này.
        }
      }
      for (const child of children) child.kill();
      rmSync(root, { recursive: true, force: true });
    });

    const daemon = spawnScript(daemonScript, [
      socketPath,
      path.join(root, "cache"),
      fakeScript,
      projectRoots.join(","),
    ]);
    children.push(daemon);

    await waitFor(
      () => /children \d+(,\d+)*/.test(daemon.stdout()),
      30_000,
      () =>
        `daemon dựng xong các workspace (stdout: ${JSON.stringify(daemon.stdout())}, ` +
        `stderr: ${JSON.stringify(daemon.stderr().slice(-400))})`,
    );
    workspacePids = (/children ([\d,]+)/.exec(daemon.stdout())?.[1] ?? "")
      .split(",")
      .map((value) => Number.parseInt(value, 10));

    // Tiền đề: HAI HOẶC NHIỀU workspace khác nhau đang thật sự sống dưới một daemon.
    assert.equal(workspacePids.length, 3, `daemon phải nuôi ba workspace, nhận ${JSON.stringify(workspacePids)}`);
    assert.equal(new Set(workspacePids).size, 3, "ba workspace phải là ba process con khác nhau");
    assert.deepEqual(
      livePids(workspacePids),
      workspacePids,
      "tiền đề: cả ba process con JDT LS phải đang sống trong bảng tiến trình trước khi shutdown",
    );

    daemon.child.stdin?.write("shutdown\n");
    await waitFor(
      () => daemon.stdout().includes("shutdown-resolved"),
      30_000,
      () =>
        `shutdown() của daemon settle (stdout: ${JSON.stringify(daemon.stdout())}, ` +
        `stderr: ${JSON.stringify(daemon.stderr().slice(-400))})`,
    );

    let survivors = livePids(workspacePids);
    const deadline = Date.now() + 10_000;
    while (survivors.length > 0 && Date.now() < deadline) {
      await sleep(50);
      survivors = livePids(workspacePids);
    }

    assert.deepEqual(
      survivors,
      [],
      `INV-SHIM-4 vỡ: sau shutdown bảng tiến trình còn ${survivors.length}/${workspacePids.length} ` +
        `process con JDT LS: ${JSON.stringify(survivors)} (tất cả: ${JSON.stringify(workspacePids)})`,
    );
    assert.equal(existsSync(socketPath), false, "shutdown cũng không được bỏ lại tệp socket của chính nó");
  },
);
