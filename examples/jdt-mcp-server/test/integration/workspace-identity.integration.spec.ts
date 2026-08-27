// Traceability (skills/test-design/SKILL.md, role: Test-Implementer).
//
//   plan_id:  TP-WSID-0001                        (harness/tests/design/plans/TP-WSID-0001/)
//   feature:  feat-prove-workspace-identity        (harness/feature_list.json)
//   conditions / requirements implemented in this file:
//     TCON-WSID-0001  INV-POOL-1   for every path in the routing fixture tree, the lease the pool
//                                  serves for the router's own projectRoot carries exactly the
//                                  workspaceId the router returned for that path -- no exemptions
//     TCON-WSID-0002  INV-POOL-1   two paths the router puts in ONE project get one identical
//                                  workspaceId, one identical absolute dataDir, and exactly one
//                                  live workspace in status() -- never two
//     TCON-WSID-0003  INV-POOL-1   two paths the router keeps APART get different workspaceIds and
//                                  different dataDirs, every dataDir absolute, and no two live
//                                  workspaces in status() ever share a dataDir
//
// Spec refs: docs/design/runtime-model.md#INV-POOL-1 (and :50-52), #INV-ROUTE-3;
// docs/design/architecture.md:47 and :209-210; docs/cross-cutting.md#X-005.
//
// Deliberate omissions, taken verbatim from TP-WSID-0001's spec_gaps -- do not "strengthen" them:
//
//   (1) No digest here is ever compared with a hard-coded literal, and no hashing helper is
//       imported from src to re-derive one. X-005 leaves the identity algorithm OPEN, so pinning
//       it would test the recommendation instead of the agreement, and would go red on a
//       legitimate future change applied to both sides. Consequence, stated so nobody expects
//       otherwise: a mutation applied identically to BOTH derivations survives this file. That is
//       not drift, and no oracle can tell it apart from a settled change of algorithm while X-005
//       is open. What this file DOES catch is one side changing alone.
//   (2) No `projectRoot` STRING is ever compared across two calls. The spec never settles whether
//       the router returns the canonical root or the caller-facing one, and the choice is
//       invisible until a symlink alias is used. Only workspaceId values and dataDir paths are
//       compared, and pool.acquire is always called with whatever projectRoot the router returned
//       for that path -- which is also the runtime call shape, since the pool is reached through
//       the router.
//   (3) The equivalence classes below are read off the ROUTER's own output at runtime, never
//       hard-coded. X-005 leaves it open whether a symlink alias is the same workspace as its real
//       root; under either reading these three conditions hold, because the claim is that the pool
//       honours exactly the partition the router produced -- whatever that partition turns out to
//       be. The alias stays in the fixture precisely because the two components must agree on it
//       either way.
//
// INV-POOL-1 names its observable seam as "pool.status() -data paths + the spawned argv", so
// dataDir is read from all three public places: the WorkspaceLease from acquire(), the
// WorkspaceStatus rows of status(), and the SpawnWorkspaceArgs the pool hands to the
// spawnWorkspace hook of WorkspacePoolOptions. That hook is an injectable option, so the argv half
// is observable without starting a JVM. A fixture reading only the lease would miss a pool that
// reports one dataDir and spawns another.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { resolveWorkspace } from "../../src/workspace/project-router.ts";
import {
  createWorkspacePool,
  type SpawnWorkspaceArgs,
  type WorkspaceLease,
  type WorkspacePool,
  type WorkspaceStatus,
} from "../../src/workspace/workspace-pool.ts";

// ---------------------------------------------------------------------------------------------
// Fixture -- a real Maven-shaped tree on disk, built fresh per test and removed via t.after().
// The filesystem is the real seam for both components (ancestor pom.xml walking, realpath), so
// nothing here is mocked except the process boundary.
// ---------------------------------------------------------------------------------------------

function makeTempRoot(prefix: string): string {
  // Resolve up front (macOS /tmp -> /private/tmp) so the fixture's own paths are already canonical
  // and no comparison below accidentally depends on the harness's temp-dir symlink.
  return realpathSync(mkdtempSync(path.join(tmpdir(), prefix)));
}

