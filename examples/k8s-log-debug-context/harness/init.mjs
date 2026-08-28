#!/usr/bin/env node
// init.mjs — the baseline gate. Run at the start AND end of every session (Lesson 6/9/12).
// Green = the standard startup path works and verification passes. A loop must never run on red.
//
// This is the IMPLEMENTATION. `./harness/init.sh` and `harness/init.cmd` are one-line wrappers around it, so the
// same gate runs on macOS, Linux, Git Bash, WSL, cmd.exe and PowerShell. It is Node rather than a
// shell script plus a PowerShell twin for two reasons: node is already a hard dependency of every
// other tool in this harness (tools/*.mjs), and two hand-maintained implementations of the same
// gate would drift — silently, in the direction of the one nobody runs.
//
// Windows specifics handled below, each of which breaks a naive port:
//   * package-manager binaries are `npm.cmd` / `pnpm.cmd` shims, not executables → shell: true
//   * the Maven and Gradle wrappers are `mvnw.cmd` / `gradlew.bat`, not `./mvnw` / `./gradlew`
//   * there is no exec bit, so "is init.sh chmod +x" is not a meaningful check there
//   * `python3` usually does not exist; `python` does
import { existsSync, readdirSync, mkdirSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
// A directory literally named "harness" is not proof of a contained layout (the harness-loop
// skill's own repo is named "harness" and is flat) — only the thin root AGENTS.md a contained
// scaffold writes is (HI-055). Require both.
const PROJECT_ROOT = path.basename(ROOT) === "harness" && existsSync(path.join(path.dirname(ROOT), "AGENTS.md"))
  ? path.dirname(ROOT) : ROOT;
const HARNESS_PREFIX = PROJECT_ROOT === ROOT ? "" : "harness/";
process.chdir(PROJECT_ROOT);
const IS_WIN = process.platform === "win32";

const say = (m) => console.log(m);
const die = (m) => { console.error(m); process.exit(1); };
const has = (f) => existsSync(path.join(PROJECT_ROOT, f));
const hasHarness = (f) => existsSync(path.join(ROOT, f));

// Every verification command goes through here, and a non-zero exit STOPS the run.
//
// The bash version this replaces wrote `has check && { run check; } || true` — intended as "skip a
// script that does not exist", but `|| true` cannot tell that apart from "the script ran and
// failed". A project with a failing test suite printed "Baseline green" and exited 0. A gate that
// cannot go red is not a gate, so the two cases are separate here: `optional` decides whether to
// RUN a step, never whether to accept its failure.
function run(cmd, { label = null, okExitCodes = [0], env = null } = {}) {
  if (label) say(`=== ${label} ===`);
  const opts = { stdio: "inherit", shell: true, cwd: PROJECT_ROOT };
  if (env) opts.env = { ...process.env, ...env };
  const r = spawnSync(cmd, opts);
  if (r.error) die(`init: could not run \`${cmd}\` — ${r.error.message}`);
  const code = r.status === null ? 1 : r.status;
  if (!okExitCodes.includes(code)) {
    die(`\ninit: \`${cmd}\` failed with exit code ${code}. Baseline is RED — fix this before the loop runs.`);
  }
  return code;
}
// Is a command available at all? `command -v` does not exist on cmd.exe.
const available = (bin) =>
  spawnSync(IS_WIN ? "where" : "command", IS_WIN ? [bin] : ["-v", bin],
    { stdio: "ignore", shell: !IS_WIN }).status === 0;

// Discover an installed JDK 21 for the Maven branch. Homebrew's OpenJDK 21 is keg-only, so the macOS
// helper lies here (`/usr/libexec/java_home -v 21` returns the host default, e.g. Temurin 25). Consult
// the Homebrew keg directly and verify its `release` file before trusting the path. Returning null
// leaves JAVA_HOME/PATH inherited, so a missing JDK 21 stays red and the Enforcer tells the truth.
function discoverJdk21Home() {
  const kegs = [
    "/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home", // Apple Silicon Homebrew
    "/usr/local/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home",    // Intel Homebrew
  ];
  for (const home of kegs) {
    if (!existsSync(path.join(home, "bin", IS_WIN ? "java.exe" : "java"))) continue;
    try {
      if (/^JAVA_VERSION="21(?:\.|")/m.test(readFileSync(path.join(home, "release"), "utf8"))) return home;
    } catch { /* no release file: not a trusted JDK 21 */ }
  }
  return null;
}

