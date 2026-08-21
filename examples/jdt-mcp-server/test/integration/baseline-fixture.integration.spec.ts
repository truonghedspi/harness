import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";

const projectRoot = path.resolve(import.meta.dirname, "../..");
const fetcher = path.join(projectRoot, "tools/fetch-jdtls-fixture.mjs");
const pin = "1.61.0.202607231254";

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
