#!/usr/bin/env node
// guard-write.mjs — Claude Code's stand-in for kiro's `toolsSettings.write.allowedPaths`.
//
// This one is load-bearing, not cosmetic. The checker is write-restricted to state files so it
// CANNOT quietly fix the maker's work and pass the result off as the maker's — that is what makes
// generator/evaluator separation (Lesson 9/13) a property of the configuration rather than a
// sentence in a prompt, and prompts are the layer that degrades.
//
// Claude Code has no per-agent path permission field. `Edit(...)` rules exist but live in
// settings.json and apply to the whole session, so they cannot give one agent a narrower surface
// than another. A `PreToolUse` hook declared in the subagent's own frontmatter fires only for that
// subagent and can return `permissionDecision: "deny"` — the only mechanism that expresses this.
//
// A trap worth knowing, and the reason this is a hook rather than a settings rule: Claude Code
// consults `Edit(path)` rules only. A `Write(docs/**)` rule is accepted and never applied.
//
// Usage (as a hook): node tools/guard-write.mjs <agent-name>    # payload on stdin
import { readFileSync, writeSync } from "node:fs";
import path from "node:path";

const agentName = process.argv[2];
const root = process.cwd();

const decide = (decision, reason) => {
  // writeSync, not process.stdout.write: exit() does not flush a pending async write to a pipe.
  writeSync(1, JSON.stringify({
    hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: decision, permissionDecisionReason: reason },
  }));
  process.exit(0);
};

let raw = "";
try { raw = readFileSync(0, "utf8"); } catch { /* no stdin */ }
let payload = {};
try { payload = JSON.parse(raw || "{}"); } catch { /* not JSON */ }

// The path the tool is about to touch. Shapes differ per tool; take the first that looks like one.
const input = payload.tool_input || payload.toolInput || {};
const target = input.file_path || input.path || input.notebook_path || input.filePath;
if (!target) decide("allow", "no file path in the tool input — nothing to check");

let manifest;
try { manifest = JSON.parse(readFileSync(path.join(root, "agents.manifest.json"), "utf8")); }
catch { decide("allow", "agents.manifest.json unreadable — not blocking on a missing rulebook"); }

const agent = (manifest.agents || []).find((a) => a.name === agentName);
// No `writes` list means unrestricted BY DESIGN (maker, test-implementer): say so rather than
// implying the check ran and found nothing.
if (!agent || !agent.writes) decide("allow", `${agentName} has no write restriction in agents.manifest.json`);

// Glob subset: ** (any depth), * (one segment). Enough for the path shapes the manifest uses.
const rel = path.relative(root, path.resolve(root, target));
const toRe = (g) => new RegExp("^" + g.split("**").map((s) =>
  s.split("*").map((x) => x.replace(/[.+^${}()|[\]\\]/g, "\\$&")).join("[^/]*")).join(".*") + "$");
const allowed = agent.writes.some((g) => toRe(g).test(rel) || rel === g);

if (rel.startsWith("..")) {
  decide("deny", `${agentName} may only write inside the project; ${target} is outside it.`);
}
if (!allowed) {
  decide("deny",
    `${agentName} is write-restricted by agents.manifest.json and ${rel} is not in its list ` +
    `(${agent.writes.join(", ")}). This is deliberate: it is what stops this role from doing ` +
    `another role's work and presenting the result as that role's. If the restriction is genuinely ` +
    `wrong, change the manifest and regenerate — do not work around it.`);
}
decide("allow", `${rel} is within ${agentName}'s allowed paths`);
