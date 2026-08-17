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
// CODEX CLI uses the same hook contract — verified by running codex 0.147.0 — with two differences
// that both fail SILENTLY if unhandled:
//
//   1. Its edit tool is `apply_patch`, and the payload carries NO file_path. `tool_input` is a patch
//      envelope: {"command": "*** Begin Patch\n*** Add File: hello.txt\n+hi\n*** End Patch"}. The
//      original version of this script looked for file_path, found none, and returned ALLOW — so on
//      Codex the confinement was absent while every log line said the hook ran. The envelope is
//      parsed below.
//   2. Codex agent TOML has no hooks field, so the hook is declared project-wide in
//      .codex/hooks.json and cannot be told the role via argv. Env vars DO propagate from the codex
//      process into hook subprocesses (verified), so tools/codex-dispatch.mjs exports HARNESS_AGENT
//      and `--from-env` reads it.
//
// Usage (as a hook): node tools/guard-write.mjs <agent-name>    # payload on stdin
//                    node tools/guard-write.mjs --from-env      # role from $HARNESS_AGENT (Codex)
import { existsSync, readFileSync, writeSync } from "node:fs";
import path from "node:path";

const arg = process.argv[2];
const agentName = arg === "--from-env" ? (process.env.HARNESS_AGENT || null) : arg;
const root = process.cwd();
const home = existsSync(path.join(root, "harness", "agents.manifest.json")) ? path.join(root, "harness") : root;

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
if (raw.trim()) {
  // A payload that arrived but would not parse used to fall through to `{}` and then to
  // "nothing to check" — an ALLOW indistinguishable from a real one. If the guard cannot read the
  // request it cannot police it, and silently waving it through is the failure mode this whole
  // mechanism exists to prevent.
  try { payload = JSON.parse(raw); }
  catch (e) {
    decide("deny", `guard-write could not parse the hook payload (${e.message}). Refusing the write: ` +
      `an unreadable request cannot be checked, and allowing it would leave the role unconfined while ` +
      `every log line still says the guard ran. Report this as a harness-layer issue.`);
  }
}

// The path(s) the tool is about to touch. Shapes differ per tool AND per runtime; collect them all,
// because one denied path in a multi-file patch has to sink the whole patch.
const input = payload.tool_input || payload.toolInput || {};
const targets = [];
for (const k of ["file_path", "path", "notebook_path", "filePath"]) if (input[k]) targets.push(input[k]);

// A shell command that writes. The edit tools are not the only way to create a file, and a
// write-restricted role that can run `cat > probe.mjs` is not write-restricted. Best-effort by
// nature — a script it launches can write through any API — so this catches the shapes an agent
// actually uses, and clean-state's stray-verification-script catches the rest.
const shellCmd = typeof input.command === "string" ? input.command
  : Array.isArray(input.command) ? input.command.join(" ") : "";
if (shellCmd && !/\*\*\* (Begin Patch|Add File|Update File)/.test(shellCmd)) {
  for (const re of [/(?:^|[;&|]|\s)(?:>>?)\s*("[^"]+"|'[^']+'|[^\s;&|<>]+)/g,          // > file, >> file
                    /\btee\s+(?:-a\s+)?("[^"]+"|'[^']+'|[^\s;&|<>]+)/g,                  // tee file
                    /\b(?:cp|mv)\s+\S+\s+("[^"]+"|'[^']+'|[^\s;&|<>]+)/g]) {            // cp/mv dest
    for (const m of shellCmd.matchAll(re)) {
      const t = m[1].replace(/^["']|["']$/g, "");
      if (t === "/dev/null" || t.startsWith("/dev/")) continue;      // not a file write worth guarding
      // Ephemeral system temp is allowed for shell redirects. The point of confinement is that this
      // role cannot alter the REPO — a build log in /tmp cannot, and denying it is the kind of
      // friction that teaches people to switch the guard off. Edit tools are still denied outside
      // the project: a file the agent deliberately edits out there is a different act.
      if (/^(\/tmp\/|\/private\/tmp\/|\/var\/folders\/|\/var\/tmp\/)/.test(t)) continue;
      if (process.env.TMPDIR && t.startsWith(process.env.TMPDIR)) continue;
      targets.push(t);
    }
  }
}

// Codex `apply_patch`: one envelope, any number of files, no file_path field anywhere.
const envelope = typeof input.command === "string" ? input.command
  : Array.isArray(input.command) ? input.command.join(" ") : "";
if (/\*\*\* (Begin Patch|Add File|Update File|Delete File)/.test(envelope)) {
  for (const m of envelope.matchAll(/^\*\*\* (?:Add|Update|Delete) File: (.+)$/gm)) targets.push(m[1].trim());
  // A rename writes the destination as much as the source.
  for (const m of envelope.matchAll(/^\*\*\* Move to: (.+)$/gm)) targets.push(m[1].trim());
  if (!targets.length) {
    decide("deny", "this looks like an apply_patch envelope but no file path could be read from it. " +
      "Refusing rather than guessing: an unparsed patch is exactly how a write-restricted role ends " +
      "up writing anywhere. Report this payload as a harness-layer issue.");
  }
}

if (!targets.length) decide("allow", "no file path in the tool input — nothing to check");

if (!agentName) {
  // Codex, interactive: hooks are project-wide and nothing identifies the role, so the per-path
  // restriction genuinely cannot be applied. Say so out loud instead of implying a check ran.
  decide("allow", "NO ROLE IDENTIFIED (HARNESS_AGENT unset) — per-agent write restrictions were NOT " +
    "applied to this write. Under Codex that is expected outside tools/codex-dispatch.mjs; see " +
    "docs/reference/runtimes.md. Do not treat this run as evidence that a role stayed in its lane.");
}

let manifest;
try { manifest = JSON.parse(readFileSync(path.join(home, "agents.manifest.json"), "utf8")); }
catch { decide("allow", "agents.manifest.json unreadable — not blocking on a missing rulebook"); }

const agent = (manifest.agents || []).find((a) => a.name === agentName);
// No `writes` list means unrestricted BY DESIGN (maker, test-implementer): say so rather than
// implying the check ran and found nothing.
if (!agent || !agent.writes) decide("allow", `${agentName} has no write restriction in agents.manifest.json`);

// Glob subset: ** (any depth), * (one segment). Enough for the path shapes the manifest uses.
const toRe = (g) => new RegExp("^" + g.split("**").map((s) =>
  s.split("*").map((x) => x.replace(/[.+^${}()|[\]\\]/g, "\\$&")).join("[^/]*")).join(".*") + "$");

const rels = targets.map((t) => path.relative(root, path.resolve(root, t)));
const outside = rels.filter((r) => r.startsWith(".."));
if (outside.length) {
  decide("deny", `${agentName} may only write inside the project; ${outside.join(", ")} is outside it.`);
}
const blocked = rels.filter((r) => !agent.writes.some((g) => toRe(g).test(r) || r === g));
if (blocked.length) {
  decide("deny",
    `${agentName} is write-restricted by agents.manifest.json and ${blocked.join(", ")} ` +
    `${blocked.length > 1 ? "are" : "is"} not in its list ` +
    `(${agent.writes.join(", ")}). This is deliberate: it is what stops this role from doing ` +
    `another role's work and presenting the result as that role's. If the restriction is genuinely ` +
    `wrong, change the manifest and regenerate — do not work around it.`);
}
decide("allow", `${rels.join(", ")} ${rels.length > 1 ? "are" : "is"} within ${agentName}'s allowed paths`);