function writePomXml(
  dir: string,
  opts: { artifactId: string; modules?: string[]; hasParent?: boolean; packaging?: "pom" | "jar" },
): void {
  mkdirSync(dir, { recursive: true });
  const packagingAndModules = opts.modules
    ? `\n  <packaging>pom</packaging>\n  <modules>\n${opts.modules.map((m) => `    <module>${m}</module>`).join("\n")}\n  </modules>`
    : `\n  <packaging>${opts.packaging ?? "jar"}</packaging>`;
  const parent = opts.hasParent
    ? "\n  <parent>\n    <groupId>com.example</groupId>\n    <artifactId>reactor</artifactId>\n    <version>1.0.0</version>\n  </parent>"
    : "";
  writeFileSync(
    path.join(dir, "pom.xml"),
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
      `<project xmlns="http://maven.apache.org/POM/4.0.0">\n` +
      `  <modelVersion>4.0.0</modelVersion>\n` +
      `  <groupId>com.example</groupId>\n` +
      `  <artifactId>${opts.artifactId}</artifactId>\n` +
      `  <version>1.0.0</version>${parent}${packagingAndModules}\n` +
      `</project>\n`,
  );
}

function writeSourceFile(dir: string, relPath: string): string {
  const filePath = path.join(dir, relPath);
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, "package com.example;\n\npublic class Placeholder {}\n");
  return filePath;
}

interface FixturePath {
  /** Human-readable role of this path, quoted in every failure message. */
  label: string;
  callPath: string;
}

interface Fixture {
  /** Every path the conditions require, in the order TCON-WSID-0001 enumerates them. */
  paths: FixturePath[];
  /** The reactor root and a file nested in one of its modules -- one project, two spellings. */
  sameProjectPair: [FixturePath, FixturePath];
  /** A symlink alias of a managed root, and that root itself. */
  aliasPair: [FixturePath, FixturePath];
  /** Two managed roots given deliberately identical directory basenames. */
  sameBasenamePair: [FixturePath, FixturePath];
  /** One managed root per obviously-distinct project, for the cross-project checks. */
  distinctRoots: FixturePath[];
}

function buildFixtureTree(root: string): Fixture {
  // A standalone (single-module) project.
  const standaloneRoot = path.join(root, "standalone");
  writePomXml(standaloneRoot, { artifactId: "standalone" });
  const standaloneSourceFile = writeSourceFile(standaloneRoot, "src/main/java/com/example/Standalone.java");

  // A multi-module reactor: root, module directory, source file nested in a module.
  const reactorRoot = path.join(root, "multi-module");
  writePomXml(reactorRoot, { artifactId: "reactor", modules: ["module-a", "module-b"] });
  const moduleADir = path.join(reactorRoot, "module-a");
  writePomXml(moduleADir, { artifactId: "module-a", hasParent: true });
  const moduleASourceFile = writeSourceFile(moduleADir, "src/main/java/com/example/A.java");
  const moduleBDir = path.join(reactorRoot, "module-b");
  writePomXml(moduleBDir, { artifactId: "module-b", hasParent: true });

  // A reactor nested inside another reactor, with a path underneath the inner one.
  const outerReactorRoot = path.join(root, "outer-reactor");
  writePomXml(outerReactorRoot, { artifactId: "outer-reactor", modules: ["inner-reactor"] });
  const innerReactorRoot = path.join(outerReactorRoot, "inner-reactor");
  writePomXml(innerReactorRoot, { artifactId: "inner-reactor", modules: ["inner-module"], hasParent: true });
  const innerModuleRoot = path.join(innerReactorRoot, "inner-module");
  writePomXml(innerModuleRoot, { artifactId: "inner-module", hasParent: true });
  const innerModuleSourceFile = writeSourceFile(innerModuleRoot, "src/main/java/com/example/Inner.java");

  // Two managed roots with the SAME directory basename ("svc"), under different parents. Any
  // identity derived from something coarser than the whole canonical root -- a basename, a first
  // segment, a constant -- collapses these two, and TCON-WSID-0003 sees it.
  const twinOneRoot = path.join(root, "team-alpha", "svc");
  writePomXml(twinOneRoot, { artifactId: "svc" });
  const twinTwoRoot = path.join(root, "team-beta", "svc");
  writePomXml(twinTwoRoot, { artifactId: "svc" });

  // A symlink alias of a managed root -- the reactor spelled a second way.
  const aliasRoot = path.join(root, "alias-to-multi-module");
  symlinkSync(reactorRoot, aliasRoot, "dir");
  const aliasModuleSourceFile = path.join(aliasRoot, "module-a", "src", "main", "java", "com", "example", "A.java");

  const p = (label: string, callPath: string): FixturePath => ({ label, callPath });

  const reactorRootPath = p("the reactor root itself", reactorRoot);
  const moduleFilePath = p("a source file nested inside module-a of the reactor", moduleASourceFile);
  const aliasRootPath = p("a symlink alias of the reactor root", aliasRoot);
  const twinOnePath = p('managed root team-alpha/svc (basename "svc")', twinOneRoot);
  const twinTwoPath = p('managed root team-beta/svc (basename "svc")', twinTwoRoot);
  const standaloneRootPath = p("the standalone project root", standaloneRoot);
  const outerReactorRootPath = p("the outer reactor root", outerReactorRoot);

  return {
    paths: [
      reactorRootPath,
      p("module-a's own directory in the reactor", moduleADir),
      moduleFilePath,
      p("module-b's own directory in the reactor", moduleBDir),
      outerReactorRootPath,
      p("the inner reactor's own directory, nested inside the outer reactor", innerReactorRoot),
      p("a source file under a reactor nested inside another reactor", innerModuleSourceFile),
      standaloneRootPath,
      p("a source file in the standalone project", standaloneSourceFile),
      aliasRootPath,
      p("a source file reached through the symlink alias of the reactor root", aliasModuleSourceFile),
      twinOnePath,
      twinTwoPath,
    ],
    sameProjectPair: [reactorRootPath, moduleFilePath],
    aliasPair: [aliasRootPath, reactorRootPath],
    sameBasenamePair: [twinOnePath, twinTwoPath],
    distinctRoots: [reactorRootPath, standaloneRootPath, outerReactorRootPath, twinOnePath, twinTwoPath],
  };
}

