// file-sync-watcher — the client half of filesystem synchronisation (docs/design/runtime-model.md).
//
// Spike C is why this component is v1-blocking rather than polish: rewriting a source file on disk
// to delete a method, with NO LSP notification sent, left JDT LS still resolving the deleted method
// and reporting ZERO errors (docs/design/evidence.md). One workspace/didChangeWatchedFiles corrected
// it within 8 s. JDT LS does not watch the filesystem — the client does, and here the "editor" is an
// AI agent writing files directly.
//
// Invariants owned here:
//   INV-SYNC-2  every observed create, modify, delete and rename under a watched source root
//               produces a workspace/didChangeWatchedFiles notification with the MATCHING change
//               type — no event class is silently dropped (A-008).
//   INV-SYNC-3  a pom.xml change always triggers a project-configuration refresh
//               (java/projectConfigurationUpdate), never only a source-file notification (A-009).
// It also publishes the quiescence marker INV-SYNC-1 is proved through: `settledAt` moves only
// after a debounced batch has been dispatched, so "a notification was sent" and "the workspace has
// settled" stay two distinct, separately observable events.
//
// How the change type is decided, and why it is not read off the OS event: node's fs.watch reports
// "rename" for a create, a delete AND both halves of a real rename, coalesces freely, and on macOS
// replays events for writes made just before the watch was installed. Trusting that stream is how
// an event class gets dropped — or how a file that never changed gets reported. So an event only
// schedules a flush, and the flush diffs a fresh scan of the watched set against the last settled
// picture: absent -> present is Created, present -> absent is Deleted, and a differing
// (mtime, size, inode) is Changed. The editor/agent temp-write-then-rename pattern lands in the
// last case, because the destination keeps its path but takes the temp file's inode.

import { readdirSync, realpathSync, statSync, watch, type Dirent, type FSWatcher } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import type { WorkspaceLease } from "./workspace-pool.ts";

/** LSP `FileChangeType` (LSP spec 3.17, §workspace/didChangeWatchedFiles). */
export const FileChangeType = { Created: 1, Changed: 2, Deleted: 3 } as const;
export type FileChangeTypeValue = (typeof FileChangeType)[keyof typeof FileChangeType];

export const DID_CHANGE_WATCHED_FILES = "workspace/didChangeWatchedFiles";
/** JDT LS custom extension (docs/design/evidence.md, wiki "Language Server Protocol Extensions"). */
export const PROJECT_CONFIGURATION_UPDATE = "java/projectConfigurationUpdate";

/** Standard Maven layout; the roots a workspace's Java sources live under. */
export const DEFAULT_SOURCE_ROOT_PATTERNS = ["src/main/java", "src/test/java"] as const;
/** Directories never worth watching: build output and VCS/tool metadata. */
const EXCLUDED_DIRECTORIES = new Set(["target", "node_modules"]);

export const DEFAULT_DEBOUNCE_MS = 120;

/**
 * The transport seam. `lsp-client` owns Content-Length framing and nothing else may write a frame
 * (docs/design/runtime-model.md), so the watcher never touches a pipe — it hands method + params to
 * a sink the daemon wires to the workspace's LspClient.
 */
export interface LspNotificationSink {
  notify(method: string, params: unknown): void | Promise<void>;
}

export interface WatchedFileChange {
  uri: string;
  type: FileChangeTypeValue;
}

export interface FileSyncWatcherOptions {
  /** The workspace's project root; watched recursively. */
  projectRoot: string;
  notifications: LspNotificationSink;
  /** Quiet period before a batch is dispatched and `settledAt` moves. */
  debounceMs?: number;
  /**
   * Source roots to watch, absolute or relative to `projectRoot`. Defaults to matching
   * `DEFAULT_SOURCE_ROOT_PATTERNS` anywhere under the root, so a multi-module reactor covers
   * `moduleA/src/main/java/...` without enumerating its modules.
   */
  sourceRoots?: readonly string[];
  /** Dispatch failures are reported here rather than thrown into the fs event loop. */
  onError?: (error: Error) => void;
}

