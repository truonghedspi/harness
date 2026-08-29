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
  // Gradle markers (docs/design/runtime-model.md#INV-ROUTE-4): settings.gradle(.kts) is the
  // multi-project root (analogous to the Maven reactor), build.gradle(.kts) is the project
  // (analogous to the nearest pom.xml).
  const gradleRoots: string[] = [];
  const gradleProjects: string[] = [];

  while (true) {
    if (existsSync(path.join(current, "pom.xml"))) {
      const pomXml = readFileSync(path.join(current, "pom.xml"), "utf8");
      mavenRoots.push({
        directory: current,
        isReactor: /<modules(?:\s[^>]*)?>[\s\S]*?<\/modules\s*>/i.test(pomXml),
      });
    }
    if (
      existsSync(path.join(current, "settings.gradle")) ||
      existsSync(path.join(current, "settings.gradle.kts"))
    ) {
      gradleRoots.push(current);
    }
    if (
      existsSync(path.join(current, "build.gradle")) ||
      existsSync(path.join(current, "build.gradle.kts"))
    ) {
      gradleProjects.push(current);
    }

    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }

  // Precedence, outermost-first: settings.gradle root > Maven reactor pom > nearest build.gradle
  // > nearest pom (docs/design/runtime-model.md#INV-ROUTE-4).
  const projectRoot =
    gradleRoots.at(-1) ??
    mavenRoots.findLast(({ isReactor }) => isReactor)?.directory ??
    gradleProjects[0] ??
    mavenRoots[0]?.directory;

  if (projectRoot === undefined) {
    return { error: `No Maven or Gradle workspace contains path: ${absolutePath}` };
  }

  return {
    projectRoot,
    workspaceId: createHash("sha256").update(projectRoot).digest("hex"),
  };
}
