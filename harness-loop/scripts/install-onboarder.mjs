#!/usr/bin/env node
// install-onboarder.mjs — the one command you run against an existing repo.
//
// Chicken-and-egg: the onboarding agent's job is to decide how to scaffold this repo, so it has to
// exist before the scaffold does. This drops the smallest possible footprint — one prompt, one
// agent config — and nothing else. The agent then surveys, asks what it cannot infer, and runs
// setup-harness-loop.mjs itself with the flags it worked out.
//
// Deliberately minimal: pointing a scaffolder at someone's five-year-old repo before anyone has
// looked at it is how you get an AGENTS.md overwritten and a maintainer who never trusts the tool
// again.
//
// Usage: node install-onboarder.mjs --target /path/to/existing/repo [--force]
import { readFileSync, writeFileSync, existsSync, mkdirSync, cpSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const args = process.argv.slice(2);
const opt = (n, d = null) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const FORCE = args.includes("--force");
const TARGET = path.resolve(opt("--target", "."));
const skillRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

if (!existsSync(TARGET)) { console.error(`no such directory: ${TARGET}`); process.exit(2); }

const AGENT = {
  name: "harness-onboarder",
  description:
    "Brings an EXISTING codebase under the harness: surveys the repo, asks only what it cannot infer, " +
    "scaffolds without overwriting, backfills the feature list from real in-flight work, and records an " +
    "adoption baseline so the back catalogue is accepted debt instead of a wall of day-one warnings.",
  prompt: "file://../../prompts/harness-onboarder.md",
  tools: ["read", "write", "shell", "*"],
  allowedTools: ["read"],
  includeMcpJson: true,
  resources: ["file://../../prompts/harness-onboarder.md", "file://../../skills/harness-upgrade/SKILL.md",
    ...(existsSync(path.join(TARGET, "docs", "constraints.md")) ? ["file://../../docs/constraints.md"] : [])],
};

const CLAUDE_AGENT = `---
name: harness-onboarder
description: ${JSON.stringify(AGENT.description)}
tools: Read, Write, Edit, Bash, Grep, Glob, WebFetch
---

`;

const files = [
  ["prompts/harness-onboarder.md",
    readFileSync(path.join(skillRoot, "prompts", "harness-onboarder.md"), "utf8")
      .replaceAll("<skill>", skillRoot)],
  [".kiro/agents/harness-onboarder.json", JSON.stringify(AGENT, null, 2) + "\n"],
  // Both runtimes, because we do not know which one this repo's owner uses and asking is a worse
  // first impression than two small files. Claude Code has no prompt-file field: the body IS the
  // system prompt, so the prompt is inlined here rather than referenced.
  [".claude/agents/harness-onboarder.md", CLAUDE_AGENT +
    readFileSync(path.join(skillRoot, "prompts", "harness-onboarder.md"), "utf8")
      .replaceAll("<skill>", skillRoot)],
];

const written = [], skipped = [];
for (const [rel, content] of files) {
  const dest = path.join(TARGET, rel);
  if (existsSync(dest) && !FORCE) { skipped.push(rel); continue; }
  mkdirSync(path.dirname(dest), { recursive: true });
  writeFileSync(dest, content);
  written.push(rel);
}
const upgradeSkillDest = path.join(TARGET, "skills", "harness-upgrade");
if (existsSync(upgradeSkillDest) && !FORCE) skipped.push("skills/harness-upgrade/**");
else {
  mkdirSync(path.dirname(upgradeSkillDest), { recursive: true });
  cpSync(path.join(skillRoot, "onboarding-skills", "harness-upgrade"), upgradeSkillDest,
    { recursive: true, force: true });
  written.push("skills/harness-upgrade/**");
}

console.log(`\nOnboarder installed into: ${TARGET}`);
for (const f of written) console.log(`  + ${f}`);
for (const f of skipped) console.log(`  · ${f} (exists — re-run with --force to overwrite)`);
console.log(`\nOnly the onboarder and its upgrade capability were touched. Next:\n`);
console.log(`  cd ${TARGET}`);
console.log(`  kiro-cli chat --agent harness-onboarder      # or:`);
console.log(`  claude -p "Onboard this repository onto the harness." --agent harness-onboarder\n`);
console.log(`It will survey the repo, ask you a single round of questions with recommended answers,`);
console.log(`and only then scaffold — never overwriting what is already there.`);
console.log(`Contract: ${path.join(skillRoot, "references", "adopting-an-existing-project.md")}\n`);