export interface FileSyncWatcher {
  readonly projectRoot: string;
  /** Bumped once per dispatched batch — the change generation a tool call carries. */
  readonly generation: number;
  /** Set after a debounced batch has been dispatched. Undefined until the first settle. */
  readonly settledAt: number | undefined;
  /** Set the moment a raw filesystem event is observed, before any debounce. */
  readonly lastChangeAt: number | undefined;
  start(): Promise<void>;
  /** True when every observed change has been dispatched and nothing is in flight. */
  isQuiescent(): boolean;
  /** Resolves with `settledAt` at the NEXT settle point (never immediately). */
  whenSettled(): Promise<number>;
  close(): Promise<void>;
}

interface FileStamp {
  mtimeMs: number;
  size: number;
  ino: number;
}

interface PendingChange {
  filePath: string;
  type: FileChangeTypeValue;
}

class DiskFileSyncWatcher implements FileSyncWatcher {
  readonly #requestedRoot: string;
  readonly #notifications: LspNotificationSink;
  readonly #debounceMs: number;
  readonly #sourceRootPatterns: readonly string[];
  readonly #explicitSourceRoots: string[] | undefined;
  readonly #onError: (error: Error) => void;

  #projectRoot: string;
  #known = new Map<string, FileStamp>();
  #pendingEvent = false;
  #timer: NodeJS.Timeout | undefined;
  #flushing: Promise<void> | undefined;
  #watcher: FSWatcher | undefined;
  #closed = false;
  #generation = 0;
  #settledAt: number | undefined;
  #lastChangeAt: number | undefined;
  #waiters: Array<(settledAt: number) => void> = [];

  public constructor(options: FileSyncWatcherOptions) {
    this.#requestedRoot = path.resolve(options.projectRoot);
    this.#projectRoot = this.#requestedRoot;
    this.#notifications = options.notifications;
    this.#debounceMs = options.debounceMs ?? DEFAULT_DEBOUNCE_MS;
    this.#sourceRootPatterns = DEFAULT_SOURCE_ROOT_PATTERNS;
    this.#explicitSourceRoots = options.sourceRoots?.map((root) =>
      path.resolve(this.#requestedRoot, root),
    );
    this.#onError = options.onError ?? (() => {});
  }

  public get projectRoot(): string {
    return this.#projectRoot;
  }

  public get generation(): number {
    return this.#generation;
  }

  public get settledAt(): number | undefined {
    return this.#settledAt;
  }

  public get lastChangeAt(): number | undefined {
    return this.#lastChangeAt;
  }

  public async start(): Promise<void> {
    if (this.#watcher !== undefined) return;
    if (this.#closed) throw new Error("file-sync-watcher is closed and cannot be restarted");
    let canonicalRoot: string;
    try {
      canonicalRoot = realpathSync(this.#requestedRoot);
    } catch {
      throw new Error(
        `Cannot watch a workspace whose project root does not exist: ${this.#requestedRoot}`,
      );
    }
    this.#projectRoot = canonicalRoot;
    // The pre-edit picture the first diff is taken against.
    this.#known = this.#scan();
    this.#watcher = watch(canonicalRoot, { recursive: true, persistent: true });
    this.#watcher.on("error", (error: Error) => this.#onError(error));
    this.#watcher.on("change", (_eventType: string, filename: string | Buffer | null) => {
      this.#onFilesystemEvent(filename);
    });
  }

  public isQuiescent(): boolean {
    return this.#timer === undefined && this.#flushing === undefined && !this.#pendingEvent;
  }

  public whenSettled(): Promise<number> {
    return new Promise<number>((resolve) => {
      this.#waiters.push(resolve);
    });
  }

  public async close(): Promise<void> {
    if (this.#closed) return;
    this.#closed = true;
    this.#watcher?.close();
    this.#watcher = undefined;
    if (this.#timer !== undefined) {
      clearTimeout(this.#timer);
      this.#timer = undefined;
    }
    // A shutdown must not swallow a batch that was still inside its debounce window.
    if (this.#pendingEvent || this.#flushing !== undefined) await this.#flush();
    this.#releaseWaiters(this.#settledAt ?? Date.now());
  }

  #onFilesystemEvent(_filename: string | Buffer | null): void {
    if (this.#closed) return;
    // Every event schedules a flush, including one naming a temp file or a directory: the event
    // only says "something moved", the diff says what. macOS additionally replays events for
    // writes made just before the watch was installed, so an event is not by itself evidence that
    // a watched file differs from the last settled picture — only the diff is.
    this.#lastChangeAt = Date.now();
    this.#pendingEvent = true;
    this.#schedule();
  }

  #schedule(): void {
    if (this.#timer !== undefined) clearTimeout(this.#timer);
    this.#timer = setTimeout(() => {
      this.#timer = undefined;
      void this.#flush();
    }, this.#debounceMs);
  }

  #flush(): Promise<void> {
    if (this.#flushing !== undefined) {
      // A flush already running: chain, so events that arrived during it are not lost.
      this.#flushing = this.#flushing.then(() => this.#dispatch());
      return this.#flushing;
    }
    this.#flushing = this.#dispatch().finally(() => {
      this.#flushing = undefined;
    });
    return this.#flushing;
  }

