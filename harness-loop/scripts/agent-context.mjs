#!/usr/bin/env node
// agent-context.mjs — Claude Code's stand-in for kiro's per-agent `resources`.
//
// kiro auto-loads a list of files into each agent. Claude Code has no such field: a subagent gets
// its system prompt plus CLAUDE.md, and CLAUDE.md is one file shared by every agent. Losing
// per-role context would undo a deliberate design — the checker and the maker are supposed to
// arrive knowing different things, and context-budget.mjs exists to keep each of those small
// (docs/reference/llm-failure-modes.md).
//
// A `SubagentStart` hook can inject text via `hookSpecificOutput.additionalContext`. So this reads
// the agent's resource list from agents.manifest.json and injects the files at spawn.
//
// Strictly better than kiro's version in one way: kiro loads a static list, this reads the files
// at spawn, so a resource that changed mid-session is current and a resource that was deleted is
// reported instead of silently missing.
//
// Wired by tools/gen-agents.mjs into each generated .claude/agents/*.md. Reads the hook payload on
// stdin (unused except for logging) and takes the agent name as argv[2], because the manifest is
// the authority on what that agent should see.
//
// Usage (as a hook): node tools/agent-context.mjs <agent-name>
import { readFileSync, existsSync, writeSync } from "node:fs";
import path from "node:path";
import { planContext } from "./context-plan.mjs";

const agentName = process.argv[2];
const root = process.cwd();
// writeSync, not process.stdout.write: exit() does not flush a pending async write to a pipe,
// so the tail of a large payload is silently lost. Found by the demo cutting off mid-file.
const emit = (o) => { writeSync(1, JSON.stringify(o)); process.exit(0); };
const ok = (text, contextInputs = []) => emit({
  hookSpecificOutput: { hookEventName: "SubagentStart", additionalContext: text },
  harnessContextInputs: contextInputs,
});

let manifest;
try { manifest = JSON.parse(readFileSync(path.join(root, "agents.manifest.json"), "utf8")); }
catch { ok(`[harness] agents.manifest.json unreadable from ${root} — no per-agent context injected.`); }

const agent = (manifest.agents || []).find((a) => a.name === agentName);
if (!agent) ok(`[harness] no manifest entry for agent "${agentName}" — no per-agent context injected.`);

const parts = [];
const missing = [];
const contextInputs = [];
for (const rel of agent.resources || []) {
  const abs = path.join(root, rel);
  if (!existsSync(abs)) { missing.push(rel); continue; }
  let body;
  try { body = readFileSync(abs, "utf8"); } catch { missing.push(rel); continue; }
  parts.push(`<file path="${rel}">\n${body.trimEnd()}\n</file>`);
}

// A feature touching a sibling service opts into that service's original rules. Selection is
// scope-based and deterministic; loading every service's rules would turn multi-repo awareness
// into permanent context tax and make conflicting conventions impossible to apply correctly.
for (const input of planContext({ target: root }).inputs) {
  contextInputs.push(input);
  if (input.status === "missing") { missing.push(input.path); continue; }
  let body;
  try { body = readFileSync(input.path, "utf8"); } catch { missing.push(input.path); continue; }
  const freshness = input.status === "stale"
    ? ` STALE expected-sha256="${input.expectedSha256}" actual-sha256="${input.actualSha256}"`
    : "";
  parts.push(`<external-file path="${input.path}" scope="${input.scope}" sha256="${input.actualSha256}"${freshness}>\n` +
    `${body.trimEnd()}\n</external-file>`);
}

// A missing resource is reported, never swallowed. On kiro the same situation is silent, and
// silent is how an agent ends up running without the rulebook it was configured to load (HI-005).
const header = `The following files are loaded automatically for the "${agentName}" role. They are the\n` +
  `current contents on disk at the moment you started. Treat them as already read.` +
  (missing.length ? `\n\nMISSING (declared in agents.manifest.json but not on disk — report this,\n` +
    `do not work around it): ${missing.join(", ")}` : "");

ok(`${header}\n\n${parts.join("\n\n")}`, contextInputs);
