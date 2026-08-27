// Traceability (skills/test-design/SKILL.md, role: Test-Implementer).
//
// Conditions: TCON-POOL-0001, TCON-POOL-0002, TCON-POOL-0003
// Requirements: INV-POOL-2, INV-POOL-4
// Plan: TP-POOL-0001 | Feature: feat-prove-pool-lifecycle
//
// This oracle is derived only from the conditions and the documented workspace-pool seam. It
// deliberately does not read an implementation body. The expected public contract is:
//
//   createWorkspacePool({ maxWorkspaces, cacheRoot, spawnWorkspace })
//   pool.acquire(projectRoot) -> { workspaceId, dataDir, release() }
//   pool.status() -> { workspaces: [{ workspaceId, projectRoot, dataDir, state }] }
//   pool.close()
//
// `spawnWorkspace` is the process system-boundary seam. It returns a stoppable fake process so
// these tests can observe the exact spawn/evict order without starting JDT LS.

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

type WorkspaceState = "idle" | "busy" | "starting" | "stopping";

interface WorkspaceStatus {
  workspaceId: string;
  projectRoot: string;
  dataDir: string;
  state: WorkspaceState;
}

interface WorkspaceLease {
  workspaceId: string;
  dataDir: string;
  release(): Promise<void> | void;
}

interface WorkspacePool {
  acquire(projectRoot: string): Promise<WorkspaceLease>;
  status(): Promise<{ workspaces: WorkspaceStatus[] }> | { workspaces: WorkspaceStatus[] };
  close(): Promise<void> | void;
}

interface SpawnedWorkspace {
  pid: number;
  stop(): Promise<void>;
}

interface PoolFactoryOptions {
  maxWorkspaces: number;
  cacheRoot: string;
  spawnWorkspace(args: { projectRoot: string; dataDir: string }): Promise<SpawnedWorkspace>;
}

type CreateWorkspacePool = (options: PoolFactoryOptions) => WorkspacePool;

