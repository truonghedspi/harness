import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readdir, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const DISTRIBUTION_HOST = "download.eclipse.org";
const ARCHIVE_URL = `https://${DISTRIBUTION_HOST}/jdtls/snapshots/jdt-language-server-1.61.0-202607231254.tar.gz`;
const ARCHIVE_SHA256 = "0db771ff1f941c03ecdfcb6f7f586a67bf27c170cb7ac0fe5aa3515cba11982f";

export async function findCoreLauncher(
  installDir: string,
  requiredVersion?: string,
): Promise<{ path: string; version: string } | undefined> {
  const pluginsDir = path.join(installDir, "plugins");
  let entries: string[];
  try {
    entries = await readdir(pluginsDir);
  } catch {
    return undefined;
  }

  const prefix = "org.eclipse.jdt.ls.core_";
  const name = entries.find((entry) => {
    if (!entry.startsWith(prefix) || !entry.endsWith(".jar")) return false;
    return requiredVersion === undefined || entry === `${prefix}${requiredVersion}.jar`;
  });
  if (!name) return undefined;
  return {
    path: path.join(pluginsDir, name),
    version: name.slice(prefix.length, -".jar".length),
  };
}

export async function installPinnedDistribution(options: {
  installDir: string;
  version: string;
  fetchImpl: typeof fetch;
  deadlineMs: number;
}): Promise<void> {
  const staging = await mkdtemp(path.join(tmpdir(), "jdtls-install-"));
  const archive = path.join(staging, "jdtls.tar.gz");
  const unpacked = path.join(staging, "unpacked");

  try {
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(new Error(`JDT LS download exceeded ${options.deadlineMs}ms deadline`)),
      options.deadlineMs,
    );
    let response: Response;
    let bytes: Buffer;
    try {
      response = await options.fetchImpl(ARCHIVE_URL, { signal: controller.signal });
      if (!response.ok) throw downloadError(options.version, `HTTP ${response.status}`);
      bytes = Buffer.from(await response.arrayBuffer());
    } catch {
      throw downloadError(options.version);
    } finally {
      clearTimeout(timeout);
    }
    const digest = createHash("sha256").update(bytes).digest("hex");
    if (digest !== ARCHIVE_SHA256) throw downloadError(options.version, "checksum mismatch");

    await writeFile(archive, bytes);
    await mkdir(unpacked);
    try {
      await execFileAsync("tar", ["-xzf", archive, "-C", unpacked], { timeout: options.deadlineMs });
    } catch {
      throw downloadError(options.version, "archive extraction failed");
    }
    if (!(await findCoreLauncher(unpacked, options.version))) {
      throw downloadError(options.version, "archive has no pinned org.eclipse.jdt.ls.core launcher jar");
    }

    await mkdir(path.dirname(options.installDir), { recursive: true });
    await rm(options.installDir, { recursive: true, force: true });
    await rename(unpacked, options.installDir);
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}

function downloadError(version: string, detail?: string): Error {
  const suffix = detail ? ` (${detail})` : "";
  return new Error(
    `Could not fetch pinned JDT LS ${version} from ${DISTRIBUTION_HOST}${suffix}; set JDTLS_HOME to a preinstalled distribution`,
  );
}
