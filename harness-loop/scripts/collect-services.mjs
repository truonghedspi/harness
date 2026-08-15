#!/usr/bin/env node
// collect-services.mjs — survey N directories and write the service registry.
//
// The harness is single-repo everywhere else. This is the collector for the layer above: it walks
// a set of paths, works out which of them are actually deployable services, and records how each
// one builds and starts. Design and the evidence behind it: references/multi-service.md.
//
// Four things a survey of seven real repositories forced, none of which a generic registry has:
//   1. A service is a DIRECTORY, not a repository — one repo held three modules.
//   2. Not every module is a service. A jar with no main is a library; deploying it is a bug.
//   3. "No build step" is a real answer. One service was server.js + db.json with no manifest.
//   4. Nothing was containerised. The collector reports that rather than inventing an image field.
//
// It fills what is discoverable and marks the rest needs-human. It never guesses `health` or
// `dependsOn`: a fabricated health check makes the environment report ready and the test fail
// somewhere less obvious, which is worse than an empty field.
//
// Usage:
//   node collect-services.mjs --roots ~/work/a,~/work/b [--out services.manifest.json] [--json]
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
const opt = (n, d = null) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const JSON_OUT = args.includes("--json");
const OUT = opt("--out", "services.manifest.json");
const ROOTS = String(opt("--roots", "")).split(",").map((r) => r.trim()).filter(Boolean)
  .map((r) => path.resolve(r.replace(/^~/, process.env.HOME || "~")));

if (!ROOTS.length) {
  console.error("usage: collect-services.mjs --roots <dir>[,<dir>...] [--out FILE] [--json]");
  process.exit(2);
}

const read = (p) => { try { return readFileSync(p, "utf8"); } catch { return null; } };
const readJSON = (p) => { try { return JSON.parse(readFileSync(p, "utf8")); } catch { return null; } };
const isDir = (p) => { try { return statSync(p).isDirectory(); } catch { return false; } };
const ls = (p) => { try { return readdirSync(p); } catch { return []; } };
const SKIP = new Set(["node_modules", ".git", "target", "build", "dist", ".venv", "venv", "__pycache__", "trace"]);

/** Files anywhere under dir, bounded, skipping build output.
 *  Depth 12, not 4: src/main/java/com/example/org/module/Thing.java is already 7 levels, and a
 *  shallow bound silently misclassified a service with a main() as a library. Third time in this
 *  codebase a bounded walk has been set too shallow for Java package structure — if you are adding
 *  another, start at 12. */
function walk(dir, depth = 12, acc = []) {
  if (depth < 0) return acc;
  for (const name of ls(dir)) {
    if (SKIP.has(name)) continue;
    const p = path.join(dir, name);
    if (isDir(p)) walk(p, depth - 1, acc); else acc.push(p);
  }
  return acc;
}

// --- candidate discovery -------------------------------------------------------------------------
// A candidate is any directory holding a build manifest, plus any root that holds none (finding 3:
// a service can be a bare script directory, and skipping it is the wrong answer).
const MANIFESTS = ["pom.xml", "build.gradle", "build.gradle.kts", "package.json", "go.mod", "Cargo.toml", "pyproject.toml"];
function candidates(root) {
  const out = [];
  const scan = (dir, depth) => {
    if (depth < 0) return;
    if (MANIFESTS.some((m) => existsSync(path.join(dir, m)))) out.push(dir);
    for (const name of ls(dir)) {
      if (SKIP.has(name)) continue;
      const p = path.join(dir, name);
      if (isDir(p)) scan(p, depth - 1);
    }
  };
  scan(root, 2);
  if (!out.length) out.push(root);          // finding 3
  // A parent that only aggregates modules is not itself a service; keep the leaves.
  return out.filter((d) => !out.some((o) => o !== d && o.startsWith(d + path.sep)));
}