  async #dispatch(): Promise<void> {
    this.#pendingEvent = false;
    const current = this.#scan();

    const changes: PendingChange[] = [];
    const record = (filePath: string, type: FileChangeTypeValue): void => {
      changes.push({ filePath, type });
    };

    // The whole watched set is diffed, not just the paths the OS named. That is what makes a
    // coalesced directory rename, a bulk delete and a temp-write-then-rename all report correctly:
    // the type follows from what is on disk now versus what was there at the last settle.
    for (const [filePath, stamp] of current) {
      const previous = this.#known.get(filePath);
      if (previous === undefined) record(filePath, FileChangeType.Created);
      else if (
        previous.mtimeMs !== stamp.mtimeMs ||
        previous.size !== stamp.size ||
        previous.ino !== stamp.ino
      ) {
        // A rename over an existing destination always lands here: the destination keeps its path
        // but takes the temp file's inode and mtime.
        record(filePath, FileChangeType.Changed);
      }
    }
    for (const filePath of this.#known.keys()) {
      if (!current.has(filePath)) record(filePath, FileChangeType.Deleted);
    }
    this.#known = current;

    if (changes.length > 0) {
      this.#generation += 1;
      await this.#send(changes);
    }
    this.#settledAt = Date.now();
    this.#releaseWaiters(this.#settledAt);
  }

  async #send(changes: PendingChange[]): Promise<void> {
    const watchedFileChanges: WatchedFileChange[] = changes.map((change) => ({
      uri: pathToFileURL(change.filePath).href,
      type: change.type,
    }));
    try {
      await this.#notifications.notify(DID_CHANGE_WATCHED_FILES, { changes: watchedFileChanges });
    } catch (error) {
      this.#onError(error instanceof Error ? error : new Error(String(error)));
    }

    // INV-SYNC-3: a build-file change is a project-model change. A watched-file notification alone
    // leaves the daemon answering with the old classpath, which is confidently wrong rather than
    // merely stale. A deleted pom refreshes through the root pom, since its own uri no longer names
    // anything the server can read.
    const refreshTargets = new Set<string>();
    for (const change of changes) {
      if (path.basename(change.filePath) !== "pom.xml") continue;
      refreshTargets.add(
        change.type === FileChangeType.Deleted
          ? path.join(this.#projectRoot, "pom.xml")
          : change.filePath,
      );
    }
    for (const target of refreshTargets) {
      try {
        await this.#notifications.notify(PROJECT_CONFIGURATION_UPDATE, {
          uri: pathToFileURL(target).href,
        });
      } catch (error) {
        this.#onError(error instanceof Error ? error : new Error(String(error)));
      }
    }
  }

  #releaseWaiters(settledAt: number): void {
    const waiters = this.#waiters;
    this.#waiters = [];
    for (const waiter of waiters) waiter(settledAt);
  }

  #scan(): Map<string, FileStamp> {
    const found = new Map<string, FileStamp>();
    const walk = (directory: string): void => {
      let entries: Dirent[];
      try {
        entries = readdirSync(directory, { withFileTypes: true });
      } catch {
        return; // raced away mid-scan; the next diff picks it up as a deletion
      }
      for (const entry of entries) {
        const absolute = path.join(directory, entry.name);
        if (entry.isDirectory()) {
          if (!EXCLUDED_DIRECTORIES.has(entry.name) && !entry.name.startsWith(".")) walk(absolute);
          continue;
        }
        if (!entry.isFile()) continue; // symlinks are not followed: a cycle would never terminate
        if (!this.#isWatchedPath(absolute)) continue;
        try {
          const stat = statSync(absolute);
          found.set(absolute, { mtimeMs: stat.mtimeMs, size: stat.size, ino: stat.ino });
        } catch {
          // deleted between readdir and stat; the next diff reports it
        }
      }
    };
    walk(this.#projectRoot);
    return found;
  }

  /** Purely path-based, because a deleted file cannot be stat'd but still needs a notification. */
  #isWatchedPath(absolute: string): boolean {
    if (path.basename(absolute) === "pom.xml") return this.#isInsideProject(absolute);
    if (!absolute.endsWith(".java")) return false;
    if (this.#explicitSourceRoots !== undefined) {
      return this.#explicitSourceRoots.some((root) => absolute.startsWith(root + path.sep));
    }
    if (!this.#isInsideProject(absolute)) return false;
    const relative = path.relative(this.#projectRoot, absolute).split(path.sep).join("/");
    return this.#sourceRootPatterns.some(
      (pattern) => relative.startsWith(`${pattern}/`) || relative.includes(`/${pattern}/`),
    );
  }

  #isInsideProject(absolute: string): boolean {
    const relative = path.relative(this.#projectRoot, absolute);
    return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
  }
}

