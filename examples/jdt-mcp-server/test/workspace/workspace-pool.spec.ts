// Level 1 oracle for feat-workspace-pool.
//
// Falsifier under test: "two concurrent first calls for the same project each spawn their own JDT
// LS process instead of converging on one [INV-POOL-5]; or two live workspaces are given the same
// -data directory [INV-POOL-1]".
//
// The process boundary itself is exercised separately, with a real spawned child and the real
// argv, in test/integration/workspace-pool-spawn.integration.spec.ts. This file pins the identity
// and de-duplication logic, where the spawn seam is injected so a single acquire is not a JVM.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { createWorkspacePool, type SpawnWorkspaceArgs } from "../../src/workspace/workspace-pool.ts";

function makeRoot(prefix: string): string {
  return mkdtempSync(path.join(tmpdir(), prefix));
}

function makeProject(root: string, name: string): string {
  const projectRoot = path.join(root, name);
  mkdirSync(projectRoot, { recursive: true });
  return projectRoot;
}

/**
 * A spawn seam that records every call and, critically, does not resolve synchronously: a naive
 * pool that only registers the workspace *after* awaiting its spawn would let a second concurrent
 * call slip through this gap and spawn again.
 */
function makeSpawnRecorder(): {
  spawnWorkspace: (args: SpawnWorkspaceArgs) => Promise<{ pid: number; stop(): Promise<void> }>;
  calls: SpawnWorkspaceArgs[];
} {
  const calls: SpawnWorkspaceArgs[] = [];
  let nextPid = 4_100;
  return {
    calls,
    spawnWorkspace: async (args) => {
      calls.push(args);
      await new Promise((resolve) => setTimeout(resolve, 5));
      const pid = nextPid++;
      return { pid, stop: async () => {} };
    },
  };
}

test(
  "INV-POOL-5: N concurrent first calls for one project converge on a single spawn, one pid and one -data dir",
  { timeout: 5_000 },
  async (t) => {
    const root = makeRoot("jdt-pool-unit-concurrent-");
    t.after(() => rmSync(root, { recursive: true, force: true }));
    const projectRoot = makeProject(root, "alpha");
    const recorder = makeSpawnRecorder();
    const pool = createWorkspacePool({
      cacheRoot: path.join(root, "cache"),
      maxWorkspaces: 3,
      spawnWorkspace: recorder.spawnWorkspace,
    });
    t.after(() => pool.close());

    const leases = await Promise.all(
      Array.from({ length: 8 }, () => pool.acquire(projectRoot)),
    );

    assert.equal(
      recorder.calls.length,
      1,
      `8 concurrent first calls must spawn exactly one JDT LS process, spawned ${recorder.calls.length}`,
    );
    assert.equal(new Set(leases.map((lease) => lease.pid)).size, 1, "every caller must be served by the same process");
    assert.equal(new Set(leases.map((lease) => lease.workspaceId)).size, 1, "one project is one workspace identity");
    assert.equal(new Set(leases.map((lease) => lease.dataDir)).size, 1, "one workspace is one -data directory");
    assert.equal(pool.status().workspaces.length, 1, "pool.status() must show one live workspace, not eight");

    for (const lease of leases) await lease.release();
  },
);

test(
  "INV-POOL-5: a symlinked path to the same project converges on the same workspace, concurrently and afterwards",
  { timeout: 5_000 },
  async (t) => {
    const root = makeRoot("jdt-pool-unit-symlink-");
    t.after(() => rmSync(root, { recursive: true, force: true }));
    const projectRoot = makeProject(root, "beta");
    const aliasRoot = path.join(root, "beta-alias");
    symlinkSync(projectRoot, aliasRoot, "dir");
    const recorder = makeSpawnRecorder();
    const pool = createWorkspacePool({
      cacheRoot: path.join(root, "cache"),
      maxWorkspaces: 3,
      spawnWorkspace: recorder.spawnWorkspace,
    });
    t.after(() => pool.close());

    const [direct, viaSymlink] = await Promise.all([pool.acquire(projectRoot), pool.acquire(aliasRoot)]);

    assert.equal(recorder.calls.length, 1, "a symlink alias of a live project must not spawn a second process");
    assert.equal(viaSymlink.workspaceId, direct.workspaceId, "two paths to one project are one workspace identity");
    assert.equal(viaSymlink.dataDir, direct.dataDir, "the alias must share the project's -data directory, not fork the index");
    assert.equal(viaSymlink.pid, direct.pid);
    assert.equal(pool.status().workspaces.length, 1);

    await direct.release();
    await viaSymlink.release();

    // And sequentially, too: the identity is not an artifact of the in-flight de-duplication.
    const later = await pool.acquire(aliasRoot);
    assert.equal(recorder.calls.length, 1, "re-acquiring a live workspace must reuse its process");
    assert.equal(later.dataDir, direct.dataDir);
    await later.release();
  },
);

