// Traceability (skills/test-design/SKILL.md, role: Test-Implementer).
//
//   feature:  feat-gradle-routing   (harness/feature_list.json)
//   conditions / requirements implemented in this file:
//     TCON-ROUTE-GRADLE-0001  INV-ROUTE-4  a file under a single-module Gradle project
//                                          (build.gradle only, no pom.xml) resolves to that
//                                          build.gradle's directory, never 'unroutable'
//     TCON-ROUTE-GRADLE-0002  INV-ROUTE-4  a file inside a subproject of a multi-project Gradle
//                                          build resolves to the outermost settings.gradle root,
//                                          never the subproject's own build.gradle directory
//     TCON-ROUTE-GRADLE-0003  INV-ROUTE-4  the Kotlin-DSL markers (settings.gradle.kts /
//                                          build.gradle.kts) route exactly like their Groovy
//                                          counterparts
//     TCON-ROUTE-GRADLE-0004  INV-ROUTE-4  a path under a nested settings.gradle (one inside
//                                          another) resolves to the outermost one
//     TCON-ROUTE-GRADLE-0005  INV-ROUTE-2   a path with no pom.xml and no Gradle marker still
//                                          returns an explicit error naming the path
//
// Spec refs: docs/design/runtime-model.md#INV-ROUTE-4 (additive to INV-ROUTE-1/-2/-3).
//
// This file is the oracle for feat-gradle-routing; it does not read the implementation. It exercises
// resolveWorkspace against a real Gradle-shaped tree on disk, exactly as the Maven oracle does.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { resolveWorkspace } from "../../src/workspace/project-router.ts";

function makeTempRoot(prefix: string): string {
  return realpathSync(mkdtempSync(path.join(tmpdir(), prefix)));
}

function writeJava(dir: string, rel: string): string {
  const file = path.join(dir, rel);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, "package com.example; public class Sample {}\n");
  return file;
}

function writeBuildGradle(dir: string): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, "build.gradle"), "// gradle build\n");
}

function writeSettingsGradle(dir: string, subprojects: string[]): void {
  mkdirSync(dir, { recursive: true });
  const body = subprojects.map((s) => `include '${s}'`).join("\n");
  writeFileSync(path.join(dir, "settings.gradle"), `${body}\n`);
}

test("TCON-ROUTE-GRADLE-0001: a single-module Gradle project (build.gradle, no pom.xml) routes to its build.gradle directory", (t) => {
  const root = makeTempRoot("gradle-0001-");
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const project = path.join(root, "app");
  writeBuildGradle(project);
  const file = writeJava(project, "src/main/java/com/example/Sample.java");

  const result = resolveWorkspace(file) as { workspaceId: string; projectRoot: string } | { error: string };
  assert.ok("projectRoot" in result, `must resolve, got: ${JSON.stringify(result)}`);
  assert.equal(result.projectRoot, realpathSync(project), "must route to the build.gradle directory");
});

test("TCON-ROUTE-GRADLE-0002: a subproject file in a multi-project Gradle build routes to the outermost settings.gradle root, never the subproject", (t) => {
  const root = makeTempRoot("gradle-0002-");
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const settingsRoot = path.join(root, "monorepo");
  writeSettingsGradle(settingsRoot, ["lib", "app"]);
  const subproject = path.join(settingsRoot, "app");
  writeBuildGradle(subproject);
  const file = writeJava(subproject, "src/main/java/com/example/Sample.java");

  const result = resolveWorkspace(file) as { workspaceId: string; projectRoot: string } | { error: string };
  assert.ok("projectRoot" in result, `must resolve, got: ${JSON.stringify(result)}`);
  assert.equal(result.projectRoot, realpathSync(settingsRoot), "must route to the settings.gradle root");
});

test("TCON-ROUTE-GRADLE-0003: Kotlin-DSL markers (settings.gradle.kts / build.gradle.kts) route like their Groovy counterparts", (t) => {
  const root = makeTempRoot("gradle-0003-");
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const project = path.join(root, "ktapp");
  mkdirSync(project, { recursive: true });
  writeFileSync(path.join(project, "build.gradle.kts"), "// kotlin dsl\n");
  const file = writeJava(project, "src/main/java/com/example/Sample.java");

  const result = resolveWorkspace(file) as { workspaceId: string; projectRoot: string } | { error: string };
  assert.ok("projectRoot" in result, `must resolve, got: ${JSON.stringify(result)}`);
  assert.equal(result.projectRoot, realpathSync(project), "must route to the build.gradle.kts directory");
});

test("TCON-ROUTE-GRADLE-0004: a path under a nested settings.gradle resolves to the outermost one", (t) => {
  const root = makeTempRoot("gradle-0004-");
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const outer = path.join(root, "outer");
  writeSettingsGradle(outer, ["inner"]);
  const inner = path.join(outer, "inner");
  writeSettingsGradle(inner, ["lib"]);
  const file = writeJava(inner, "lib/src/main/java/com/example/Sample.java");

  const result = resolveWorkspace(file) as { workspaceId: string; projectRoot: string } | { error: string };
  assert.ok("projectRoot" in result, `must resolve, got: ${JSON.stringify(result)}`);
  assert.equal(result.projectRoot, realpathSync(outer), "must route to the outermost settings.gradle root");
});

test("TCON-ROUTE-GRADLE-0005: a path with no pom.xml and no Gradle marker still returns an explicit error naming the path", (t) => {
  const root = makeTempRoot("gradle-0005-");
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const file = writeJava(root, "unmanaged/src/main/java/com/example/Unmanaged.java");

  const result = resolveWorkspace(file) as { workspaceId: string; projectRoot: string } | { error: string };
  assert.ok("error" in result, `must return an explicit error, got: ${JSON.stringify(result)}`);
  assert.ok(result.error.includes(file), `the error must name the path; got: ${result.error}`);
});
