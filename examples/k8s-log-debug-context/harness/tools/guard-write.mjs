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
// CODEX CLI shares the same path-classification intent, but not the same serialized allow output.
// Deny was verified on 0.147.0; 0.149.0 rejects permissionDecision:"allow", so the adapter below
// emits no decision for Codex allow. Its other differences also fail SILENTLY if unhandled:
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

const cliArgs = process.argv.slice(2);
const runtimeAt = cliArgs.indexOf("--runtime");
const runtime = runtimeAt >= 0 ? cliArgs[runtimeAt + 1] : "claude";
const runtimeValueAt = runtimeAt >= 0 ? runtimeAt + 1 : -1;
const arg = cliArgs.find((value, index) => value !== "--runtime" && index !== runtimeValueAt);
const agentName = arg === "--from-env" ? (process.env.HARNESS_AGENT || null) : arg;
const root = process.cwd();
const home = existsSync(path.join(root, "harness", "agents.manifest.json")) ? path.join(root, "harness") : root;

const decide = (decision, reason) => {
  // writeSync, not process.stdout.write: exit() does not flush a pending async write to a pipe.
  // Codex 0.149 rejects every affirmative enum (`allow`, `approve`, `ask`). Its allow response is
  // the absence of a decision; only deny is explicit. Claude uses the affirmative `allow` value.
  // Keep that runtime difference here, at the adapter seam, instead of leaking it into every
  // path-classification branch below.
  const output = runtime === "codex" && decision === "allow" ? {} : {
    hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: decision, permissionDecisionReason: reason },
  };
  writeSync(1, JSON.stringify(output));
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

// Glob subset: ** (any depth), * (one segment). Enough for the path shapes the manifest uses.
const toRe = (g) => new RegExp("^" + g.split("**").map((s) =>
  s.split("*").map((x) => x.replace(/[.+^${}()|[\]\\]/g, "\\$&")).join("[^/]*")).join(".*") + "$");
const rels = targets.map((t) => path.relative(root, path.resolve(root, t)));
const outside = rels.filter((r) => r.startsWith(".."));

// --- slice confinement -------------------------------------------------------------------------
// A parallel maker iteration (tools/work-split.mjs) runs several makers at once inside ONE feature.
// They are safe only while their write surfaces stay disjoint, and "stay disjoint" cannot be a
// sentence in a brief: the brief is the layer that degrades, and the cost of a breach here is
// another agent's half-written file. HARNESS_SLICE is set by whoever spawned the worker, so this
// applies before the per-agent rules below and applies even on Codex, where the role is anonymous.
const sliceId = process.env.HARNESS_SLICE || null;
const sliceFeature = process.env.HARNESS_FEATURE || null;
if (sliceId) {
  if (!sliceFeature) {
    decide("deny", `HARNESS_SLICE=${sliceId} is set but HARNESS_FEATURE is not, so the slice's allowed ` +
      `paths cannot be looked up. Refusing rather than falling back to unconfined: an unlocatable ` +
      `slice plan is exactly when two parallel makers would start writing the same file.`);
  }
  const home = existsSync(path.join(root, "harness", "agents.manifest.json")) ? path.join(root, "harness") : root;
  let allowed = null;
  try {
    const plan = JSON.parse(readFileSync(path.join(home, "loop", "work-split", `${sliceFeature}.json`), "utf8"));
    if (plan?.validation?.status !== "valid") {
      decide("deny", `the work-split plan for ${sliceFeature} is not validated ` +
        `(${plan?.validation?.status || "unvalidated"}). Slices may not run against a plan whose ` +
        `disjointness nobody checked — run: node tools/work-split.mjs validate ${sliceFeature}`);
    }
    const slice = (plan.slices || []).find((s) => String(s.id) === String(sliceId));
    if (!slice) decide("deny", `no slice ${sliceId} in the work-split plan for ${sliceFeature}`);
    // Trace is append-only and per-event, so it is granted to every worker — but it lives inside
    // the harness home, which is a subdirectory on a contained layout and the repo root on a flat
    // one. Slice paths are always project-relative, so the grant has to be written the same way.
    const homeRel = path.relative(root, home).replaceAll("\\", "/");
    allowed = [...(slice.paths || []).map(String), homeRel ? `${homeRel}/trace/**` : "trace/**"];
  } catch (e) {
    decide("deny", `cannot read the work-split plan for ${sliceFeature} (${e.message}). A parallel ` +
      `worker with no readable plan has no confinement, and no confinement is how a fan-out ` +
      `becomes a merge conflict.`);
  }
  if (outside.length) {
    decide("deny", `slice ${sliceId} may only write inside the project; ${outside.join(", ")} is outside it.`);
  }
  const strays = rels.filter((r) => !allowed.some((g) => toRe(g).test(r) || r === g));
  if (strays.length) {
    decide("deny", `slice ${sliceId} of ${sliceFeature} may write ${allowed.join(", ")} and nothing else; ` +
      `${strays.join(", ")} ${strays.length > 1 ? "are" : "is"} outside it. Another maker is working in ` +
      `there right now, or it is shared state that the integrator writes once, afterwards. If your ` +
      `slice genuinely needs that file, the split was cut wrong — stop and record it with ` +
      `\`node tools/work-split.mjs fail ${sliceFeature} ${sliceId} --note "..."\`.`);
  }
  decide("allow", `${rels.join(", ")} ${rels.length > 1 ? "are" : "is"} inside slice ${sliceId}'s surface`);
}

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
// implying the check ran and found nothing. An EMPTY list is the same statement written a second
// way, and reading it as "allowed set = {}" turns an unrestricted role into a role that may write
// nothing at all — which is how a contained scaffold silently denied the maker every edit (HI-062).
// A role that may genuinely write nothing has no `write` tool, not an empty allowlist.
if (!agent || !agent.writes || !agent.writes.length) {
  decide("allow", `${agentName} has no write restriction in agents.manifest.json`);
}

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
