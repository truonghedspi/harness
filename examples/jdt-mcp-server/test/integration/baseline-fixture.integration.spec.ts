import assert from "node:assert/strict";
import { copyFileSync, existsSync, mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";

const projectRoot = path.resolve(import.meta.dirname, "../..");
const fetcher = path.join(projectRoot, "tools/fetch-jdtls-fixture.mjs");
const pin = "1.61.0.202607231254";

function runBaselineGate(failingStep?: "install" | "fixture" | "test") {
  const root = mkdtempSync(path.join(tmpdir(), "jdtls-baseline-gate-"));
  const harnessDir = path.join(root, "harness");
  const toolsDir = path.join(root, "tools");
  const installMarker = path.join(root, "install-ran");
  const fixtureMarker = path.join(root, "fixture-ran");
  const testMarker = path.join(root, "test-ran");
  mkdirSync(harnessDir);
  mkdirSync(toolsDir);
  copyFileSync(path.join(projectRoot, "harness/init.mjs"), path.join(harnessDir, "init.mjs"));
  writeFileSync(
    path.join(root, "package.json"),
    JSON.stringify({
      name: "baseline-gate-fixture",
      version: "0.0.0",
      scripts: {
        preinstall: `node -e "require('fs').writeFileSync(process.env.INSTALL_MARKER, 'ran');${failingStep === "install" ? "process.exit(23)" : ""}"`,
        "test:baseline": `node -e "require('fs').writeFileSync(process.env.TEST_MARKER, 'ran');${failingStep === "test" ? "process.exit(25)" : ""}"`,
      },
    }),
  );
  writeFileSync(
    path.join(toolsDir, "fetch-jdtls-fixture.mjs"),
    `import { writeFileSync } from "node:fs";\nwriteFileSync(process.env.FIXTURE_MARKER, "ran");\n${failingStep === "fixture" ? "process.exit(24);" : ""}\n`,
  );

  const result = spawnSync(process.execPath, [path.join(harnessDir, "init.mjs")], {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, INSTALL_MARKER: installMarker, FIXTURE_MARKER: fixtureMarker, TEST_MARKER: testMarker },
  });
  return { result, installMarker, fixtureMarker, testMarker };
}

test("feat-001: the maintained fixture step installs the pinned JDT LS archive", { timeout: 10_000 }, () => {
  const root = mkdtempSync(path.join(tmpdir(), "jdtls-baseline-"));
  const payload = path.join(root, "payload");
  const plugins = path.join(payload, "plugins");
  mkdirSync(plugins, { recursive: true });
  writeFileSync(path.join(plugins, `org.eclipse.jdt.ls.core_${pin}.jar`), "fixture");
  writeFileSync(path.join(plugins, "org.eclipse.equinox.launcher_1.0.0.jar"), "fixture");
  mkdirSync(path.join(payload, "config_linux"));

  const archive = path.join(root, "jdtls.tar.gz");
  const packed = spawnSync("tar", ["-czf", archive, "-C", payload, "."], { encoding: "utf8" });
  assert.equal(packed.status, 0, `test fixture archive creation failed: ${packed.stderr}`);

  const installDir = path.join(root, "install");
  const result = spawnSync(process.execPath, [fetcher], {
    cwd: projectRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      JDTLS_FIXTURE_ARCHIVE: archive,
      JDTLS_FIXTURE_SHA256: createHash("sha256").update(readFileSync(archive)).digest("hex"),
      JDTLS_FIXTURE_DIR: installDir,
      JDTLS_HOME: "",
    },
  });

  assert.equal(result.status, 0, `fixture provisioning must succeed: ${result.stderr}`);
  assert.match(result.stdout, new RegExp(`JDT LS fixture ${pin}`));
});

test("feat-001: a failed fixture source makes provisioning red", { timeout: 10_000 }, () => {
  const root = mkdtempSync(path.join(tmpdir(), "jdtls-baseline-fail-"));
  const result = spawnSync(process.execPath, [fetcher], {
    cwd: projectRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      JDTLS_FIXTURE_ARCHIVE: path.join(root, "absent.tar.gz"),
      JDTLS_FIXTURE_SHA256: "0".repeat(64),
      JDTLS_FIXTURE_DIR: path.join(root, "install"),
      JDTLS_HOME: "",
    },
  });

  assert.notEqual(result.status, 0, "an absent fixture archive must fail the maintained step");
});

test("feat-001: the standard baseline gate executes every required step", { timeout: 30_000 }, () => {
  const { result, installMarker, fixtureMarker, testMarker } = runBaselineGate();

  assert.equal(result.status, 0, `baseline gate must pass: ${result.stderr}`);
  assert.equal(existsSync(installMarker), true, "npm install must execute");
  assert.equal(existsSync(fixtureMarker), true, "fixture provisioning must execute");
  assert.equal(existsSync(testMarker), true, "the maintained baseline test must execute");
});

for (const [step, expectedExit, laterMarker] of [
  ["install", "23", "fixture-ran"],
  ["fixture", "24", "test-ran"],
  ["test", "25", null],
] as const) {
  test(`feat-001: a failed ${step} step makes the standard baseline gate red`, { timeout: 30_000 }, () => {
    const { result, fixtureMarker, testMarker } = runBaselineGate(step);

    assert.notEqual(result.status, 0, `${step} failure must make harness/init.mjs exit non-zero`);
    assert.match(result.stderr, new RegExp(`failed with exit code ${expectedExit}`));
    if (laterMarker === "fixture-ran") {
      assert.equal(existsSync(fixtureMarker), false, "fixture provisioning must not run after install fails");
    }
    if (laterMarker === "test-ran") {
      assert.equal(existsSync(testMarker), false, "baseline tests must not run after fixture provisioning fails");
    }
  });
}
