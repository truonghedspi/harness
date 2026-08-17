#!/usr/bin/env node
// Install one versioned user-scope skill without silently overwriting local customization.
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const args = process.argv.slice(2);
const opt = (n, d = null) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const name = opt("--name");
const force = args.includes("--force");
const steeringOnly = args.includes("--steering-only");
const installKiroSteering = !args.includes("--no-kiro-steering");
const skillsRoot = path.resolve(opt("--skills-root", path.join(process.env.HOME || "", ".agents", "skills")));
const kiroHome = path.resolve(opt("--kiro-home", process.env.KIRO_HOME || path.join(process.env.HOME || "", ".kiro")));
if (!name) { console.error("usage: install-user-skill.mjs --name SKILL [--skills-root DIR] [--kiro-home DIR] [--steering-only|--no-kiro-steering] [--force]"); process.exit(2); }
const here = path.dirname(fileURLToPath(import.meta.url));
const source = path.resolve(here, "..", "user-skills", name);
const dest = path.join(skillsRoot, name);
const steeringSource = path.join(source, "KIRO_STEERING.md");
const steeringDest = path.join(kiroHome, "steering", `harness-skill-${name}.md`);
if (!existsSync(path.join(source, "SKILL.md"))) { console.error(`error: unknown user skill ${name}`); process.exit(2); }
if (installKiroSteering && !existsSync(steeringSource)) { console.error(`error: ${name} has no KIRO_STEERING.md activation bridge`); process.exit(2); }
if (steeringOnly && !existsSync(path.join(dest, "SKILL.md"))) { console.error(`error: ${dest}/SKILL.md does not exist; install the skill before --steering-only`); process.exit(2); }
if (!steeringOnly && existsSync(dest) && !force) { console.error(`error: ${dest} exists; review local EXTEND.md, then use --force deliberately`); process.exit(3); }
if (installKiroSteering && existsSync(steeringDest) && !force) { console.error(`error: ${steeringDest} exists; use --force deliberately`); process.exit(3); }
if (!steeringOnly) {
  mkdirSync(skillsRoot, { recursive: true });
  cpSync(source, dest, { recursive: true, force, filter: (entry) => path.basename(entry) !== "KIRO_STEERING.md" });
  console.log(`installed ${name} → ${dest}`);
}
if (installKiroSteering) {
  mkdirSync(path.dirname(steeringDest), { recursive: true });
  const content = readFileSync(steeringSource, "utf8").replaceAll("{{SKILL_PATH}}", path.join(dest, "SKILL.md"));
  writeFileSync(steeringDest, content);
  console.log(`installed Kiro steering → ${steeringDest}`);
}
