#!/usr/bin/env node
import { createHash } from "node:crypto";
import { createReadStream, existsSync, mkdirSync, readdirSync, renameSync, rmSync } from "node:fs";
import { cp, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { pipeline } from "node:stream/promises";

const PIN = "1.61.0.202607231254";
const ARCHIVE_SHA256 = "0db771ff1f941c03ecdfcb6f7f586a67bf27c170cb7ac0fe5aa3515cba11982f";
const URL = "https://download.eclipse.org/jdtls/snapshots/jdt-language-server-1.61.0-202607231254.tar.gz";
const projectRoot = path.resolve(import.meta.dirname, "..");
const installDir = path.resolve(process.env.JDTLS_FIXTURE_DIR || path.join(projectRoot, ".cache/jdtls-fixture", PIN));

async function downloadPinnedArchive(destination) {
  const signal = AbortSignal.timeout(180_000);
  const head = await fetch(URL, { method: "HEAD", signal });
  const size = Number(head.headers.get("content-length"));
  if (!head.ok || !Number.isSafeInteger(size) || size <= 0) {
    throw new Error(`download ${URL} metadata failed: HTTP ${head.status}`);
  }
  const partCount = 8;
  const partSize = Math.ceil(size / partCount);
  const parts = await Promise.all(Array.from({ length: partCount }, async (_, index) => {
    const start = index * partSize;
    const end = Math.min(size - 1, start + partSize - 1);
    const response = await fetch(URL, { headers: { Range: `bytes=${start}-${end}` }, signal });
    if (response.status !== 206) throw new Error(`download ${URL} range ${start}-${end} failed: HTTP ${response.status}`);
    return Buffer.from(await response.arrayBuffer());
  }));
  await writeFile(destination, Buffer.concat(parts));
}

function validInstall(dir) {
  const plugins = path.join(dir, "plugins");
  if (!existsSync(plugins)) return false;
  const files = readdirSync(plugins);
  return files.some((name) => name.startsWith(`org.eclipse.jdt.ls.core_${PIN}`) && name.endsWith(".jar"))
    && files.some((name) => name.startsWith("org.eclipse.equinox.launcher_") && name.endsWith(".jar"));
}

async function sha256(file) {
  const hash = createHash("sha256");
  await pipeline(createReadStream(file), hash);
  return hash.digest("hex");
}

async function main() {
  const override = process.env.JDTLS_HOME?.trim();
  if (override) {
    const resolved = path.resolve(override);
    if (!validInstall(resolved)) throw new Error(`JDTLS_HOME ${resolved} has no resolvable JDT LS launcher/core jars`);
    console.log(`JDT LS fixture ${PIN}: using JDTLS_HOME ${resolved}`);
    return;
  }

  if (validInstall(installDir)) {
    console.log(`JDT LS fixture ${PIN}: cached at ${installDir}`);
    return;
  }

  const staging = await mkdtemp(path.join(tmpdir(), "jdtls-fixture-"));
  const archive = path.join(staging, "jdtls.tar.gz");
  try {
    const localArchive = process.env.JDTLS_FIXTURE_ARCHIVE?.trim();
    const expectedHash = process.env.JDTLS_FIXTURE_SHA256?.trim() || ARCHIVE_SHA256;
    if (localArchive) {
      await cp(path.resolve(localArchive), archive);
    } else {
      await downloadPinnedArchive(archive);
    }
    const actualHash = await sha256(archive);
    if (actualHash !== expectedHash) throw new Error(`JDT LS fixture checksum mismatch: expected ${expectedHash}, got ${actualHash}`);

    const unpacked = path.join(staging, "unpacked");
    mkdirSync(unpacked);
    const result = spawnSync("tar", ["-xzf", archive, "-C", unpacked], { encoding: "utf8" });
    if (result.status !== 0) throw new Error(`could not extract JDT LS fixture: ${result.stderr.trim()}`);
    if (!validInstall(unpacked)) throw new Error(`archive does not contain pinned JDT LS ${PIN} launcher/core jars`);

    mkdirSync(path.dirname(installDir), { recursive: true });
    rmSync(installDir, { recursive: true, force: true });
    renameSync(unpacked, installDir);
    await writeFile(path.join(installDir, ".fixture-pin"), `${PIN}\n`);
    console.log(`JDT LS fixture ${PIN}: installed at ${installDir}`);
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(`fetch-jdtls-fixture: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