// ---------------------------------------------------------------------------------------------
// Seam helpers
// ---------------------------------------------------------------------------------------------

interface Resolution {
  workspaceId: string;
  projectRoot: string;
}

/** Unwraps resolveWorkspace's result union; every fixture path below is inside a managed root. */
function route(fixturePath: FixturePath): Resolution {
  const result = resolveWorkspace(fixturePath.callPath);
  assert.ok(
    result && typeof result === "object" && "workspaceId" in result,
    `precondition: resolveWorkspace must route ${fixturePath.label} (${fixturePath.callPath}) to a managed ` +
      `root; got ${JSON.stringify(result)}`,
  );
  return result as Resolution;
}

interface Harness {
  pool: WorkspacePool;
  /** Every SpawnWorkspaceArgs the pool handed to the injected process boundary, in order. */
  spawns: SpawnWorkspaceArgs[];
  leases: WorkspaceLease[];
  /** Routes the path, acquires through the router's OWN projectRoot, and returns both halves. */
  serve(fixturePath: FixturePath): Promise<{ routed: Resolution; lease: WorkspaceLease }>;
}

/**
 * A pool wired to a fake process boundary. `maxWorkspaces` is set well above the fixture's project
 * count on purpose: these conditions are about identity, and letting the INV-POOL-2 cap evict a
 * workspace mid-test would confound the reading without saying anything about INV-POOL-1.
 */
function makeHarness(t: { after(fn: () => unknown): void }, cacheRoot: string): Harness {
  const spawns: SpawnWorkspaceArgs[] = [];
  const leases: WorkspaceLease[] = [];
  let nextPid = 40_000;

  const pool = createWorkspacePool({
    cacheRoot,
    maxWorkspaces: 32,
    spawnWorkspace: async (args) => {
      spawns.push({ ...args });
      return { pid: nextPid++, stop: async () => {} };
    },
  });

  t.after(async () => {
    await pool.close();
  });

  return {
    pool,
    spawns,
    leases,
    async serve(fixturePath) {
      const routed = route(fixturePath);
      const lease = await pool.acquire(routed.projectRoot);
      leases.push(lease);
      return { routed, lease };
    },
  };
}

function liveWorkspaces(pool: WorkspacePool): WorkspaceStatus[] {
  return pool.status().workspaces;
}

