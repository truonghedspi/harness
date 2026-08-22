// Level 3 (process-boundary) integration oracle for feat-workspace-pool.
//
// The falsifier is stated in terms of real processes and real argv: "two concurrent first calls
// for the same project each spawn their own JDT LS process [INV-POOL-5]; or two live workspaces
// are given the same -data directory [INV-POOL-1]". runtime-model.md names the observable seams
// as "pid count under N parallel first calls" and "pool.status() -data paths + the spawned argv",
// so this file drives the pool's *default* spawner — no injected seam — and reads both from the
// outside: OS pids that must exist and then stop existing, and the argv a real child received.
//
// The JDT LS distribution and the JVM are stubbed the way
// test/integration/jdtls-provisioner.integration.spec.ts stubs them: a real executable `java`
// script materialized to a tmpdir at run time (testing-standards.md warns that a fixture file
// under a literal `test/` path is swept into Node's default discovery glob), plus a JDTLS_HOME
// holding a resolvable launcher jar. The child is a real, separately scheduled OS process that
// records its own pid and argv and then stays alive, exactly as a JVM would.

import { test } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { createWorkspacePool } from "../../src/workspace/workspace-pool.ts";
import { PINNED_JDTLS_VERSION } from "../../src/provision/jdtls-provisioner.ts";

const SETTLE_MS = 400;

interface SpawnRecord {
  pid: number;
  argv: string[];
}

// Each child writes its own record file, named for its real pid: concurrent children appending to
// one shared log interleave their writes at the syscall level and would make the count an artifact
// of the fixture rather than of the pool.
function makeFakeJava(root: string, logDir: string): string {
  const javaHome = path.join(root, "jdk-21");
  const binDir = path.join(javaHome, "bin");
  mkdirSync(binDir, { recursive: true });
  const javaBin = path.join(binDir, "java");
  const script =
    "#!/bin/sh\n" +
    'if [ "$1" = "-version" ]; then\n' +
    "  echo 'openjdk version \"21.0.1\" 2024-01-16' 1>&2\n" +
    "  exit 0\n" +
    "fi\n" +
    "{\n" +
    "  printf 'PID %s\\n' \"$$\"\n" +
    '  for arg in "$@"; do printf \'ARG %s\\n\' "$arg"; done\n' +
    "  printf 'END\\n'\n" +
    `} > '${logDir}'/\"$$\".txt\n` +
    "exec sleep 300\n";
  writeFileSync(javaBin, script, { mode: 0o755 });
  chmodSync(javaBin, 0o755);
  return javaHome;
}

function makeFakeJdtlsHome(root: string): string {
  const home = path.join(root, "jdtls");
  const plugins = path.join(home, "plugins");
  mkdirSync(plugins, { recursive: true });
  writeFileSync(path.join(plugins, `org.eclipse.jdt.ls.core_${PINNED_JDTLS_VERSION}.jar`), "fixture");
  writeFileSync(path.join(plugins, "org.eclipse.equinox.launcher_1.6.900.v20240613-2009.jar"), "fixture");
  // Every platform's configuration directory, so the pool's own platform mapping is exercised
  // rather than duplicated here.
  for (const name of ["config_mac_arm", "config_mac", "config_linux", "config_linux_arm", "config_win"]) {
    mkdirSync(path.join(home, name), { recursive: true });
  }
  return home;
}

function readSpawnLog(logDir: string): SpawnRecord[] {
  if (!existsSync(logDir)) return [];
  const records: SpawnRecord[] = [];
  for (const file of readdirSync(logDir).sort()) {
    const lines = readFileSync(path.join(logDir, file), "utf8").split("\n");
    if (!lines.includes("END")) continue; // a record still being written
    const pid = Number(lines.find((line) => line.startsWith("PID "))?.slice(4));
    const argv = lines.filter((line) => line.startsWith("ARG ")).map((line) => line.slice(4));
    records.push({ pid, argv });
  }
  return records;
}

function argValue(argv: string[], flag: string): string | undefined {
  const index = argv.indexOf(flag);
  return index >= 0 ? argv[index + 1] : undefined;
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitUntilDead(pid: number, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!isAlive(pid)) return true;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return !isAlive(pid);
}

function makeFixture(t: { after: (fn: () => void) => void }, prefix: string): { root: string; logPath: string } {
  const root = mkdtempSync(path.join(tmpdir(), prefix));
  const logPath = path.join(root, "spawn-log");
  mkdirSync(logPath, { recursive: true });
  const javaHome = makeFakeJava(root, logPath);
  const jdtlsHome = makeFakeJdtlsHome(root);

  const previous = { JAVA_HOME: process.env.JAVA_HOME, JDTLS_HOME: process.env.JDTLS_HOME };
  process.env.JAVA_HOME = javaHome;
  process.env.JDTLS_HOME = jdtlsHome;

  t.after(() => {
    for (const record of readSpawnLog(logPath)) {
      if (isAlive(record.pid)) {
        try {
          process.kill(record.pid, "SIGKILL");
        } catch {
          /* already gone */
        }
      }
    }
    if (previous.JAVA_HOME === undefined) delete process.env.JAVA_HOME;
    else process.env.JAVA_HOME = previous.JAVA_HOME;
    if (previous.JDTLS_HOME === undefined) delete process.env.JDTLS_HOME;
    else process.env.JDTLS_HOME = previous.JDTLS_HOME;
    rmSync(root, { recursive: true, force: true });
  });

  return { root, logPath };
}

