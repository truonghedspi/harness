// Traceability (skills/test-design/SKILL.md, role: Test-Implementer).
//
//   plan_id:  TP-ROUTE-0001                (harness/tests/design/plans/TP-ROUTE-0001/)
//   feature:  feat-prove-routing           (harness/feature_list.json)
//   conditions / requirements implemented in this file:
//     TCON-ROUTE-0001  INV-ROUTE-3   every path inside the multi-module reactor resolves to the
//                                    outer reactor root, never a module's own pom.xml directory
//     TCON-ROUTE-0002  INV-ROUTE-3   the single-module project and the multi-module reactor
//                                    always resolve to two distinct workspace ids
//     TCON-ROUTE-0003  INV-ROUTE-1   a call resolves the same id regardless of what path under
//                                    the OTHER root was resolved immediately before it (fixed
//                                    interleave over every path pair)
//     TCON-ROUTE-0004  INV-ROUTE-1   over long generated call sequences, every id matches an
//                                    independent reference model of that call's own path alone
//                                    (model-based property, seeded/reproducible)
//     TCON-ROUTE-0005  INV-ROUTE-2   a path with no ancestor pom.xml returns an explicit error
//                                    naming the supplied path, never an empty success
//     TCON-ROUTE-0006  INV-ROUTE-1   a path inside an independently rooted child project nested
//                                    beneath a non-reactor ancestor pom.xml (packaging=pom, no
//                                    <modules>) resolves to the child's own directory, never the
//                                    non-reactor ancestor's -- discriminating the nearest-ancestor
//                                    fallback from always taking the outermost ancestor pom.xml
//     TCON-ROUTE-0007  INV-ROUTE-1   a path inside a reactor B nested inside another reactor A
//                                    (both declaring <modules>) always resolves to A's root, never
//                                    B's -- discriminating the outermost enclosing reactor from the
//                                    innermost one
//
// Spec refs: docs/design/runtime-model.md#INV-ROUTE-1, #INV-ROUTE-2, #INV-ROUTE-3; docs/design/evidence.md
// (spike B, issue 1303); docs/design/architecture.md (component table: `resolveWorkspace(path)
// -> {workspaceId, projectRoot} | error`); docs/cross-cutting.md#X-005 (workspace-id key,
// realpath-based, open -- this file asserts equality/inequality of ids, never a specific
// hash/algorithm).
//
// Per the test-implementer boundary, this file does not read src/workspace/project-router.ts --
// it exists to establish the oracle. That file does not exist yet (feat-project-router is
// not-started); every test below is expected to fail on module resolution until the maker adds
// it.
//
// Expected contract this file exercises (the maker implements to satisfy it, not the other way
// round -- per docs/design/architecture.md's component table):
//
//   export function resolveWorkspace(absolutePath: string):
//     | { workspaceId: string; projectRoot: string }
//     | { error: string };
//
// A pure function: derived fresh from the path argument every call, no caching/session state
// (INV-ROUTE-1). No filesystem/network/clock injection is offered because the real filesystem
// IS the observable seam here -- resolveWorkspace's whole job is walking real ancestor
// directories for a real pom.xml, so mocking it would test nothing.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { resolveWorkspace } from "../../src/workspace/project-router.ts";

// ---------------------------------------------------------------------------------------------
// Fixture helpers -- a real Maven-shaped tree on disk per test, cleaned up via t.after().
// ---------------------------------------------------------------------------------------------

