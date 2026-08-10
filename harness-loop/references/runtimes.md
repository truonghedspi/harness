# Two runtimes, one manifest

The harness runs on **kiro-cli** and on **Claude Code**. Their agent configs express the same five
things in different shapes, so `agents.manifest.json` is the source and both formats are generated:

```bash
node tools/gen-agents.mjs --target . --runtime kiro|claude|both     # both is the default
node tools/gen-agents.mjs --target . --check                        # CI / the gate
```

Never hand-edit a generated agent file. The edit is lost on the next generation, and until then the
two runtimes disagree while both still start cleanly — the same invisible failure class as a broken
`file://` URI. `verify-harness.mjs` reports `agent-generated-stale`.

## The mapping

| Concept | kiro | Claude Code |
|---|---|---|
| system prompt | `prompt: file://../../<path>` | the `.md` body (inlined at generation) |
| auto-loaded per-agent context | `resources: [file://…]` | `SubagentStart` hook → `additionalContext` (`tools/agent-context.mjs`) |
| per-agent write limits | `toolsSettings.write.allowedPaths` | `PreToolUse` hook → `permissionDecision: deny` (`tools/guard-write.mjs`) |
| lifecycle tracing | `hooks.agentSpawn` / `stop` | `hooks.SubagentStart` / `SubagentStop`, both in frontmatter |
| welcome message | `welcomeMessage` | no field — generated as the first line of the body |
| headless invocation | `kiro-cli chat --agent X --no-interactive --trust-all-tools` | `claude -p "…" --agent X --dangerously-skip-permissions` |

`loop/run-loop.sh` picks the runtime from `HARNESS_RUNTIME`, or detects it from which agent
directory exists and which CLI is installed, and routes everything through one `dispatch()`.

## The two places they genuinely differ

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

## Claude Code capabilities the harness deliberately does not use

| Field | Why not |
|---|---|
| `maxTurns` | A runtime-level turn budget would duplicate `attempts`/`maxAttempts`, which already works on both runtimes and is visible in `feature_list.json` where a human reviews it |
| `isolation: worktree` | WIP=1 makes parallel agents a non-goal, and P08 measured the trade: parallelism buys latency and pays throughput (`p08-parallel-record.md`) |
| `memory: project` | The harness has its own `memory/<agent>/` with `memory-query.mjs`, `memory-consolidate.mjs` and a gate. Adopting Claude Code's would create a second store kiro cannot read |
| `model` / `effort` per agent | Left to the operator: the right model per role is a cost decision that belongs to whoever pays for the run, not to a scaffold |

## Verified, not assumed

Every row above was checked by running it, because the failure mode here is silence — a
misconfigured agent starts anyway, as something other than what you configured.

- `claude -p "…" --agent <name>` with a `.claude/agents/<name>.md` → ran, correct system prompt
- `@file` in an agent body → **does not** load (answered `ABSENT`); `CLAUDE.md` **does**
- `SubagentStart` + `additionalContext` → 24 KB of resources injected for `checker`
- `guard-write.mjs` → `allow` for `feature_list.json`, `deny` for `src/Foo.java`, `allow` for the
  unrestricted `maker`
- generated kiro configs → key-by-key identical to the hand-written ones they replaced