async function loadPoolFactory(): Promise<CreateWorkspacePool> {
  try {
    const module = (await import("../../src/workspace/workspace-pool.ts")) as {
      createWorkspacePool?: CreateWorkspacePool;
    };
    assert.equal(
      typeof module.createWorkspacePool,
      "function",
      "workspace-pool must export createWorkspacePool so INV-POOL-2/4 can be exercised",
    );
    return module.createWorkspacePool!;
  } catch (error) {
    assert.fail(
      `workspace-pool behavior required by INV-POOL-2/4 is absent: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function makeProjects(root: string, count: number): string[] {
  return Array.from({ length: count }, (_, index) => {
    const projectRoot = path.join(root, `project-${index}`);
    mkdirSync(projectRoot, { recursive: true });
    return projectRoot;
  });
}

async function statuses(pool: WorkspacePool): Promise<WorkspaceStatus[]> {
  return (await pool.status()).workspaces;
}

function workspaceForProject(all: WorkspaceStatus[], projectRoot: string): WorkspaceStatus | undefined {
  return all.find((workspace) => workspace.projectRoot === projectRoot);
}

function makeSpawnRecorder(cap: number): {
  spawnWorkspace: PoolFactoryOptions["spawnWorkspace"];
  liveProjects: Set<string>;
  peakLive: () => number;
  stopOrder: string[];
} {
  const liveProjects = new Set<string>();
  const stopOrder: string[] = [];
  let peak = 0;
  let nextPid = 10_000;

  return {
    liveProjects,
    stopOrder,
    peakLive: () => peak,
    spawnWorkspace: async ({ projectRoot, dataDir }) => {
      assert.ok(path.isAbsolute(dataDir), "every spawned workspace must receive an absolute -data directory");
      mkdirSync(dataDir, { recursive: true });
      liveProjects.add(projectRoot);
      peak = Math.max(peak, liveProjects.size);
      assert.ok(
        liveProjects.size <= cap,
        `pool spawned ${liveProjects.size} live processes with cap ${cap}; idle eviction must happen before spawn`,
      );
      const pid = nextPid++;
      return {
        pid,
        stop: async () => {
          assert.ok(liveProjects.delete(projectRoot), `workspace ${projectRoot} must be live when evicted`);
          stopOrder.push(projectRoot);
        },
      };
    },
  };
}

// TCON-POOL-0001 -- invariant after every command in collision-heavy sequences.
test("TCON-POOL-0001: live process count never exceeds the configured cap after any acquire/release sequence", { timeout: 5_000 }, async (t) => {
  const createWorkspacePool = await loadPoolFactory();
  const root = mkdtempSync(path.join(tmpdir(), "jdt-pool-cap-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const cap = 2;
  const projects = makeProjects(root, 5);
  const recorder = makeSpawnRecorder(cap);
  const pool = createWorkspacePool({ maxWorkspaces: cap, cacheRoot: path.join(root, "cache"), spawnWorkspace: recorder.spawnWorkspace });
  t.after(() => pool.close());

  // Deterministic generated sequences deliberately reuse a narrow project domain (G1), include
  // cap-1/cap/cap+1 boundaries (G2), and repeatedly cross the cap (G4).
  const sequences = [
    [0, 1, 2, 3, 4],
    [0, 1, 0, 2, 1, 3, 4, 0],
    [4, 3, 2, 1, 0, 2, 4, 1, 3],
  ];
  for (const sequence of sequences) {
    for (const projectIndex of sequence) {
      const lease = await pool.acquire(projects[projectIndex]!);
      await lease.release();
      assert.ok((await statuses(pool)).length <= cap, "status must never contain more workspaces than the cap");
      assert.ok(recorder.liveProjects.size <= cap, "the real live-process count must never exceed the cap");
    }
  }
  assert.equal(recorder.peakLive(), cap, "fixture must reach the cap so the invariant is not vacuous");
});

// TCON-POOL-0002 -- model-based LRU-idle selection, including overall-oldest-busy.
test("TCON-POOL-0002: every eviction selects the least-recently-used idle workspace and never a busy workspace", { timeout: 5_000 }, async (t) => {
  const createWorkspacePool = await loadPoolFactory();
  const root = mkdtempSync(path.join(tmpdir(), "jdt-pool-lru-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const projects = makeProjects(root, 4);
  const recorder = makeSpawnRecorder(2);
  const pool = createWorkspacePool({ maxWorkspaces: 2, cacheRoot: path.join(root, "cache"), spawnWorkspace: recorder.spawnWorkspace });
  t.after(() => pool.close());

  const oldestBusy = await pool.acquire(projects[0]!);
  const leastRecentlyUsedIdle = await pool.acquire(projects[1]!);
  await leastRecentlyUsedIdle.release();

  const newcomer = await pool.acquire(projects[2]!);
  assert.deepEqual(recorder.stopOrder, [projects[1]], "the only idle workspace must be evicted even when a busy workspace is older");
  assert.ok(recorder.liveProjects.has(projects[0]!), "the overall-oldest busy workspace must remain live");
  await newcomer.release();
  await oldestBusy.release();

  // Refresh project 0, making project 2 the reference model's LRU-idle candidate.
  const refreshed = await pool.acquire(projects[0]!);
  await refreshed.release();
  const fourth = await pool.acquire(projects[3]!);
  assert.deepEqual(recorder.stopOrder, [projects[1], projects[2]], "eviction order must agree with the LRU-idle reference model");
  await fourth.release();
});

// TCON-POOL-0003 -- invariant immediately after every eviction, including repeated identities.
test("TCON-POOL-0003: eviction always preserves the absolute data directory for warm restart", { timeout: 5_000 }, async (t) => {
  const createWorkspacePool = await loadPoolFactory();
  const root = mkdtempSync(path.join(tmpdir(), "jdt-pool-data-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const projects = makeProjects(root, 3);
  const recorder = makeSpawnRecorder(1);
  const pool = createWorkspacePool({ maxWorkspaces: 1, cacheRoot: path.join(root, "cache"), spawnWorkspace: recorder.spawnWorkspace });
  t.after(() => pool.close());

  const rememberedDataDirs = new Map<string, string>();
  for (const projectRoot of [projects[0]!, projects[1]!, projects[0]!, projects[2]!, projects[0]!]) {
    const lease = await pool.acquire(projectRoot);
    const priorDataDir = rememberedDataDirs.get(projectRoot);
    if (priorDataDir) assert.equal(lease.dataDir, priorDataDir, "a re-requested workspace must reuse its warm -data directory");
    rememberedDataDirs.set(projectRoot, lease.dataDir);
    await lease.release();

    const live = await statuses(pool);
    for (const evictedProject of recorder.stopOrder) {
      // TCON-POOL-0003 giới hạn sự vắng mặt khỏi status vào đúng thời điểm evict. Một project đã bị
      // evict rồi được acquire lại (fixture cố ý làm vậy với project-0) đang sống hợp lệ, nên chỉ
      // khẳng định vắng mặt cho project chưa được acquire lại kể từ lần evict.
      if (!recorder.liveProjects.has(evictedProject)) {
        assert.equal(workspaceForProject(live, evictedProject), undefined, "an evicted workspace must be absent from pool.status()");
      }
      // INV-POOL-4: thư mục -data phải tồn tại cho MỌI workspace từng bị evict, không có ngoại lệ.
      const dataDir = rememberedDataDirs.get(evictedProject);
      assert.ok(dataDir, `test must have observed ${evictedProject}'s data directory before eviction`);
      assert.ok(existsSync(dataDir), `eviction must preserve ${evictedProject}'s -data directory at ${dataDir}`);
    }
  }
  assert.ok(recorder.stopOrder.filter((project) => project === projects[0]).length >= 2, "fixture must evict the same workspace repeatedly");
});
