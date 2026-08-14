# Three runtimes, one manifest

The harness runs on **kiro-cli**, **Claude Code** and **Codex CLI**. Their agent configs express the
same five things in different shapes, so `agents.manifest.json` is the source and every format is
generated:

```bash
node tools/gen-agents.mjs --target . --runtime kiro|claude|codex|both|all   # setup defaults to all
node tools/gen-agents.mjs --target . --runtime kiro,codex                   # or a comma list
node tools/gen-agents.mjs --target . --check                                # CI / the gate
```

`both` still means kiro+claude, so targets scaffolded before Codex existed generate exactly what they
generated before. Setup defaults to `all`: the files are small, and which CLI the next person has is
not knowable from here — generating only the one on *this* machine is how a repo arrives somewhere
else with no usable agents at all.

Never hand-edit a generated agent file. The edit is lost on the next generation, and until then the
runtimes disagree while all of them still start cleanly — the same invisible failure class as a
broken `file://` URI. `verify-harness.mjs` reports `agent-generated-stale`.

> **A generation bug worth knowing about, because it was latent for two runtimes and only a third
> exposed it.** The cleanup pass deletes generated files for agents the manifest no longer declares,
> and it tested that as "declared, but not in the set I am generating". So `--runtime kiro` deleted
> every Claude agent, and `--runtime both` deleted every Codex one. Fixed: the sweep now only touches
> directories belonging to runtimes actually being generated. An unrecognised `--runtime` used to hit
> the same path with an empty set and wipe *everything*; it is now refused with exit 2.

## The mapping

| Concept | kiro | Claude Code | Codex CLI |
|---|---|---|---|
| file | `.kiro/agents/<n>.json` | `.claude/agents/<n>.md` | `.codex/agents/<n>.toml` |
| system prompt | `prompt: file://../../<path>` | the `.md` body (inlined) | `developer_instructions` (inlined) |
| auto-loaded per-agent context | `resources: [file://…]` | `SubagentStart` → `additionalContext` | listed in the instructions; inlined at dispatch by `tools/codex-dispatch.mjs` |
| per-agent write limits | `toolsSettings.write.allowedPaths` | `PreToolUse` → deny, per-agent in frontmatter | `PreToolUse` in `.codex/hooks.json`, **project-wide** + `HARNESS_AGENT` |
| coarse sandbox | — | — | `sandbox_mode = "read-only" \| "workspace-write"` |
| lifecycle tracing | `hooks.agentSpawn` / `stop` | `hooks.SubagentStart` / `SubagentStop` | `hooks.SessionStart` / `Stop` |
| welcome message | `welcomeMessage` | no field — first line of the body | no field — first line of the instructions |
| MCP config | `.kiro/settings/mcp.json` | `.mcp.json` | `[mcp_servers.x]` in `.codex/config.toml` |
| headless invocation | `kiro-cli chat --agent X --no-interactive --trust-all-tools` | `claude -p "…" --agent X --dangerously-skip-permissions` | **no `--agent` flag exists** — `node tools/codex-dispatch.mjs X "…"` |

`loop/run-loop.sh` picks the runtime from `HARNESS_RUNTIME`, or detects it from which agent
directory exists and which CLI is installed, and routes everything through one `dispatch()`.

## The two places kiro and Claude Code genuinely differ

**1. Per-agent context has no field in Claude Code.** A subagent gets its system prompt plus
`CLAUDE.md`, and `CLAUDE.md` is one file shared by every agent. Losing per-role context would undo a
deliberate design — the checker and the maker are meant to arrive knowing different things, and
`context-budget.mjs` exists to keep each of those small (`llm-failure-modes.md`).

A `SubagentStart` hook can inject text as `additionalContext`, so `tools/agent-context.mjs` reads
the agent's resource list from the manifest and injects the files at spawn. This is **better than
kiro's version in one respect**: kiro loads a static list written at scaffold time, this reads the
files when the agent starts. A resource that changed is current, and a resource that was deleted is
reported instead of silently missing.

**2. Per-agent write restriction has no field either.** `Edit(path)` permission rules exist but live
in `settings.json` and apply to the whole session, so they cannot give one agent a narrower surface
than another. That matters more than it sounds: the checker being unable to write source is what
makes *"the maker never grades itself"* a property of the configuration rather than a line in a
prompt, and prompts are the layer that degrades.

A `PreToolUse` hook declared in the subagent's own frontmatter fires only for that subagent and can
deny, so `tools/guard-write.mjs` matches the target path against the manifest's `writes` list.

