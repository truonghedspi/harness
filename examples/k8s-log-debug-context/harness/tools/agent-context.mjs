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
import { readFileSync, existsSync, readdirSync, writeSync } from "node:fs";
import path from "node:path";
import { planContext } from "./context-plan.mjs";

const agentName = process.argv[2];
const root = process.cwd();
const home = existsSync(path.join(root, "harness", "agents.manifest.json")) ? path.join(root, "harness") : root;
// writeSync, not process.stdout.write: exit() does not flush a pending async write to a pipe,
// so the tail of a large payload is silently lost. Found by the demo cutting off mid-file.
const emit = (o) => { writeSync(1, JSON.stringify(o)); process.exit(0); };
const ok = (text, contextInputs = []) => emit({
  hookSpecificOutput: { hookEventName: "SubagentStart", additionalContext: text },
  harnessContextInputs: contextInputs,
});

let manifest;
try { manifest = JSON.parse(readFileSync(path.join(home, "agents.manifest.json"), "utf8")); }
catch { ok(`[harness] agents.manifest.json unreadable from ${root} — no per-agent context injected.`); }

const agent = (manifest.agents || []).find((a) => a.name === agentName);
if (!agent) ok(`[harness] no manifest entry for agent "${agentName}" — no per-agent context injected.`);

// docs/design/shared-memory-tier.md INV-RES-1: read at spawn (not baked at generation, unlike
// kiro/Codex), so a fact promoted mid-session is visible without regenerating anything — the
// same "strictly better than kiro's static list" property this file already claims above.
const sharedMemoryResources = () => {
  try {
    return readdirSync(path.join(home, "memory", "shared")).filter((f) => f.endsWith(".md")).sort()
      .map((f) => path.relative(root, path.join(home, "memory", "shared", f)));
  } catch { return []; }
};

const parts = [];
const missing = [];
const contextInputs = [];
let contextReceipt = null;
for (const rel of [...(agent.resources || []), ...sharedMemoryResources()]) {
  const abs = path.join(root, rel);
  if (!existsSync(abs)) { missing.push(rel); continue; }
  let body;
  try { body = readFileSync(abs, "utf8"); } catch { missing.push(rel); continue; }
  parts.push(`<file path="${rel}">\n${body.trimEnd()}\n</file>`);
}

// A feature touching a sibling service opts into that service's original rules. Selection is
// scope-based and deterministic; loading every service's rules would turn multi-repo awareness
// into permanent context tax and make conflicting conventions impossible to apply correctly.
const planned = planContext({ target: home });
for (const input of planned.inputs) {
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

// A fresh feature packet is a bounded, provenance-bearing handoff: established facts are loaded
// once, while mustRead keeps the implementation anchored to the actual code and frozen oracle.
// If any cited source changed, do not inject conclusions that may no longer be true.
if (planned.featurePacket) {
  const fp = planned.featurePacket;
  contextInputs.push({ kind: "feature-context-packet", path: fp.path, status: fp.status,
    sourceInputs: fp.sourceInputs });
  if (fp.status === "current") {
    parts.push(`<feature-context-packet path="${fp.path}">\n${JSON.stringify(fp.packet, null, 2)}\n</feature-context-packet>`);
    const read = [];
    for (const input of fp.mustReadInputs) {
      parts.push(`<feature-must-read path="${input.declaredPath}">\n${readFileSync(input.path, "utf8").trimEnd()}\n</feature-must-read>`);
      read.push(input.declaredPath);
    }
    contextReceipt = { schema: "context-receipt/1", feature: planned.feature,
      packet: fp.path, status: "consumed", mustRead: read };
  } else {
    parts.push(`[harness] feature context packet ${fp.path} is ${fp.status}; do not trust its facts. ` +
      `Return to its cited sources and ask the planner to refresh the packet.`);
    contextReceipt = { schema: "context-receipt/1", feature: planned.feature,
      packet: fp.path, status: fp.status, mustRead: [] };
  }
}

// A missing resource is reported, never swallowed. On kiro the same situation is silent, and
// silent is how an agent ends up running without the rulebook it was configured to load (HI-005).
const header = `The following files are loaded automatically for the "${agentName}" role. They are the\n` +
  `current contents on disk at the moment you started. Treat them as already read.` +
  (missing.length ? `\n\nMISSING (declared in agents.manifest.json but not on disk — report this,\n` +
    `do not work around it): ${missing.join(", ")}` : "");

emit({ hookSpecificOutput: { hookEventName: "SubagentStart",
  additionalContext: `${header}\n\n${parts.join("\n\n")}` },
  harnessContextInputs: contextInputs, harnessContextReceipt: contextReceipt });