function describe(rows: WorkspaceStatus[]): string {
  return JSON.stringify(rows.map((r) => ({ workspaceId: r.workspaceId, dataDir: r.dataDir, state: r.state })));
}

/** The dataDir the pool passed to the spawn hook for this identity -- the argv half of the seam. */
function spawnArgsFor(spawns: SpawnWorkspaceArgs[], workspaceId: string): SpawnWorkspaceArgs[] {
  return spawns.filter((s) => s.workspaceId === workspaceId);
}

// ---------------------------------------------------------------------------------------------
// TCON-WSID-0001 -- INV-POOL-1: the pool serves every path under the id the router gave that path
// ---------------------------------------------------------------------------------------------

test("TCON-WSID-0001: for every path in the routing fixture tree, the lease the pool serves for the router's own projectRoot carries exactly the workspaceId the router resolved for that path", async (t) => {
  const root = makeTempRoot("wsid-0001-");
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const fx = buildFixtureTree(root);
  const h = makeHarness(t, path.join(root, "cache"));

  for (const fixturePath of fx.paths) {
    const { routed, lease } = await h.serve(fixturePath);

    assert.equal(
      lease.workspaceId,
      routed.workspaceId,
      `${fixturePath.label} (${fixturePath.callPath}): the router resolved this path to workspace id ` +
        `${routed.workspaceId} at root ${routed.projectRoot}, but the pool served that very root under ` +
        `${lease.workspaceId} with -data ${lease.dataDir}. Identity is derived twice by two independently ` +
        `changeable computations; when they disagree, one project silently occupies two -data directories ` +
        `(INV-POOL-1). This assertion compares the two derivations only with each other -- never with a ` +
        `literal digest -- so it says nothing about the algorithm X-005 leaves open.`,
    );

    assert.ok(
      path.isAbsolute(lease.dataDir),
      `${fixturePath.label}: every workspace's -data directory must be an absolute path (INV-POOL-1); ` +
        `got ${lease.dataDir}`,
    );

    // The argv half of the seam: a pool that reports one dataDir and spawns another is still broken.
    const spawned = spawnArgsFor(h.spawns, routed.workspaceId);
    assert.ok(
      spawned.length >= 1,
      `${fixturePath.label}: the pool must have spawned a process keyed under the router's id ` +
        `${routed.workspaceId}; the spawn hook only ever saw ` +
        `${JSON.stringify(h.spawns.map((s) => s.workspaceId))}`,
    );
    for (const args of spawned) {
      assert.equal(
        args.dataDir,
        lease.dataDir,
        `${fixturePath.label}: the pool reported -data ${lease.dataDir} on the lease but passed ` +
          `${args.dataDir} to the spawned process for the same identity ${routed.workspaceId} -- ` +
          `INV-POOL-1's seam is the status -data paths AND the spawned argv, and they must be one path.`,
      );
    }
  }
});

// ---------------------------------------------------------------------------------------------
// TCON-WSID-0002 -- INV-POOL-1: the pool never splits one routed project across two workspaces
// ---------------------------------------------------------------------------------------------