// --- classification -------------------------------------------------------------------------------
function classify(dir) {
  const files = walk(dir);
  const pom = read(path.join(dir, "pom.xml"));
  const pkg = readJSON(path.join(dir, "package.json"));
  const gradle = read(path.join(dir, "build.gradle")) || read(path.join(dir, "build.gradle.kts"));

  // finding 2: an entry point is what separates a service from a library.
  const hasMain = files.some((f) => f.endsWith(".java") && /\bpublic\s+static\s+void\s+main\s*\(/.test(read(f) || ""))
    || !!(pkg && (pkg.bin || (pkg.scripts && (pkg.scripts.start || pkg.scripts.serve))))
    || files.some((f) => /\/(server|main|app|index)\.(js|mjs|ts)$/.test(f) && /listen\(|createServer|http\./.test(read(f) || ""))
    || files.some((f) => f.endsWith(".go") && /func main\(/.test(read(f) || ""));

  let build = null, start = null, stack = "unknown";
  if (pom) {
    stack = "maven";
    build = existsSync(path.join(dir, "mvnw")) ? "./mvnw -q package -DskipTests" : "mvn -q package -DskipTests";
  } else if (gradle) {
    stack = "gradle";
    build = existsSync(path.join(dir, "gradlew")) ? "./gradlew build -x test" : "gradle build -x test";
  } else if (pkg) {
    stack = "npm";
    build = pkg.scripts && pkg.scripts.build ? "npm run build" : null;   // finding 3
    start = pkg.scripts && pkg.scripts.start ? "npm start" : null;
  } else {
    // finding 3 again: no manifest at all is a real shape, not a failure.
    const entry = files.find((f) => /\/(server|index|main)\.(js|mjs)$/.test(f));
    if (entry) { stack = "node-script"; start = `node ${path.relative(dir, entry)}`; }
  }

  // A module carrying service-shaped dependencies but no entry point is neither: it is INCOMPLETE.
  // Observed on fix-adapter/gateway — three spring-boot deps, one config class, no main. Calling
  // that a library is tidy and wrong; it hides work nobody has done behind a plausible label.
  const serviceShaped = /spring-boot-starter|spring-boot-maven-plugin|quarkus|micronaut/.test(pom || gradle || "")
    || !!(pkg && pkg.dependencies && (pkg.dependencies.express || pkg.dependencies.fastify || pkg.dependencies["json-server"]));

  // A service with its own AGENTS.md has its own rules, and an agent working across repos loads
  // only the integration target's. Record the POINTER, never a copy: the file belongs to that repo
  // and copying it here creates a second, staler source of its conventions.
  const ownRules = ["AGENTS.md", "CLAUDE.md", "CONTRIBUTING.md"]
    .filter((f) => existsSync(path.join(dir, f)))
    .map((f) => `${dir}/${f}`);

  const dockerfiles = files.filter((f) => /\/Dockerfile[^/]*$/.test(f)).map((f) => path.relative(dir, f));
  const charts = files.filter((f) => /\/Chart\.ya?ml$/.test(f)).map((f) => path.dirname(path.relative(dir, f)));
  // Ports declared in code are common and idiosyncratic; surface the evidence, never a value.
  const portEvidence = files.filter((f) => /Ports?\.java$|ports?\.(ts|js)$|application\.ya?ml$/.test(f))
    .map((f) => path.relative(dir, f)).slice(0, 3);

  return { stack, hasMain, serviceShaped, build, start, dockerfiles, charts, portEvidence, ownRules };
}

// --- build the registry ------------------------------------------------------------------------
const services = [];
for (const root of ROOTS) {
  if (!isDir(root)) { console.error(`  ! not a directory, skipped: ${root}`); continue; }
  for (const dir of candidates(root)) {
    const c = classify(dir);
    const rel = path.relative(path.dirname(root), dir);
    services.push({
      id: rel.replace(/[/\\]/g, "-").toLowerCase(),
      path: dir,
      kind: c.hasMain ? "service" : c.serviceShaped ? "incomplete" : "library",
      stack: c.stack,
      build: c.build,
      start: c.start,
      // finding 4 — reported, never invented. An absent image is prerequisite work, not a blank field.
      image: c.dockerfiles.length ? { dockerfiles: c.dockerfiles } : null,
      chart: c.charts[0] || null,
      health: null,        // needs-human: "Running" is not health
      dependsOn: null,     // needs-human: no repository states which services a scenario needs
      replicas: null,      // needs-human: a deployment fact, and some services here are cluster-shaped
      // Read these BEFORE touching that service. They are its rules, not this repo's.
      ownRules: c.ownRules.length ? c.ownRules : null,
      evidence: { portsDeclaredIn: c.portEvidence },
    });
  }
}
services.sort((a, b) => a.id.localeCompare(b.id));

const deployable = services.filter((s) => s.kind === "service");
const manifest = {
  $comment:
    "Service registry for the integration target (docs/reference/multi-service.md). One entry per " +
    "SERVICE, and a service is a directory — a repo may hold several. kind=library entries are " +
    "dependencies and are never deployed. null in health/dependsOn/replicas means NEEDS A HUMAN: " +
    "the collector will not guess them, because a fabricated health check makes the environment " +
    "report ready and the test fail somewhere less obvious.",
  collectedAt: null,      // stamped by the caller; the collector stays deterministic
  services,
};

if (JSON_OUT) { process.stdout.write(JSON.stringify(manifest, null, 2) + "\n"); process.exit(0); }

writeFileSync(OUT, JSON.stringify(manifest, null, 2) + "\n");
console.log(`\nSurveyed ${ROOTS.length} root(s) → ${OUT}`);
console.log(`  ${deployable.length} service(s), ${services.length - deployable.length} librar(ies)\n`);
for (const s of services) {
  const flag = s.kind === "service" ? "svc " : s.kind === "incomplete" ? "??? " : "lib ";
  console.log(`  ${flag}${s.id.padEnd(26)} ${String(s.stack).padEnd(12)} build=${s.build ? "yes" : "none"}  image=${s.image ? "yes" : "NO"}  chart=${s.chart ? "yes" : "no"}`);
}
const incomplete = services.filter((s) => s.kind === "incomplete");
if (incomplete.length) {
  console.log(`\n${incomplete.length} module(s) carry service-shaped dependencies but have no entry point.`);
  console.log(`Neither a library nor a running service — most likely unfinished. Not classified either`);
  console.log(`way, because a plausible label would hide work nobody has done:`);
  for (const s of incomplete) console.log(`    ${s.id}`);
}
const noImage = deployable.filter((s) => !s.image);
if (noImage.length) {
  console.log(`\n${noImage.length} of ${deployable.length} service(s) have no Dockerfile.`);
  console.log(`A Kubernetes SIT cannot start what cannot be built into an image, and no registry field`);
  console.log(`fixes that — it is prerequisite engineering work. Listed so it is a decision, not a surprise:`);
  for (const s of noImage) console.log(`    ${s.id}`);
}
const withRules = services.filter((s) => s.ownRules);
if (withRules.length) {
  console.log(`\n${withRules.length} service(s) carry their own AGENTS.md/CLAUDE.md/CONTRIBUTING.md.`);
  console.log(`An agent working in the integration target loads only ITS rules, so those are listed in`);
  console.log(`the registry as pointers — read them before touching that service, do not copy them here:`);
  for (const s of withRules) console.log(`    ${s.id}: ${s.ownRules.join(", ")}`);
}
const unanswered = deployable.filter((s) => !s.health || !s.dependsOn);
if (unanswered.length) {
  console.log(`\n${unanswered.length} service(s) still need a human for health and/or dependsOn.`);
  console.log(`Those are not discoverable from a repository: "the pod is Running" is not health, and`);
  console.log(`nothing in the source states which services a scenario needs. Run the context-interviewer.`);
}
