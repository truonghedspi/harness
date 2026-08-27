import type { EventEmitter } from "node:events";
import type { Readable, Writable } from "node:stream";

export interface LspProcess extends EventEmitter {
  readonly stdout: Readable;
  readonly stdin: Writable;
}

export type ServerRequestHandler = (
  params: unknown,
) => unknown | Promise<unknown>;

/**
 * Handler cho thông điệp đẩy từ server. Notification không có ai để trả lời, nên nó không trả về
 * giá trị — chữ ký này khớp đúng cổng `LspNotificationSource` mà diagnostics-cache khai báo.
 */
export type NotificationHandler = (params: unknown) => void;

export class LspClient {
  readonly #process: LspProcess;
  readonly #pending = new Map<
    number,
    { resolve: (value: unknown) => void; reject: (reason: Error) => void }
  >();
  readonly #requestHandlers = new Map<string, ServerRequestHandler>();
  readonly #notificationHandlers = new Map<string, NotificationHandler[]>();
  #nextId = 1;
  #readBuffer = Buffer.alloc(0);
  #exited: Error | undefined;

  public constructor(process: LspProcess) {
    this.#process = process;
    process.stdout.on("data", (chunk: Buffer | string) => {
      this.#readBuffer = Buffer.concat([this.#readBuffer, Buffer.from(chunk)]);
      this.#drainFrames();
    });
    process.on("exit", (code: number | null, signal: NodeJS.Signals | null) => {
      const detail = code === null ? `signal ${signal ?? "unknown"}` : `code ${code}`;
      this.#exited = new Error(`JDT LS process exited with ${detail}`);
      for (const { reject } of this.#pending.values()) reject(this.#exited);
      this.#pending.clear();
    });
  }

  public onRequest(method: string, handler: ServerRequestHandler): void {
    this.#requestHandlers.set(method, handler);
  }

  /**
   * Đăng ký một subscriber cho notification server→client. Đăng ký cộng dồn, không ghi đè: nhiều
   * thành phần (cache diagnostics, theo dõi trạng thái) cùng nghe một method, và không thành phần
   * nào được huỷ đăng ký của thành phần khác chỉ vì đăng ký sau. Hàm trả về gỡ đúng subscriber này.
   */
  public onNotification(method: string, handler: NotificationHandler): () => void {
    const handlers = this.#notificationHandlers.get(method);
    if (handlers === undefined) this.#notificationHandlers.set(method, [handler]);
    else handlers.push(handler);

    return () => {
      const current = this.#notificationHandlers.get(method);
      if (current === undefined) return;
      const index = current.indexOf(handler);
      if (index >= 0) current.splice(index, 1);
      if (current.length === 0) this.#notificationHandlers.delete(method);
    };
  }

  /**
   * Gửi một notification client→server. Khác request ở đúng một điểm trên dây: khung không mang
   * `id`. Vì vậy phương thức này không lấy số từ #nextId và không đặt ô nào vào bảng tương quan —
   * một notification mang id sẽ bị JDT LS coi là request, và ô đó không bao giờ được giải quyết.
   */
  public notify(method: string, params?: unknown): void {
    if (this.#exited) throw this.#exited;
    const message: Record<string, unknown> = { jsonrpc: "2.0", method };
    if (params !== undefined) message.params = params;
    this.#write(message);
  }

  public request(method: string, params?: unknown): Promise<unknown> {
    if (this.#exited) return Promise.reject(this.#exited);
    const id = this.#nextId++;
    const message: Record<string, unknown> = { jsonrpc: "2.0", id, method };
    if (params !== undefined) message.params = params;

    return new Promise((resolve, reject) => {
      this.#pending.set(id, { resolve, reject });
      this.#write(message);
    });
  }

  #write(message: unknown): void {
    const body = Buffer.from(JSON.stringify(message));
    this.#process.stdin.write(
      Buffer.concat([
        Buffer.from(`Content-Length: ${body.byteLength}\r\n\r\n`),
        body,
      ]),
    );
  }

  #drainFrames(): void {
    while (true) {
      const separator = this.#readBuffer.indexOf("\r\n\r\n");
      if (separator < 0) return;

      const header = this.#readBuffer.subarray(0, separator).toString("ascii");
      const match = /^Content-Length:\s*(\d+)\s*$/im.exec(header);
      if (!match) {
        this.#failAll(new Error("Invalid LSP frame: missing Content-Length header"));
        this.#readBuffer = Buffer.alloc(0);
        return;
      }

      const bodyLength = Number.parseInt(match[1], 10);
      const frameLength = separator + 4 + bodyLength;
      if (this.#readBuffer.byteLength < frameLength) return;

      const body = this.#readBuffer.subarray(separator + 4, frameLength);
      this.#readBuffer = this.#readBuffer.subarray(frameLength);
      try {
        void this.#handleMessage(JSON.parse(body.toString()) as Record<string, unknown>);
      } catch (error) {
        this.#failAll(error instanceof Error ? error : new Error(String(error)));
      }
    }
  }

  async #handleMessage(message: Record<string, unknown>): Promise<void> {
    if (typeof message.method === "string" && message.id !== undefined) {
      const handler = this.#requestHandlers.get(message.method);
      if (!handler) {
        this.#write({
          jsonrpc: "2.0",
          id: message.id,
          error: { code: -32601, message: `Method not found: ${message.method}` },
        });
        return;
      }
      try {
        const result = await handler(message.params);
        this.#write({ jsonrpc: "2.0", id: message.id, result });
      } catch (error) {
        this.#write({
          jsonrpc: "2.0",
          id: message.id,
          error: { code: -32603, message: error instanceof Error ? error.message : String(error) },
        });
      }
      return;
    }

    // Notification server→client: có method, không có id. Trước đây nhánh này rơi vào lệnh return
    // bên dưới và bị bỏ im lặng, nên textDocument/publishDiagnostics không bao giờ tới cache.
    if (typeof message.method === "string") {
      const handlers = this.#notificationHandlers.get(message.method);
      if (handlers === undefined) return;
      // Chụp lại danh sách: một handler có thể đăng ký hoặc gỡ đăng ký ngay trong lúc dispatch.
      for (const handler of [...handlers]) {
        try {
          handler(message.params);
        } catch {
          // Notification là đường một chiều, không có kênh nào để trả lỗi về. Một subscriber hỏng
          // không được chặn subscriber còn lại, cũng không được làm chết vòng đọc khung.
        }
      }
      return;
    }

    if (typeof message.id !== "number") return;
    const pending = this.#pending.get(message.id);
    if (!pending) return;
    this.#pending.delete(message.id);
    if (message.error !== undefined) {
      const error = message.error as { message?: unknown };
      pending.reject(new Error(String(error.message ?? "LSP request failed")));
    } else {
      pending.resolve(message.result);
    }
  }

  #failAll(error: Error): void {
    for (const { reject } of this.#pending.values()) reject(error);
    this.#pending.clear();
  }
}