test(
  "INV-POOL-5: six concurrent first calls for one project start exactly one real OS process, and closing the pool ends it",
  { timeout: 30_000 },
  async (t) => {
    const { root, logPath } = makeFixture(t, "jdt-pool-spawn-concurrent-");
    const projectRoot = path.join(root, "projects", "alpha");
    mkdirSync(projectRoot, { recursive: true });

    const pool = createWorkspacePool({ cacheRoot: path.join(root, "cache"), maxWorkspaces: 3 });
    t.after(() => pool.close());

    const leases = await Promise.all(Array.from({ length: 6 }, () => pool.acquire(projectRoot)));
    // The children write their record after exec; give any surplus child time to appear, so
    // "exactly one" is a real count and not a race the pool happens to win.
    await new Promise((resolve) => setTimeout(resolve, SETTLE_MS));

    const records = readSpawnLog(logPath);
    assert.equal(
      records.length,
      1,
      `six concurrent first calls must produce one spawned JDT LS process; the real children logged ${records.length}: ${JSON.stringify(records.map((record) => record.pid))}`,
    );
    assert.equal(new Set(leases.map((lease) => lease.pid)).size, 1, "every caller must hold the same pid");
    assert.equal(leases[0]!.pid, records[0]!.pid, "the pid the pool reports must be the pid the OS actually started");
    assert.ok(isAlive(records[0]!.pid), "the spawned workspace process must really be running");
    assert.equal(argValue(records[0]!.argv, "-data"), leases[0]!.dataDir, "the child's real argv must carry the reported -data directory");

    for (const lease of leases) await lease.release();
    await pool.close();

    assert.ok(await waitUntilDead(records[0]!.pid, 10_000), "closing the pool must terminate the real process it started");
    assert.deepEqual(pool.status().workspaces, [], "a closed pool reports no live workspaces");
    assert.ok(existsSync(leases[0]!.dataDir), "the -data directory survives the process (INV-POOL-4)");
  },
);

test(
  "INV-POOL-1: concurrently live workspaces receive distinct absolute -data directories in their real argv, and a symlink alias adds none",
  { timeout: 30_000 },
  async (t) => {
    const { root, logPath } = makeFixture(t, "jdt-pool-spawn-datadir-");
    const projects = ["one", "two"].map((name) => {
      const projectRoot = path.join(root, "projects", name);
      mkdirSync(projectRoot, { recursive: true });
      return projectRoot;
    });
    const alias = path.join(root, "projects", "one-alias");
    symlinkSync(projects[0]!, alias, "dir");

    const pool = createWorkspacePool({ cacheRoot: path.join(root, "cache"), maxWorkspaces: 3 });
    t.after(() => pool.close());

    const leases = await Promise.all([...projects, alias].map((projectRoot) => pool.acquire(projectRoot)));
    await new Promise((resolve) => setTimeout(resolve, SETTLE_MS));

    const records = readSpawnLog(logPath);
    assert.equal(records.length, 2, `two distinct projects plus a symlink alias must start two processes, not ${records.length}`);

    const spawnedDataDirs = records.map((record) => argValue(record.argv, "-data"));
    for (const dataDir of spawnedDataDirs) {
      assert.ok(dataDir && path.isAbsolute(dataDir), `every spawned JDT LS must receive an absolute -data path, got ${String(dataDir)}`);
    }
    assert.equal(new Set(spawnedDataDirs).size, 2, `two live workspaces must never share a -data directory: ${spawnedDataDirs.join(" | ")}`);
    assert.deepEqual(
      [...spawnedDataDirs].sort(),
      pool.status().workspaces.map((workspace) => workspace.dataDir).sort(),
      "the -data paths in the real argv must be exactly the ones pool.status() reports",
    );

    // The alias is the same project as projects[0]: same identity, same process, no third -data dir.
    assert.equal(leases[2]!.workspaceId, leases[0]!.workspaceId);
    assert.equal(leases[2]!.pid, leases[0]!.pid, "a symlinked path must be served by the project's existing process");
    assert.notEqual(leases[1]!.dataDir, leases[0]!.dataDir);

    // The launch line is the documented one, against the real install layout.
    const configuration = argValue(records[0]!.argv, "-configuration");
    assert.ok(configuration && existsSync(configuration), `-configuration must name an existing directory, got ${String(configuration)}`);
    assert.ok(
      records[0]!.argv.some((arg) => arg.endsWith(".jar") && path.basename(arg).startsWith("org.eclipse.equinox.launcher_")),
      `argv must launch the Equinox launcher jar: ${records[0]!.argv.join(" ")}`,
    );

    for (const lease of leases) await lease.release();
    await pool.close();
    for (const record of records) {
      assert.ok(await waitUntilDead(record.pid, 10_000), `closing the pool must terminate pid ${record.pid}`);
    }
  },
);