function makeTempRoot(prefix: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), prefix));
  // Resolve symlinks up front (e.g. macOS /tmp -> /private/tmp) so every path this file builds
  // and compares is already canonical -- comparisons below must not depend on whatever symlink
  // resolution the implementation itself chooses to do (X-005 is still an open recommendation).
  return realpathSync(dir);
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
  const xml =
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<project xmlns="http://maven.apache.org/POM/4.0.0">\n` +
    `  <modelVersion>4.0.0</modelVersion>\n` +
    `  <groupId>com.example</groupId>\n` +
    `  <artifactId>${opts.artifactId}</artifactId>\n` +
    `  <version>1.0.0</version>${parent}${packagingAndModules}\n` +
    `</project>\n`;
  writeFileSync(path.join(dir, "pom.xml"), xml);
}

function writeSourceFile(dir: string, relPath: string): string {
  const filePath = path.join(dir, relPath);
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, "package com.example;\n\npublic class Placeholder {}\n");
  return filePath;
}

interface Fixture {
  singleRoot: string;
  singleSourceFile: string;
  multiRoot: string;
  moduleADir: string;
  moduleASourceFile: string;
  moduleBDir: string;
  moduleBSourceFile: string;
}

/** A single-module project and a multi-module reactor, side by side, per feat-prove-routing's context note. */
function buildFixtureTree(root: string): Fixture {
  const singleRoot = path.join(root, "single-module");
  writePomXml(singleRoot, { artifactId: "single-module" });
  const singleSourceFile = writeSourceFile(singleRoot, "src/main/java/com/example/Standalone.java");

  const multiRoot = path.join(root, "multi-module");
  writePomXml(multiRoot, { artifactId: "reactor", modules: ["module-a", "module-b"] });

  const moduleADir = path.join(multiRoot, "module-a");
  writePomXml(moduleADir, { artifactId: "module-a", hasParent: true });
  const moduleASourceFile = writeSourceFile(moduleADir, "src/main/java/com/example/A.java");

  const moduleBDir = path.join(multiRoot, "module-b");
  writePomXml(moduleBDir, { artifactId: "module-b", hasParent: true });
  const moduleBSourceFile = writeSourceFile(moduleBDir, "src/main/java/com/example/B.java");

  return { singleRoot, singleSourceFile, multiRoot, moduleADir, moduleASourceFile, moduleBDir, moduleBSourceFile };
}

/** Unwraps the success branch of resolveWorkspace's result union, failing with a clear message on the error branch. */
function expectResolved(callPath: string): { workspaceId: string; projectRoot: string } {
  const result = resolveWorkspace(callPath) as { workspaceId: string; projectRoot: string } | { error: string };
  assert.ok(
    result && typeof result === "object" && "workspaceId" in result,
    `resolveWorkspace(${callPath}) must resolve inside the fixture's managed roots; got: ${JSON.stringify(result)}`,
  );
  return result as { workspaceId: string; projectRoot: string };
}