export function createFileSyncWatcher(options: FileSyncWatcherOptions): FileSyncWatcher {
  return new DiskFileSyncWatcher(options);
}

/**
 * Attach a watcher to an acquired workspace. The lease owns the JDT LS process; the watcher owns
 * telling it what changed underneath.
 */
export function watchWorkspace(
  lease: Pick<WorkspaceLease, "projectRoot">,
  notifications: LspNotificationSink,
  options: Omit<FileSyncWatcherOptions, "projectRoot" | "notifications"> = {},
): FileSyncWatcher {
  return createFileSyncWatcher({ ...options, projectRoot: lease.projectRoot, notifications });
}

/**
 * Ngữ cảnh một TIẾN TRÌNH JDT LS vừa được spawn. Cấu trúc này khớp `WorkspaceAttachContext` của
 * workspace-pool mà không cần import ngược, nên watcher không biết gì về pool.
 */
export interface SpawnedWorkspaceContext {
  workspaceId: string;
  projectRoot: string;
  /** LspClient thoả `LspNotificationSink` ngay khi nó có `notify(method, params?)`. */
  client?: LspNotificationSink;
}

export interface FileSyncAttachmentOptions
  extends Omit<FileSyncWatcherOptions, "projectRoot" | "notifications"> {
  /** Trao watcher cho daemon, nơi INV-SYNC-1 dùng `generation`/`whenSettled()` để chặn tool call. */
  onStarted?: (context: SpawnedWorkspaceContext, watcher: FileSyncWatcher) => void;
}

/**
 * Nối dây production của chiều gửi: một watcher cho mỗi tiến trình JDT LS, sink trỏ thẳng vào
 * `client.notify`. Vòng đời là spawn ↔ evict, KHÔNG phải acquire ↔ release — một tiến trình ấm phục
 * vụ nhiều lease, nên dựng watcher theo từng lease vừa nhân bản watcher vừa nhân bản notification.
 *
 * Trả về hàm gỡ đóng watcher; `undefined` khi tiến trình không nói LSP (spawn seam giả trong test),
 * vì một watcher không có nơi để gửi chỉ là một vòng quét đĩa vô ích.
 */
export function attachFileSync(
  options: FileSyncAttachmentOptions = {},
): (context: SpawnedWorkspaceContext) => (() => Promise<void>) | undefined {
  const { onStarted, ...watcherOptions } = options;
  return (context: SpawnedWorkspaceContext) => {
    const client = context.client;
    if (client === undefined) return undefined;
    const watcher = createFileSyncWatcher({
      ...watcherOptions,
      projectRoot: context.projectRoot,
      notifications: client,
    });
    const reportError = watcherOptions.onError ?? ((): void => {});
    // start() là bất đồng bộ nhưng attachment thì không: một lỗi khởi động phải đi ra cổng onError
    // chứ không thành unhandled rejection giết cả tiến trình daemon.
    void watcher.start().catch((error: unknown) => {
      reportError(error instanceof Error ? error : new Error(String(error)));
    });
    onStarted?.(context, watcher);
    return () => watcher.close();
  };
}
