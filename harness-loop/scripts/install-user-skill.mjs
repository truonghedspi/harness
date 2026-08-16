#!/usr/bin/env node
// Install one versioned user-scope skill without silently overwriting local customization.
import { cpSync, existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const args = process.argv.slice(2);
const opt = (n, d = null) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const name = opt("--name");
const force = args.includes("--force");
const skillsRoot = path.resolve(opt("--skills-root", path.join(process.env.HOME || "", ".agents", "skills")));
if (!name) { console.error("usage: install-user-skill.mjs --name SKILL [--skills-root DIR] [--force]"); process.exit(2); }
const here = path.dirname(fileURLToPath(import.meta.url));
const source = path.resolve(here, "..", "user-skills", name);
const dest = path.join(skillsRoot, name);
if (!existsSync(path.join(source, "SKILL.md"))) { console.error(`error: unknown user skill ${name}`); process.exit(2); }
if (existsSync(dest) && !force) { console.error(`error: ${dest} exists; review local EXTEND.md, then use --force deliberately`); process.exit(3); }
mkdirSync(skillsRoot, { recursive: true });
cpSync(source, dest, { recursive: true, force });
console.log(`installed ${name} → ${dest}`);
