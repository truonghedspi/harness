# Kiro Loop Runtime — how the pieces wire together

This scaffold targets **Kiro (kiro-cli)**. Here is how the generated files form a running
maker–checker loop, and where to change things.

## Files at a glance

```
AGENTS.md                 entry/router: startup workflow, invariants, DoD, exit checklist
feature_list.json         external state: features with behavior+verification+state+evidence
init.sh                   baseline gate, run at every session start/end (Lesson 6/9/12)
progress.md               session continuity log (Lesson 5)
DECISIONS.md              decision log: decision + reason + rejected alternative (Lesson 5)
session-handoff.md        mid-task / escalation handoff (Lesson 12)
docs/                     topic docs (Lesson 3/4/10): architecture, constraints,
                          testing-standards, definition-of-done
tools/trace.mjs           append-only trace → trace/trace.jsonl (Lesson 11)
trace/                    created on first init.sh / trace call
loop/goal.md              goal + iteration contract + gates + stop conditions (Lesson 13)
loop/maker-prompt.md      maker instructions
loop/checker-prompt.md    checker instructions (falsify, don't confirm)
loop/run-loop.sh          headless maker→checker→init.sh loop via kiro-cli
.kiro/agents/*.json       custom agents: harness-setup, maker, checker
.kiro/settings/mcp.json   MCP connectors (fill placeholders)
.kiro/steering/           optional auto-loading steering docs
check-coverage.mjs        copied in; proves all 13 lessons covered
```

## The agent JSON contract

Each `.kiro/agents/<name>.json` defines one custom agent:

- `prompt`: `file://./loop/<name>-prompt.md` — the agent's instructions.
- `tools`: capabilities it *may* use (`read`, `write`, `shell`, `*` for MCP).
- `allowedTools`: subset auto-trusted without confirmation (keep this to `read`).
- `toolsSettings.write.allowedPaths`: **write restriction** — the checker is limited to state
  files (`feature_list.json`, `progress.md`, `session-handoff.md`, `trace/**`) so it cannot
  rewrite the maker's implementation and pass its own work. This is generator/evaluator
  separation enforced by configuration, not just prompt.
- `includeMcpJson`: pulls in `.kiro/settings/mcp.json` connectors.
- `resources`: `file://` docs auto-loaded into context (AGENTS.md, goal.md, feature_list.json…).
- `hooks`: shell commands on lifecycle events — this is where **observability** (Lesson 11) lives:
  - `agentSpawn`: emit a trace `session-start` and run `./init.sh` (baseline gate before work).
  - `postToolUse` (maker): trace each `execute_bash` / `fs_write`.
  - `stop`: emit `session-end`.

## The loop, step by step

1. `run-loop.sh N` (or a scheduled invocation) is the **automation** (heartbeat).
2. Each iteration spawns the **maker** (`kiro-cli chat --agent maker`). On spawn its hook runs
   `./init.sh`; if red, the maker's whole job is repairing the baseline. Otherwise it picks the
   single highest-priority eligible feature, advances it by one step, records honest evidence in
   `feature_list.json`, and sets `readyForCheck: true`. It cannot set `done`.
3. The iteration then spawns the **checker** (`--agent checker`). It re-runs each ready feature's
   evidence, tries to falsify it, and either APPROVES (sets `status: done`) or REJECTS (writes
   `checkerNotes`, sets `status: in-progress`).
4. `run-loop.sh` runs `./init.sh` after the iteration; a red baseline stops the loop.
5. Loop stops when `goal.md`'s stopping condition holds, a stop condition fires, or `N`
   iterations elapse. Escalations land in `session-handoff.md`.

## Running it

### Global user skills

Copying a skill into a global skills directory does not by itself prove that Kiro will invoke it.
`install-user-skill.mjs` therefore also writes
`$KIRO_HOME/steering/harness-skill-<name>.md` (default `~/.kiro/steering/`) with
`inclusion: always`. This thin bridge points to the installed `SKILL.md` and states its trigger;
the complete workflow stays in the skill. Use `--steering-only` to add the bridge for an existing
installation, `--no-kiro-steering` for another runtime, and `--kiro-home DIR` in isolated tests.

Kiro custom agents inherit default resources unless that inheritance is explicitly disabled. An
agent configured to disable default-resource inheritance will also opt out of these global steering
bridges and must include the resource explicitly.

```bash
# Local, interactive (Level 1 — one maker run):
kiro-cli chat --agent maker

# Local, then check:
kiro-cli chat --agent checker

# Headless loop (Level 3 — needs KIRO_API_KEY):
loop/run-loop.sh 5
```

`run-loop.sh` uses `--trust-all-tools` for headless auth; that is safe only because the agent
JSON + AGENTS.md invariants bound what each agent may do (checker write-restricted, MCP
read-only). Tighten to `--trust-tools=read,write,shell` if policy requires.

## Adapting to another runtime

The concepts are portable. If the target uses Claude Code or Codex instead of Kiro:

- Agent JSON → sub-agent definitions / `--worktree` isolation.
- `run-loop.sh` → `/loop` (in-session) or `/goal` (goal-based) or cron / GitHub Actions.
- `hooks` → the runtime's hook system.
- `mcp.json` → that runtime's MCP config.

The harness artifacts (Floors 1–2 files) are runtime-agnostic — only the loop *driver* changes.
Regenerate with `--agent-file CLAUDE.md` and adjust `loop/run-loop.sh` accordingly.