test(
  "INV-POOL-1: distinct projects always get distinct absolute -data directories under the cache root",
  { timeout: 5_000 },
  async (t) => {
    const root = makeRoot("jdt-pool-unit-datadir-");
    t.after(() => rmSync(root, { recursive: true, force: true }));
    const cacheRoot = path.join(root, "cache");
    const projects = ["one", "two", "three"].map((name) => makeProject(root, name));
    const recorder = makeSpawnRecorder();
    const pool = createWorkspacePool({ cacheRoot, maxWorkspaces: 3, spawnWorkspace: recorder.spawnWorkspace });
    t.after(() => pool.close());

    const leases = await Promise.all(projects.map((projectRoot) => pool.acquire(projectRoot)));

    const dataDirs = leases.map((lease) => lease.dataDir);
    assert.equal(new Set(dataDirs).size, projects.length, `three live workspaces must hold three distinct -data dirs, got ${dataDirs.join(", ")}`);
    for (const dataDir of dataDirs) {
      assert.ok(path.isAbsolute(dataDir), `-data must be an absolute path, got ${dataDir}`);
      assert.ok(dataDir.startsWith(path.resolve(cacheRoot) + path.sep), `-data must live under the cache root, got ${dataDir}`);
    }

    // The spawned process must receive exactly the directory the pool reports (INV-POOL-1's seam
    // is "pool.status() -data paths + the spawned argv" — they may not disagree).
    const spawnedDataDirs = recorder.calls.map((call) => call.dataDir).sort();
    assert.deepEqual(spawnedDataDirs, [...dataDirs].sort(), "each spawn must be told its own reported -data directory");
    assert.deepEqual(
      pool.status().workspaces.map((workspace) => workspace.dataDir).sort(),
      [...dataDirs].sort(),
    );

    for (const lease of leases) await lease.release();
  },
);

test(
  "INV-POOL-1: a workspace's -data directory is stable across releases and re-acquisitions",
  { timeout: 5_000 },
  async (t) => {
    const root = makeRoot("jdt-pool-unit-stable-");
    t.after(() => rmSync(root, { recursive: true, force: true }));
    const projectRoot = makeProject(root, "gamma");
    const recorder = makeSpawnRecorder();
    const pool = createWorkspacePool({
      cacheRoot: path.join(root, "cache"),
      maxWorkspaces: 3,
      spawnWorkspace: recorder.spawnWorkspace,
    });
    t.after(() => pool.close());

    const first = await pool.acquire(projectRoot);
    await first.release();
    const second = await pool.acquire(projectRoot);

    assert.equal(recorder.calls.length, 1, "an idle-but-live workspace must be reused, not respawned");
    assert.equal(second.dataDir, first.dataDir, "the warm -data directory must be reused verbatim");
    assert.equal(second.pid, first.pid);

    // Identity is derived from the realpath, so the id is independent of how the caller spelled it.
    assert.equal(first.workspaceId.length, 64, "workspace id must be the sha256 identity X-005 specifies");
    const withTrailingNoise = `${projectRoot}${path.sep}.${path.sep}`;
    const third = await pool.acquire(withTrailingNoise);
    assert.equal(third.workspaceId, first.workspaceId, `${withTrailingNoise} is the same project as ${projectRoot}`);
    assert.equal(recorder.calls.length, 1);

    await second.release();
    await third.release();
  },
);

test(
  "a failed first spawn is never cached: the next call retries instead of inheriting a dead workspace",
  { timeout: 5_000 },
  async (t) => {
    const root = makeRoot("jdt-pool-unit-retry-");
    t.after(() => rmSync(root, { recursive: true, force: true }));
    const projectRoot = makeProject(root, "delta");
    let attempts = 0;
    const pool = createWorkspacePool({
      cacheRoot: path.join(root, "cache"),
      maxWorkspaces: 3,
      spawnWorkspace: async () => {
        attempts += 1;
        if (attempts === 1) throw new Error("JVM refused to start");
        return { pid: 9_001, stop: async () => {} };
      },
    });
    t.after(() => pool.close());

    await assert.rejects(() => pool.acquire(projectRoot), /JVM refused to start/);
    assert.equal(pool.status().workspaces.length, 0, "a workspace that never started must not appear live");

    const lease = await pool.acquire(projectRoot);
    assert.equal(attempts, 2, "the second call must retry the spawn, not replay the cached failure");
    assert.equal(lease.pid, 9_001);
    await lease.release();
  },
);

test(
  "acquiring a path that does not exist fails with a named error rather than inventing a workspace",
  { timeout: 5_000 },
  async (t) => {
    const root = makeRoot("jdt-pool-unit-missing-");
    t.after(() => rmSync(root, { recursive: true, force: true }));
    const missing = path.join(root, "no-such-project");
    const recorder = makeSpawnRecorder();
    const pool = createWorkspacePool({
      cacheRoot: path.join(root, "cache"),
      maxWorkspaces: 3,
      spawnWorkspace: recorder.spawnWorkspace,
    });
    t.after(() => pool.close());

    await assert.rejects(
      () => pool.acquire(missing),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.ok(
          (error as Error).message.includes(realpathSync(root)) || (error as Error).message.includes(missing),
          `the error must name the path it could not open; got: ${(error as Error).message}`,
        );
        return true;
      },
    );
    assert.equal(recorder.calls.length, 0, "an unresolvable path must never reach the spawn boundary");
  },
);