test("TCON-WSID-0002: two fixture paths the router itself puts in one project are served by one identical workspaceId, one identical absolute dataDir, and exactly one live workspace in status() -- never two", async (t) => {
  const root = makeTempRoot("wsid-0002-");
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const fx = buildFixtureTree(root);

  // Candidate pairs. The equivalence class is taken from the ROUTER's own output, not asserted
  // here: X-005 has not settled whether a symlink alias is the same workspace as its real root, so
  // the alias pair is exercised only if the router says the two are one project. Whichever reading
  // is later settled, the pool must honour it -- that is the claim under test.
  const candidates: Array<[FixturePath, FixturePath]> = [fx.sameProjectPair, fx.aliasPair];

  let exercised = 0;

  for (const [left, right] of candidates) {
    const routedLeft = route(left);
    const routedRight = route(right);
    if (routedLeft.workspaceId !== routedRight.workspaceId) {
      // The router keeps these apart; TCON-WSID-0003 owns that case. Not a failure here.
      continue;
    }
    exercised++;

    const cacheRoot = path.join(root, `cache-${exercised}`);
    const h = makeHarness(t, cacheRoot);

    const served = await h.serve(left);
    const other = await h.serve(right);

    assert.equal(
      other.lease.workspaceId,
      served.lease.workspaceId,
      `the router puts ${left.label} and ${right.label} in ONE project (both resolved to ` +
        `${routedLeft.workspaceId}), but the pool served them as ${served.lease.workspaceId} and ` +
        `${other.lease.workspaceId} -- one project must never occupy two identities (INV-POOL-1).`,
    );
    assert.equal(
      other.lease.dataDir,
      served.lease.dataDir,
      `the router puts ${left.label} and ${right.label} in ONE project, but the pool allocated two ` +
        `-data directories for it: ${served.lease.dataDir} and ${other.lease.dataDir}. A pool that keys ` +
        `its live-workspace map or its -data path on the projectRoot STRING it was handed, rather than on ` +
        `the agreed identity, splits one project the moment a root is spelled two ways.`,
    );
    assert.ok(
      path.isAbsolute(served.lease.dataDir),
      `the -data directory serving ${left.label} and ${right.label} must be absolute (INV-POOL-1); ` +
        `got ${served.lease.dataDir}`,
    );

    // While BOTH leases are held, the pool must show one live workspace, not two.
    const live = liveWorkspaces(h.pool);
    assert.equal(
      live.length,
      1,
      `while leases for ${left.label} and ${right.label} are both held, pool.status() must list exactly ` +
        `one live workspace covering them -- the router calls them one project. It listed ${live.length}: ` +
        `${describe(live)}`,
    );
    assert.equal(
      live[0]!.workspaceId,
      served.lease.workspaceId,
      `the single live workspace must be the identity both leases were served under ` +
        `(${served.lease.workspaceId}); status() reported ${live[0]!.workspaceId}`,
    );
    assert.equal(
      live[0]!.dataDir,
      served.lease.dataDir,
      `pool.status() reported -data ${live[0]!.dataDir} for the workspace whose leases carry ` +
        `${served.lease.dataDir} -- the lease and the status row are two views of one seam and must agree`,
    );

    // The argv half: one project must have caused exactly one spawn, under that one -data path.
    assert.equal(
      h.spawns.length,
      1,
      `one project must be spawned once (INV-POOL-5) and under one -data directory; the spawn hook saw ` +
        `${h.spawns.length} spawns: ${JSON.stringify(h.spawns.map((s) => ({ workspaceId: s.workspaceId, dataDir: s.dataDir })))}`,
    );
    assert.equal(
      h.spawns[0]!.dataDir,
      served.lease.dataDir,
      `the process serving ${left.label} and ${right.label} was spawned with -data ${h.spawns[0]!.dataDir} ` +
        `while the leases report ${served.lease.dataDir}`,
    );
    assert.equal(
      h.spawns[0]!.workspaceId,
      served.lease.workspaceId,
      `the spawned process was keyed under ${h.spawns[0]!.workspaceId} while the leases report ` +
        `${served.lease.workspaceId}`,
    );
  }

  assert.ok(
    exercised >= 1,
    `fixture precondition: at least one candidate pair must be one project according to the router, ` +
      `otherwise this condition tests nothing. The reactor root and a file nested in one of its modules ` +
      `are that pair (INV-ROUTE-3).`,
  );
});

// ---------------------------------------------------------------------------------------------
// TCON-WSID-0003 -- INV-POOL-1: the pool never merges two routed projects into one workspace
// ---------------------------------------------------------------------------------------------

