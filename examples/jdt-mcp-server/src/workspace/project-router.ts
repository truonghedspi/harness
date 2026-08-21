import { createHash } from "node:crypto";
import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import path from "node:path";

export type WorkspaceResolution =
  | { workspaceId: string; projectRoot: string }
  | { error: string };

export function resolveWorkspace(absolutePath: string): WorkspaceResolution {
  let canonicalPath: string;
  try {
    canonicalPath = realpathSync(absolutePath);
  } catch {
    return { error: `Cannot route path because it does not exist: ${absolutePath}` };
  }

  let current = statSync(canonicalPath).isDirectory()
    ? canonicalPath
    : path.dirname(canonicalPath);
  const mavenRoots: Array<{ directory: string; isReactor: boolean }> = [];

  while (true) {
    const pomPath = path.join(current, "pom.xml");
    if (existsSync(pomPath)) {
      const pomXml = readFileSync(pomPath, "utf8");
      mavenRoots.push({
        directory: current,
        isReactor: /<modules(?:\s[^>]*)?>[\s\S]*?<\/modules\s*>/i.test(pomXml),
      });
    }

    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }

  const projectRoot =
    mavenRoots.findLast(({ isReactor }) => isReactor)?.directory ??
    mavenRoots[0]?.directory;

  if (projectRoot === undefined) {
    return { error: `No Maven workspace contains path: ${absolutePath}` };
  }

  return {
    projectRoot,
    workspaceId: createHash("sha256").update(projectRoot).digest("hex"),
  };
}