/** Deterministic, seeded PRNG (mulberry32) -- reproducible across runs, no Math.random()/Date.now(). */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function next(): number {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------------------------------------
// TCON-ROUTE-0001 -- INV-ROUTE-3: reactor collapse (decision table, one row per path shape)
// ---------------------------------------------------------------------------------------------

test("TCON-ROUTE-0001: every path inside the multi-module reactor resolves to the outer reactor root, never a module's own pom.xml directory", (t) => {
  const root = makeTempRoot("route-0001-");
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const fx = buildFixtureTree(root);

  const rows: ReadonlyArray<{ label: string; callPath: string }> = [
    { label: "the reactor root itself", callPath: fx.multiRoot },
    { label: "module-a's own pom.xml directory", callPath: fx.moduleADir },
    { label: "a source file nested inside module-a", callPath: fx.moduleASourceFile },
    { label: "module-b's own pom.xml directory", callPath: fx.moduleBDir },
    { label: "a source file nested inside module-b", callPath: fx.moduleBSourceFile },
  ];

  const resolved = rows.map(({ label, callPath }) => {
    const result = expectResolved(callPath);
    assert.equal(
      result.projectRoot,
      fx.multiRoot,
      `${label}: projectRoot must be the outer reactor root (${fx.multiRoot}), not the nearest ` +
        `ancestor pom.xml directory; got ${result.projectRoot}`,
    );
    return { label, id: result.workspaceId };
  });

  const [first, ...rest] = resolved;
  for (const r of rest) {
    assert.equal(
      r.id,
      first.id,
      `${r.label} (id ${r.id}) must resolve to the same workspace id as ${first.label} (id ${first.id}) -- ` +
        `both are inside one reactor and must never get a per-module id`,
    );
  }
});

// ---------------------------------------------------------------------------------------------
// TCON-ROUTE-0002 -- INV-ROUTE-3: two distinct roots never collide (decision table, root x root)
// ---------------------------------------------------------------------------------------------

test("TCON-ROUTE-0002: the single-module project and the multi-module reactor always resolve to two distinct workspace ids, never the same one", (t) => {
  const root = makeTempRoot("route-0002-");
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const fx = buildFixtureTree(root);

  const singlePaths = [fx.singleRoot, fx.singleSourceFile];
  const multiPaths = [fx.multiRoot, fx.moduleADir, fx.moduleASourceFile, fx.moduleBDir, fx.moduleBSourceFile];

  const singleResults = singlePaths.map((p) => ({ p, r: expectResolved(p) }));
  const multiResults = multiPaths.map((p) => ({ p, r: expectResolved(p) }));

  // Within-root consistency is a precondition for the cross-root inequality check below to mean
  // anything (otherwise a broken implementation could pass by returning ad hoc distinct ids).
  for (const { p, r } of singleResults) {
    assert.equal(r.workspaceId, singleResults[0]!.r.workspaceId, `${p} must share the single-module project's id`);
  }
  for (const { p, r } of multiResults) {
    assert.equal(r.workspaceId, multiResults[0]!.r.workspaceId, `${p} must share the multi-module reactor's id`);
  }

  for (const s of singleResults) {
    for (const m of multiResults) {
      assert.notEqual(
        s.r.workspaceId,
        m.r.workspaceId,
        `single-module id (${s.r.workspaceId}, from ${s.p}) must never equal the multi-module reactor id ` +
          `(${m.r.workspaceId}, from ${m.p}) -- they are two distinct project roots`,
      );
    }
  }
});

// ---------------------------------------------------------------------------------------------
// TCON-ROUTE-0003 -- INV-ROUTE-1: no drift from an interleaved call under the other root
// ---------------------------------------------------------------------------------------------

test("TCON-ROUTE-0003: a call resolves the same id regardless of what path under the OTHER root was resolved immediately before it", (t) => {
  const root = makeTempRoot("route-0003-");
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const fx = buildFixtureTree(root);

  const groupSingle = { name: "single-module", paths: [fx.singleRoot, fx.singleSourceFile] };
  const groupMulti = {
    name: "multi-module reactor",
    paths: [fx.multiRoot, fx.moduleADir, fx.moduleASourceFile, fx.moduleBDir, fx.moduleBSourceFile],
  };

  // Baseline ids, established before any interleaving, so we know what "correct" looks like.
  const baselineSingle = expectResolved(groupSingle.paths[0]!).workspaceId;
  const baselineMulti = expectResolved(groupMulti.paths[0]!).workspaceId;
  assert.notEqual(baselineSingle, baselineMulti, "sanity precondition: the two roots must already have distinct ids");

  const groups = [
    { target: groupSingle, other: groupMulti, expectedId: baselineSingle, otherId: baselineMulti },
    { target: groupMulti, other: groupSingle, expectedId: baselineMulti, otherId: baselineSingle },
  ];

  for (const { target, other, expectedId, otherId } of groups) {
    for (const targetPath of target.paths) {
      for (const interposedPath of other.paths) {
        const before = expectResolved(targetPath).workspaceId;
        assert.equal(before, expectedId, `resolveWorkspace(${targetPath}) must return ${target.name}'s id (${expectedId}) before any interleaving`);

        expectResolved(interposedPath); // interleave a call under the OTHER root in between

        const after = expectResolved(targetPath).workspaceId;
        assert.equal(
          after,
          expectedId,
          `resolveWorkspace(${targetPath}) must still return ${target.name}'s id (${expectedId}) after resolving ` +
            `${interposedPath} (${other.name}) in between -- got ${after}`,
        );
        assert.notEqual(
          after,
          otherId,
          `resolveWorkspace(${targetPath}) must never leak ${other.name}'s id (${otherId}) as a sticky/last-resolved value ` +
            `after an interleaved call to ${interposedPath}`,
        );
      }
    }
  }
});

// ---------------------------------------------------------------------------------------------
// TCON-ROUTE-0004 -- INV-ROUTE-1: model-based property over long generated call sequences
// ---------------------------------------------------------------------------------------------

test("TCON-ROUTE-0004: over any generated sequence of interleaved calls, every resolved id matches an independent reference model of that call's own path -- never another call's", (t) => {
  const root = makeTempRoot("route-0004-");
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const fx = buildFixtureTree(root);

  const singlePaths = [fx.singleRoot, fx.singleSourceFile];
  const multiPaths = [fx.multiRoot, fx.moduleADir, fx.moduleASourceFile, fx.moduleBDir, fx.moduleBSourceFile];
  const allPaths = [...singlePaths, ...multiPaths];

  // Reference model: independent of whatever id/hash scheme the maker picks (X-005 is still
  // open) -- computed purely from the fixture's own known path -> root mapping, per this
  // condition's own rationale ("the fixture path-to-root mapping is fully known").
  function referenceRootFor(callPath: string): string {
    if (singlePaths.includes(callPath)) return fx.singleRoot;
    if (multiPaths.includes(callPath)) return fx.multiRoot;
    throw new Error(`test bug: ${callPath} is not one of the fixture's known paths`);
  }

  const SEEDS = [1, 2, 3, 4, 5];
  const SEQUENCE_LENGTH = 200;

  for (const seed of SEEDS) {
    const rand = mulberry32(seed);
    const idForRoot = new Map<string, string>(); // reference root -> workspace id seen so far in this sequence
    const rootForId = new Map<string, string>(); // workspace id -> reference root that owns it in this sequence

    for (let i = 0; i < SEQUENCE_LENGTH; i++) {
      const callPath = allPaths[Math.floor(rand() * allPaths.length)]!;
      const expectedRoot = referenceRootFor(callPath);
      const result = expectResolved(callPath);

      assert.equal(
        result.projectRoot,
        expectedRoot,
        `seed ${seed}, call #${i} resolveWorkspace(${callPath}): projectRoot must be ${expectedRoot}; got ${result.projectRoot}`,
      );

      const previousIdForThisRoot = idForRoot.get(expectedRoot);
      if (previousIdForThisRoot === undefined) {
        idForRoot.set(expectedRoot, result.workspaceId);
      } else {
        assert.equal(
          result.workspaceId,
          previousIdForThisRoot,
          `seed ${seed}, call #${i}: resolveWorkspace(${callPath}) must return the same id every call under ` +
            `${expectedRoot} returns (${previousIdForThisRoot}) -- must never drift after ${i} prior calls; got ${result.workspaceId}`,
        );
      }

      const previousRootForThisId = rootForId.get(result.workspaceId);
      if (previousRootForThisId === undefined) {
        rootForId.set(result.workspaceId, expectedRoot);
      } else {
        assert.equal(
          previousRootForThisId,
          expectedRoot,
          `seed ${seed}, call #${i}: workspace id ${result.workspaceId} was already assigned to ` +
            `${previousRootForThisId} earlier in this sequence -- it must never also be assigned to ${expectedRoot} ` +
            `(this is what a call resolved to a different call's path in the same sequence would look like)`,
        );
      }
    }
  }
});

// ---------------------------------------------------------------------------------------------
// TCON-ROUTE-0005 -- INV-ROUTE-2: unmanaged paths fail explicitly and name the supplied path
// ---------------------------------------------------------------------------------------------

test("TCON-ROUTE-0005: a path with no ancestor pom.xml returns an explicit error naming the supplied path, never an empty success", (t) => {
  const root = makeTempRoot("route-0005-");
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const unmanagedPath = writeSourceFile(root, "unmanaged/src/main/java/com/example/Unmanaged.java");

  const result = resolveWorkspace(unmanagedPath) as
    | { workspaceId: string; projectRoot: string }
    | { error: string };

  assert.ok(
    result && typeof result === "object" && "error" in result,
    `resolveWorkspace(${unmanagedPath}) must return an explicit error, never an empty success; got: ${JSON.stringify(result)}`,
  );
  assert.equal(typeof result.error, "string", "the explicit routing error must carry a message");
  assert.ok(
    result.error.includes(unmanagedPath),
    `the routing error must name the supplied path (${unmanagedPath}); got: ${result.error}`,
  );
});

// ---------------------------------------------------------------------------------------------
// TCON-ROUTE-0006 -- INV-ROUTE-1: nearest-ancestor fallback vs. a non-reactor outer ancestor
// ---------------------------------------------------------------------------------------------

test("TCON-ROUTE-0006: a path inside an independently rooted child project nested beneath a non-reactor ancestor pom.xml resolves to the child's own directory, never the non-reactor ancestor's", (t) => {
  const root = makeTempRoot("route-0006-");
  t.after(() => rmSync(root, { recursive: true, force: true }));

  // The ancestor is explicitly NOT a reactor: packaging=pom but no <modules> element at all.
  const nonReactorAncestorRoot = path.join(root, "non-reactor-ancestor");
  writePomXml(nonReactorAncestorRoot, { artifactId: "non-reactor-ancestor", packaging: "pom" });

  // The child is independently rooted: its own separate pom.xml, not declared as a <module> of
  // the ancestor above (the ancestor has no <modules> at all).
  const childRoot = path.join(nonReactorAncestorRoot, "nested-child");
  writePomXml(childRoot, { artifactId: "nested-child" });
  const childSourceFile = writeSourceFile(childRoot, "src/main/java/com/example/Child.java");

  const rows: ReadonlyArray<{ label: string; callPath: string }> = [
    { label: "the child project's own pom.xml directory", callPath: childRoot },
    { label: "a source file nested inside the child project", callPath: childSourceFile },
  ];

  for (const { label, callPath } of rows) {
    const result = expectResolved(callPath);
    assert.equal(
      result.projectRoot,
      childRoot,
      `${label}: projectRoot must be the child project's own directory (${childRoot}) -- the ` +
        `nearest ancestor pom.xml -- never the non-reactor ancestor's directory ` +
        `(${nonReactorAncestorRoot}), which declares no <modules> and is therefore not a reactor ` +
        `root; got ${result.projectRoot}`,
    );
    assert.notEqual(
      result.projectRoot,
      nonReactorAncestorRoot,
      `${label}: projectRoot must never be the non-reactor ancestor's directory ` +
        `(${nonReactorAncestorRoot}) -- that would mean the implementation always takes the ` +
        `outermost ancestor pom.xml regardless of whether it declares <modules>`,
    );
  }

  // Sanity precondition: the ancestor itself must still resolve to its own directory when called
  // directly -- it IS a valid (non-reactor) project root, just not an enclosing one for the child.
  const ancestorResult = expectResolved(nonReactorAncestorRoot);
  assert.equal(
    ancestorResult.projectRoot,
    nonReactorAncestorRoot,
    `the non-reactor ancestor must resolve to its own directory when called directly`,
  );
  const childResult = expectResolved(childRoot);
  assert.notEqual(
    childResult.workspaceId,
    ancestorResult.workspaceId,
    `the child project and the non-reactor ancestor are two distinct project roots and must never share a workspace id`,
  );
});

// ---------------------------------------------------------------------------------------------
// TCON-ROUTE-0007 -- INV-ROUTE-1: outermost enclosing reactor vs. a reactor nested inside it
// ---------------------------------------------------------------------------------------------

test("TCON-ROUTE-0007: a path inside a reactor nested inside another reactor always resolves to the outermost reactor's root, never the inner nested reactor's", (t) => {
  const root = makeTempRoot("route-0007-");
  t.after(() => rmSync(root, { recursive: true, force: true }));

  // Reactor A: the outer reactor, declares <modules> at the fixture root.
  const outerReactorRoot = path.join(root, "outer-reactor");
  writePomXml(outerReactorRoot, { artifactId: "outer-reactor", modules: ["inner-reactor"] });

  // Reactor B: nested inside one of A's own module directories, and independently declares its
  // own <modules> -- it is a reactor in its own right, not just a plain module of A.
  const innerReactorRoot = path.join(outerReactorRoot, "inner-reactor");
  writePomXml(innerReactorRoot, { artifactId: "inner-reactor", modules: ["inner-module"], hasParent: true });

  // B's own child module, declared by B (not by A).
  const innerModuleRoot = path.join(innerReactorRoot, "inner-module");
  writePomXml(innerModuleRoot, { artifactId: "inner-module", hasParent: true });
  const innerModuleSourceFile = writeSourceFile(innerModuleRoot, "src/main/java/com/example/Inner.java");

  const rows: ReadonlyArray<{ label: string; callPath: string }> = [
    { label: "reactor B's own pom.xml directory", callPath: innerReactorRoot },
    { label: "reactor B's child module directory", callPath: innerModuleRoot },
    { label: "a source file nested inside reactor B's child module", callPath: innerModuleSourceFile },
  ];

  const outerResult = expectResolved(outerReactorRoot);
  assert.equal(
    outerResult.projectRoot,
    outerReactorRoot,
    `the outer reactor must resolve to its own directory when called directly`,
  );

  for (const { label, callPath } of rows) {
    const result = expectResolved(callPath);
    assert.equal(
      result.projectRoot,
      outerReactorRoot,
      `${label}: projectRoot must be the outermost enclosing reactor's root (${outerReactorRoot}), ` +
        `never the inner nested reactor's directory (${innerReactorRoot}) -- INV-ROUTE-1 requires ` +
        `the outermost enclosing ancestor pom.xml that declares <modules>; got ${result.projectRoot}`,
    );
    assert.notEqual(
      result.projectRoot,
      innerReactorRoot,
      `${label}: projectRoot must never be the inner nested reactor's own directory ` +
        `(${innerReactorRoot}) -- that would mean the search for the enclosing reactor stopped at ` +
        `the innermost <modules> ancestor instead of continuing to the outermost one`,
    );
    assert.equal(
      result.workspaceId,
      outerResult.workspaceId,
      `${label}: workspace id (${result.workspaceId}) must equal the outer reactor's id ` +
        `(${outerResult.workspaceId}) -- both are inside the same outermost reactor`,
    );
  }
});