test("TCON-WSID-0003: two fixture paths the router keeps apart -- including two managed roots sharing a directory basename -- are served under different workspaceIds and different absolute dataDirs, and no two live workspaces ever share a dataDir", async (t) => {
  const root = makeTempRoot("wsid-0003-");
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const fx = buildFixtureTree(root);
  const h = makeHarness(t, path.join(root, "cache"));

  // Sanity precondition for the pairwise claim below: the router must genuinely keep the
  // same-basename roots apart, otherwise there is nothing for the pool to preserve.
  const twinOne = route(fx.sameBasenamePair[0]);
  const twinTwo = route(fx.sameBasenamePair[1]);
  assert.notEqual(
    twinOne.workspaceId,
    twinTwo.workspaceId,
    `fixture precondition (INV-ROUTE-3): the router must keep ${fx.sameBasenamePair[0].label} and ` +
      `${fx.sameBasenamePair[1].label} apart even though both directories are named "svc"; it returned ` +
      `${twinOne.workspaceId} for both`,
  );

  const served: Array<{ fixturePath: FixturePath; routed: Resolution; lease: WorkspaceLease }> = [];
  for (const fixturePath of fx.distinctRoots) {
    const s = await h.serve(fixturePath);
    served.push({ fixturePath, ...s });
  }

  for (let i = 0; i < served.length; i++) {
    for (let j = i + 1; j < served.length; j++) {
      const a = served[i]!;
      const b = served[j]!;
      if (a.routed.workspaceId === b.routed.workspaceId) {
        // The router calls these one project; TCON-WSID-0002 owns that case.
        continue;
      }

      assert.notEqual(
        a.lease.workspaceId,
        b.lease.workspaceId,
        `the router keeps ${a.fixturePath.label} and ${b.fixturePath.label} apart ` +
          `(${a.routed.workspaceId} vs ${b.routed.workspaceId}), but the pool merged them into one ` +
          `identity ${a.lease.workspaceId} -- INV-POOL-1 forbids two projects sharing a live workspace, ` +
          `and a derivation keyed on anything coarser than the whole canonical root (a basename, a first ` +
          `segment, a constant) collapses them.`,
      );
      assert.notEqual(
        a.lease.dataDir,
        b.lease.dataDir,
        `${a.fixturePath.label} and ${b.fixturePath.label} are two distinct projects according to the ` +
          `router, yet the pool gave both the same -data directory ${a.lease.dataDir}. Two JDT LS ` +
          `processes sharing one -data directory corrupt each other's index (INV-POOL-1).`,
      );
    }
  }

  for (const { fixturePath, lease } of served) {
    assert.ok(
      path.isAbsolute(lease.dataDir),
      `${fixturePath.label}: every -data directory must be an absolute path (INV-POOL-1); got ${lease.dataDir}`,
    );
  }

  // While every lease is held: status() and the spawned argv must both show one -data per identity.
  const live = liveWorkspaces(h.pool);
  const byDataDir = new Map<string, string[]>();
  for (const row of live) {
    assert.ok(
      path.isAbsolute(row.dataDir),
      `pool.status() reported a non-absolute -data directory for workspace ${row.workspaceId}: ${row.dataDir}`,
    );
    const owners = byDataDir.get(row.dataDir) ?? [];
    owners.push(row.workspaceId);
    byDataDir.set(row.dataDir, owners);
  }
  for (const [dataDir, owners] of byDataDir) {
    assert.equal(
      owners.length,
      1,
      `no two live workspaces may share a -data directory (INV-POOL-1); ${dataDir} is claimed by ` +
        `${owners.length} of them (${owners.join(", ")}). Full status: ${describe(live)}`,
    );
  }

  const distinctRoutedIds = new Set(served.map((s) => s.routed.workspaceId));
  assert.equal(
    live.length,
    distinctRoutedIds.size,
    `the router put these fixture roots into ${distinctRoutedIds.size} distinct projects and every lease ` +
      `is still held, so pool.status() must list exactly that many live workspaces -- neither merged nor ` +
      `split. It listed ${live.length}: ${describe(live)}`,
  );

  const spawnedDataDirs = h.spawns.map((s) => s.dataDir);
  assert.equal(
    new Set(spawnedDataDirs).size,
    spawnedDataDirs.length,
    `every spawned process must get its own -data directory; the spawn hook saw duplicates in ` +
      `${JSON.stringify(h.spawns.map((s) => ({ workspaceId: s.workspaceId, dataDir: s.dataDir })))}`,
  );
  for (const args of h.spawns) {
    const row = live.find((r) => r.workspaceId === args.workspaceId);
    assert.ok(
      row,
      `the pool spawned a process keyed under ${args.workspaceId} that pool.status() does not report as ` +
        `live: ${describe(live)}`,
    );
    assert.equal(
      args.dataDir,
      row!.dataDir,
      `workspace ${args.workspaceId} was spawned with -data ${args.dataDir} but is reported live under ` +
        `${row!.dataDir} -- the argv and the status row are two halves of one seam and must agree`,
    );
  }
});