> **Trap.** Claude Code consults `Edit(path)` rules only. A `Write(docs/**)` rule in `settings.json`
> is accepted and never applied — it warns at startup and otherwise does nothing. Use `Edit(...)`,
> which covers every file-editing tool. This is why the harness uses a hook rather than a settings
> rule even for the session-wide case.

## Codex: three differences, and why each one bites

Everything below was established by running `codex 0.147.0`, not by reading its documentation. The
good news first: Codex's hook contract is shaped like Claude Code's — `PreToolUse`,
`hookSpecificOutput.permissionDecision: "deny"`, snake_case payload — and a deny genuinely blocks the
write. Confirmed by dispatching a real `checker` and watching it be refused. The differences are
about *getting* to that point.

**1. `codex exec` has no `--agent` flag, so a role cannot be selected — it has to be assembled.**
That is `tools/codex-dispatch.mjs`: it reads the manifest, puts the role's prompt on stdin (`codex
exec -` reads instructions from stdin, which sidesteps both TOML-escaping a markdown file through
`-c developer_instructions=…` and the argv length limit), and appends the task. For the role's
context it *calls `tools/agent-context.mjs`* — the same script Claude Code's `SubagentStart` hook
calls — so both runtimes load exactly the same files. Two implementations of "what does this role get
to see" is two things to drift.

`.codex/agents/*.toml` is still generated, for interactive use and for a parent session delegating to
a subagent. It is not what the headless loop uses, and it cannot be: nothing headless can load it.

**2. Agent TOML has no hooks field, so write confinement cannot live with the agent.** Hooks are
project-wide in `.codex/hooks.json`, which means the hook must be *told* which role is running.
Verified that environment variables propagate from the codex process into hook subprocesses, so
`codex-dispatch.mjs` exports `HARNESS_AGENT` and `guard-write.mjs --from-env` reads it.

The honest limit: **outside `codex-dispatch.mjs` there is no role identity, so per-path confinement
is not enforced.** An interactively-spawned Codex agent runs unconfined. `guard-write.mjs` allows the
write in that case and says so in the reason — `NO ROLE IDENTIFIED` — rather than implying a check
ran. Where the rule *can* be carried by Codex itself it is: a role whose tools include no write gets
`sandbox_mode = "read-only"`, which the runtime enforces without any hook. That covers less than the
hook does, because `sandbox_mode` is directory-granular while a `writes` list is glob-granular.

**3. Hooks require persisted trust, and an untrusted hook is skipped *silently*.** No error, no
prompt, no non-zero exit — just no hooks, and therefore no confinement, while every role still
behaves plausibly because its prompt tells it to. So `codex-dispatch.mjs` passes
`--dangerously-bypass-hook-trust` by default. That flag is exactly as alarming as it sounds and the
justification is narrow: the hooks it is bypassing trust for are **generated by this harness into
this repo** and consist of one call to `tools/guard-write.mjs`. If you would rather trust them
interactively once, do that and set `HARNESS_CODEX_HOOK_TRUSTED=1`.

> **The sandbox blocks listening — the trap that costs a day.** Measured with `codex sandbox` on
> 0.147.0: under `workspace-write`, binding a socket fails with `EPERM`, while outbound traffic is
> fine (DNS resolves). `sandbox_workspace_write.network_access=true` does **not** change it; only
> `danger-full-access` allows a bind. So on any project whose tests stand up a server — Aeron,
> testcontainers, an embedded broker, a dev server — **the baseline is red inside codex and green
> outside it**. Found on aeron-demo: the agent reported `java.net.SocketException: Operation not
> permitted`, 14 tests erroring, and a red baseline. It was right, honest, and about the sandbox —
> nothing was wrong with the project, which passes in 23 seconds outside it. Two dispatched
> sessions produced nothing before this was understood. `tools/codex-dispatch.mjs` now probes for it
> and says so in one line; `HARNESS_CODEX_SANDBOX=danger-full-access` is the lever, named after what
> it actually does.

> **The `$comment` trap, shipped and caught by running it.** `.codex/hooks.json` accepts exactly two
> keys: `description` and `hooks`. A `$comment` key — harmless in every other config this harness
> writes — makes Codex reject **the whole file**, print one warning line to stderr, and run with no
> hooks at all. The first live test still looked like a success: the checker was asked to write
> `src/Sneak.java`, and it refused. It refused because its *prompt* said to, with nothing enforcing
> anything. That is the exact difference this harness exists to make mechanical, and it took reading
> codex's stderr to see it. Gate: `codex-hooks-invalid` (blocker).

## Claude Code capabilities the harness deliberately does not use

| Field | Why not |
|---|---|
| `maxTurns` | A runtime-level turn budget would duplicate `attempts`/`maxAttempts`, which already works on both runtimes and is visible in `feature_list.json` where a human reviews it |
| `isolation: worktree` | WIP=1 makes parallel agents a non-goal, and P08 measured the trade: parallelism buys latency and pays throughput (`p08-parallel-record.md`) |
| `memory: project` | The harness has its own `memory/<agent>/` with `memory-query.mjs`, `memory-consolidate.mjs` and a gate. Adopting Claude Code's would create a second store kiro cannot read |

## Model per role

Set in the manifest, per runtime, and generated into both configs:

| Role kind | Claude Code | kiro | Codex |
|---|---|---|---|
| **executors** — maker, designer, feature-planner, test-designer, test-implementer, context-interviewer, harness-setup, k8s-integration-tester | `sonnet` | `claude-sonnet-4` — **pinned, not `auto`** | `gpt-5.6-sol` |
| **evaluators** — checker, design-reviewer | `claude-opus-5` | `claude-sonnet-4.5` | `gpt-5.6-terra`, `model_reasoning_effort = "high"` |

Codex executors are on `gpt-5.6-sol` — the documented default — rather than on something cheaper,
because `codex debug models` lists `sol`/`terra`/`luna` with no cost or capability ordering and a
wrong guess would silently downgrade a role. Evaluators use the configuration OpenAI's own reviewer
example uses.

The split follows the same line as generator/evaluator separation: catching what a cheaper model
got wrong *is* the evaluator's whole job, so that is where the strong model earns its cost.

**The runtimes are not equal here, and the manifest says so rather than pretending.** kiro offers no
Opus on this account — `kiro-cli chat --list-models` tops out at `claude-sonnet-4.5` — so a kiro
checker is a weaker evaluator than a Claude Code checker. If that matters for a given project, run
the checking half on Claude Code.

## Why both, and not just the better one

Keeping two runtimes looked like optional generality until it was load-bearing. Inside one working
session on 2026-08-12, kiro produced two hard stops:

- **The default model went away mid-run.** `auto` returned "temporarily unavailable" while the maker
  was part-way through a fix. It had completed the change and died before committing — recoverable
  only because the work was on disk. Pinning kiro's executors to a named model instead of `auto`
  would have avoided it, so they are now pinned to `claude-sonnet-4`. `auto` is a router, not a
  model, and a router can route to nothing.
- **The monthly request quota ran out.** `Monthly request limit reached … limits reset on 09/01`,
  three weeks away. That is not a retry-and-continue failure; it ends the runtime for the period.

Both were survivable because the same agents exist for Claude Code, generated from the same
manifest, and `HARNESS_RUNTIME=claude` resumes the loop where it stopped. A single-runtime harness
would have stopped the project until September.

The general point: a runtime is a dependency with an availability budget, not a constant. The
manifest costs almost nothing to carry and converts an outage into a flag.

## Verified, not assumed

Every row above was checked by running it, because the failure mode here is silence — a
misconfigured agent starts anyway, as something other than what you configured.

- `claude -p "…" --agent <name>` with a `.claude/agents/<name>.md` → ran, correct system prompt
- `@file` in an agent body → **does not** load (answered `ABSENT`); `CLAUDE.md` **does**
- `SubagentStart` + `additionalContext` → 24 KB of resources injected for `checker`
- `guard-write.mjs` → `allow` for `feature_list.json`, `deny` for `src/Foo.java`, `allow` for the
  unrestricted `maker`
- generated kiro configs → key-by-key identical to the hand-written ones they replaced
- `kiro-cli chat --list-models` → no Opus available; `kiro-cli agent validate` accepts an invalid
  model name silently (exit 0), so a typo there is another failure that does not announce itself
- `claude mcp add --scope project` → wrote `.mcp.json` as `{mcpServers:{name:{type:"stdio",…}}}`,
  which is where the generated Claude MCP shape comes from
- **Codex**, all on 0.147.0: `codex exec --help` has no `--agent` flag · a `PreToolUse` hook returning
  `permissionDecision: "deny"` blocked a real `apply_patch` and the agent reported the refusal ·
  `tool_input` for `apply_patch` carries a patch envelope and **no `file_path`** · hooks did not fire
  at all without `--dangerously-bypass-hook-trust`, and `projects.<path>.trust_level = "trusted"` did
  not substitute for it · env vars set on the codex process **do** reach hook subprocesses ·
  `-c developer_instructions="…"` genuinely overrides behaviour · every generated agent TOML parses
  (`tomllib`) · `$comment` in `hooks.json` silently disabled every hook
