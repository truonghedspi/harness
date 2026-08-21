import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { findCoreLauncher, installPinnedDistribution } from "./resolve-install.ts";

export const PINNED_JDTLS_VERSION = "1.61.0.202607231254";
export const PROVISION_DEADLINE_MS = 30_000;

const execFileAsync = promisify(execFile);

export interface ResolveInstallOptions {
  cacheDir: string;
  fetchImpl?: typeof fetch;
  deadlineMs?: number;
}

export interface ResolvedInstall {
  installDir: string;
  version: string;
  javaPath: string;
}

async function resolveJava(): Promise<string> {
  const configuredHome = process.env.JAVA_HOME?.trim();
  const javaPath = configuredHome ? path.join(configuredHome, "bin", "java") : "java";

  let banner: string;
  try {
    const result = await execFileAsync(javaPath, ["-version"], { timeout: 10_000 });
    banner = `${result.stderr}\n${result.stdout}`;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`Java 21 or newer is required, but ${javaPath} could not be run: ${detail}`);
  }

  const match = banner.match(/version\s+"(?:1\.)?(\d+)/i);
  const major = match ? Number(match[1]) : Number.NaN;
  if (!Number.isInteger(major) || major < 21) {
    throw new Error(`Java 21 or newer is required; ${javaPath} reported ${Number.isNaN(major) ? "an unknown version" : `Java ${major}`}`);
  }
  return javaPath;
}

export async function resolveInstall(options: ResolveInstallOptions): Promise<ResolvedInstall> {
  const javaPath = await resolveJava();
  const override = process.env.JDTLS_HOME?.trim();

  if (override) {
    const installDir = path.resolve(override);
    const launcher = await findCoreLauncher(installDir);
    if (!launcher) {
      throw new Error(`JDTLS_HOME ${installDir} has no resolvable plugins/org.eclipse.jdt.ls.core_*.jar`);
    }
    return { installDir, version: launcher.version, javaPath };
  }

  const installDir = path.resolve(options.cacheDir);
  const cached = await findCoreLauncher(installDir, PINNED_JDTLS_VERSION);
  if (cached) return { installDir, version: PINNED_JDTLS_VERSION, javaPath };

  await installPinnedDistribution({
    installDir,
    version: PINNED_JDTLS_VERSION,
    fetchImpl: options.fetchImpl ?? fetch,
    deadlineMs: options.deadlineMs ?? PROVISION_DEADLINE_MS,
  });
  return { installDir, version: PINNED_JDTLS_VERSION, javaPath };
}