say(`=== Harness init: Kubernetes Log Debug Context ===`);

// Observability (Lesson 11): ensure the trace sink exists and record this run.
mkdirSync(path.join(ROOT, "trace"), { recursive: true });
if (hasHarness("tools/trace.mjs")) {
  spawnSync(process.execPath, ["tools/trace.mjs", "init", "session-start", "init.mjs"],
    { stdio: "ignore", cwd: ROOT });
}

// Keep the always-loaded feature digest in step with the source of truth (docs/reference/
// llm-failure-modes.md: the full list dominates every agent's context, the digest is what they read).
if (hasHarness("tools/feature-digest.mjs")) {
  spawnSync(process.execPath, ["tools/feature-digest.mjs", "--target", "."], { stdio: "ignore", cwd: ROOT });
}

// >>> VERIFICATION  (the scaffolder replaces this block when --commands is given)
if (has("package.json")) {
  const PM = has("pnpm-lock.yaml") ? "pnpm"
    : has("yarn.lock") ? "yarn"
    : (has("bun.lockb") || has("bun.lock")) ? "bun"
    : "npm";
  run(`${PM} install`, { label: `Installing dependencies with ${PM}` });
  let scripts = {};
  try { scripts = JSON.parse(readFileSync(path.join(ROOT, "package.json"), "utf8")).scripts || {}; } catch { /* none */ }
  for (const name of ["check", "typecheck", "lint", "build", "test"]) {
    if (!scripts[name]) continue;                       // absent: skip. Present: its exit code counts.
    const cmd = name === "test" && PM === "npm" ? "npm test"
      : name === "test" ? `${PM} test`
      : `${PM} run ${name}`;
    run(cmd, { label: name });
  }
} else if (has("pyproject.toml") || has("requirements.txt")) {
  const PY = available("python3") ? "python3" : available("python") ? "python" : null;
  if (!PY) die("init: pyproject.toml/requirements.txt found but neither python3 nor python is on PATH.");
  // pytest exit 5 = "no tests collected", which is not a failure for a project that has none yet.
  run(`${PY} -m pytest`, { label: "Python tests", okExitCodes: [0, 5] });
  run(`${PY} -m compileall -q -x "(^|/)(\\.?venv|env|node_modules|build|dist|__pycache__)(/|$)" .`);
} else if (has("go.mod")) {
  run("go build ./...", { label: "Go verification" });
  run("go test ./...");
} else if (has("Cargo.toml")) {
  run("cargo build", { label: "Rust verification" });
  run("cargo test");
} else if (has("pom.xml")) {
  // The wrapper is mvnw.cmd on Windows and ./mvnw elsewhere; preferring the wrapper matters because
  // a bare `mvn` is frequently not on PATH at all (that was a real harness-layer finding).
  const mvn = IS_WIN ? (has("mvnw.cmd") ? "mvnw.cmd" : "mvn") : (has("mvnw") ? "./mvnw" : "mvn");
  // The Enforcer pins [21,22); select an installed JDK 21 for the spawned wrapper only, leaving the
  // caller's shell untouched. No JDK 21 found -> inherit the environment and let the Enforcer report
  // the real red instead of guessing.
  const jdk21 = discoverJdk21Home();
  const mvnEnv = jdk21
    ? { JAVA_HOME: jdk21, PATH: `${path.join(jdk21, "bin")}${path.delimiter}${process.env.PATH ?? ""}` }
    : null;
  run(`${mvn} -q verify`, { label: "Maven verification", env: mvnEnv });
} else if (has("build.gradle") || has("build.gradle.kts")) {
  const gradle = IS_WIN ? (has("gradlew.bat") ? "gradlew.bat" : "gradle") : (has("gradlew") ? "./gradlew" : "gradle");
  run(`${gradle} build test`, { label: "Gradle verification" });
} else if (readdirSync(PROJECT_ROOT).some((f) => f.endsWith(".csproj") || f.endsWith(".sln"))) {
  run("dotnet build", { label: ".NET verification" });
  run("dotnet test");
} else {
  // Exit 1, not 0: a gate that cannot go red is not a gate, and exiting 0 here would green-light a
  // loop on a project nothing has verified.
  die("No recognized manifest. Edit this VERIFICATION block with the project's build/test commands.");
}
// <<< VERIFICATION

say("=== Baseline green ===");
say("");
say(`Next: read ${HARNESS_PREFIX}feature_list.json, pick ONE eligible feature, advance it, re-verify before 'done'.`);
