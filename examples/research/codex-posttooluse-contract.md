# Codex `PostToolUse`: public contract and runtime caveats

**Verdict (2026-08-23):** Codex now documents `PostToolUse` publicly, but on
`learn.chatgpt.com`, not on `developers.openai.com`. The current contract is useful for
best-effort telemetry, but a telemetry sink failure must be handled by the hook itself if it should
not appear as `PostToolUse hook (failed)`.

Research scope: official OpenAI documentation, the first-party `openai/codex` repository, and
first-party GitHub issues only. Source inspection is pinned to `openai/codex` commit
[`c9b19de`](https://github.com/openai/codex/tree/c9b19deb09c1841ce7acc33ddb96276030936a29)
unless a release/issue is named.

## Documentation status

- Searches on `developers.openai.com` for `PostToolUse`, `hooks.json`, and hook matcher/schema
  documentation found no dedicated page there.
- The public OpenAI reference is [Hooks | ChatGPT Learn](https://learn.chatgpt.com/docs/hooks).
  It documents discovery, trust, matching, input/output, async hooks, and tool coverage. It warns
  that `main` schemas may be ahead of a released CLI; the docs page is the release-behavior
  reference, while generated schemas define the current repository wire format.
- Historical context: hooks started with `SessionStart`/`Stop` in CLI 0.114.0; tool-use hooks were
  requested in [#14754](https://github.com/openai/codex/issues/14754). Issue reports show important
  version gaps: missing long-running exec completion in
  [#16246](https://github.com/openai/codex/issues/16246), `codex exec` omissions in
  [#18607](https://github.com/openai/codex/issues/18607), user-hook discovery trouble in 0.133.0
  in [#24211](https://github.com/openai/codex/issues/24211), and an `apply_patch` regression in
  0.136.0 in [#26729](https://github.com/openai/codex/issues/26729). These are historical reports,
  not the contract of current `main`.

## Configuration, discovery, and trust

Minimal project hook:

```json
{
  "description": "Best-effort tool telemetry",
  "hooks": {
    "PostToolUse": [{
      "matcher": "Bash|apply_patch|mcp__.*",
      "hooks": [{
        "type": "command",
        "command": "node \"$(git rev-parse --show-toplevel)/tools/telemetry.mjs\"",
        "timeout": 10,
        "async": true
      }]
    }]
  }
}
```

- Codex loads `hooks.json` and inline `[hooks]` from active config layers. Common locations are
  `~/.codex/{hooks.json,config.toml}` and `<repo>/.codex/{hooks.json,config.toml}`; enabled plugins
  can contribute hooks too. Sources merge rather than replace each other. See official docs and
  [discovery.rs](https://github.com/openai/codex/blob/c9b19deb09c1841ce7acc33ddb96276030936a29/codex-rs/hooks/src/engine/discovery.rs#L83-L190).
- Project hooks load only for a trusted project. Every unmanaged command definition has a
  normalized hash. A new/changed hash is untrusted and skipped until reviewed; managed hooks are
  trusted automatically. `--dangerously-bypass-hook-trust` bypasses this check. See
  [discovery.rs#L625-L668](https://github.com/openai/codex/blob/c9b19deb09c1841ce7acc33ddb96276030936a29/codex-rs/hooks/src/engine/discovery.rs#L625-L668).
- `hooks` is the current feature flag; `codex_hooks` is a deprecated alias. Hooks are enabled by
  default according to the current docs.
- JSON shape is `{"description"?: string, "hooks": {...}}`. A matcher group has optional
  `matcher` plus `hooks[]`. A command handler accepts `command`, optional `commandWindows`,
  `timeout` (seconds), `async`, `statusMessage`, and `additionalContextLimit`; unknown top-level
  `HooksFile` fields are denied. See
  [hook_config.rs](https://github.com/openai/codex/blob/c9b19deb09c1841ce7acc33ddb96276030936a29/codex-rs/config/src/hook_config.rs#L9-L16)
  and [handler schema](https://github.com/openai/codex/blob/c9b19deb09c1841ce7acc33ddb96276030936a29/codex-rs/config/src/hook_config.rs#L131-L177).

## Matcher semantics and tool coverage

- Omitted matcher, `""`, or `"*"` matches all. A string containing only alphanumerics, `_`, and
  `|` is an exact-name alternatives list. Other valid strings are Rust regexes matched against the
  tool name. Invalid regexes are rejected during discovery. See
  [common.rs#L103-L159](https://github.com/openai/codex/blob/c9b19deb09c1841ce7acc33ddb96276030936a29/codex-rs/hooks/src/events/common.rs#L103-L159).
- Matching considers the canonical tool name and compatibility aliases but invokes each handler
  only once. Hook stdin always carries the canonical name.
- Shell and unified exec match as `Bash`. `apply_patch` matches `apply_patch`, `Edit`, or `Write`,
  but stdin says `"tool_name":"apply_patch"`; see
  [hook_names.rs](https://github.com/openai/codex/blob/c9b19deb09c1841ce7acc33ddb96276030936a29/codex-rs/core/src/tools/hook_names.rs#L20-L45).
  MCP tools use flattened names such as `mcp__filesystem__read_file`. Most local function tools can
  participate, but participation depends on the handler/output exposing a post-use payload.
- Current code explicitly implements `apply_patch` post-use payloads; see
  [apply_patch.rs](https://github.com/openai/codex/blob/c9b19deb09c1841ce7acc33ddb96276030936a29/codex-rs/core/src/tools/handlers/apply_patch.rs).
  A unified exec command may emit its `PostToolUse` only when a later `write_stdin` poll observes
  completion. The official docs now state this behavior; older versions had the gap in #16246.
- Runtime source says hooks run after a tool produces an output. Bash non-zero process exits still
  produce output and are covered; a tool handler error that returns before an output/payload exists
  need not produce `PostToolUse`. See
  [registry.rs](https://github.com/openai/codex/blob/c9b19deb09c1841ce7acc33ddb96276030936a29/codex-rs/core/src/tools/registry.rs).

## Exact stdin wire format

One JSON object is written to stdin, with no contract that it is newline-terminated:

```json
{
  "session_id": "uuid",
  "turn_id": "turn id",
  "agent_id": "optional subagent id",
  "agent_type": "optional subagent type",
  "transcript_path": "/path/or/null",
  "cwd": "/session/cwd",
  "hook_event_name": "PostToolUse",
  "model": "model-slug",
  "permission_mode": "default|acceptEdits|plan|dontAsk|bypassPermissions",
  "tool_name": "Bash|apply_patch|mcp__server__tool|...",
  "tool_input": {},
  "tool_response": {},
  "tool_use_id": "call id"
}
```

All fields except `agent_id` and `agent_type` are required; `transcript_path` is required but may be
null. `tool_input` and `tool_response` accept any JSON value. The generated schema is
[post-tool-use.command.input.schema.json](https://github.com/openai/codex/blob/c9b19deb09c1841ce7acc33ddb96276030936a29/codex-rs/hooks/schema/generated/post-tool-use.command.input.schema.json).
`transcript_path` is convenient but explicitly not a stable transcript-format API.

## Stdout, stderr, and exit status

Accepted exit-0 JSON is defined by
[the output schema](https://github.com/openai/codex/blob/c9b19deb09c1841ce7acc33ddb96276030936a29/codex-rs/hooks/schema/generated/post-tool-use.command.output.schema.json):

```json
{
  "continue": true,
  "decision": "block",
  "reason": "model-visible feedback",
  "stopReason": "stop text",
  "systemMessage": "UI warning",
  "suppressOutput": false,
  "hookSpecificOutput": {
    "hookEventName": "PostToolUse",
    "additionalContext": "developer context",
    "updatedMCPToolOutput": null
  }
}
```

- All fields are optional in the outer object. Unknown fields are rejected. Plain stdout is ignored.
  JSON-looking but invalid stdout marks the hook failed.
- Empty stdout + exit 0 is a quiet success. For telemetry this is the safest success response.
- `decision:"block"` or exit 2 with non-empty stderr blocks normal consumption of the already-run
  tool result and feeds the reason back to the model; it cannot undo side effects. Exit 2 without
  stderr is a hook failure.
- `continue:false` stops normal processing and substitutes hook feedback/stop text. `systemMessage`
  becomes a warning. `hookSpecificOutput.additionalContext` adds model-visible developer context.
- `updatedMCPToolOutput` and `suppressOutput` are parsed but unsupported: synchronous use marks the
  hook failed and normal tool processing continues. Output replacement/redaction is therefore not
  a safe current use case; see first-party reports
  [#31015](https://github.com/openai/codex/issues/31015) and
  [#34895](https://github.com/openai/codex/issues/34895).
- Any exit other than 0 or the special synchronous 2 is failed. For ordinary failures, stderr is
  captured but the current parser reports the generic `hook exited with code N`; spawn/write/wait/
  timeout errors become explicit hook errors. Exact behavior is in
  [post_tool_use.rs#L156-L276](https://github.com/openai/codex/blob/c9b19deb09c1841ce7acc33ddb96276030936a29/codex-rs/hooks/src/events/post_tool_use.rs#L156-L276).

## Synchrony, concurrency, timeout, cwd, environment, sandbox

- Sync is default. Codex waits for the hook. All matching sync handlers launch concurrently, then
  Codex gathers results in configured order. One cannot prevent another from starting; see
  [dispatcher.rs#L92-L174](https://github.com/openai/codex/blob/c9b19deb09c1841ce7acc33ddb96276030936a29/codex-rs/hooks/src/engine/dispatcher.rs#L92-L174).
- `"async":true` schedules background execution (bounded to eight concurrent async hooks per
  session in current source) and Codex continues. Async hooks can later supply supported context or
  warnings, but cannot block, approve, rewrite, or otherwise control the triggering operation.
  Pending async hooks are aborted at session shutdown. See
  [command_runner.rs#L41-L174](https://github.com/openai/codex/blob/c9b19deb09c1841ce7acc33ddb96276030936a29/codex-rs/hooks/src/engine/command_runner.rs#L41-L174).
- Default timeout is 600 seconds, minimum 1 second. The public JSON key is `timeout`; `timeout_sec`
  is only the Rust field name. Issue
  [#35382](https://github.com/openai/codex/issues/35382) documents confusion about this.
- A known current risk: stdin is written before the wait timeout begins. A hook that does not read a
  payload larger than the pipe buffer can hang outside the configured timeout; see
  [#27550](https://github.com/openai/codex/issues/27550) and
  [command_runner.rs#L248-L266](https://github.com/openai/codex/blob/c9b19deb09c1841ce7acc33ddb96276030936a29/codex-rs/hooks/src/engine/command_runner.rs#L248-L266).
- Command hooks run via the configured/default shell (`$SHELL -lc` on Unix), with session `cwd`.
  The runner clears the live environment, replays the session-start environment snapshot, adds
  plugin variables when applicable, and scrubs non-inheritable variables; see
  [command_runner.rs#L365-L424](https://github.com/openai/codex/blob/c9b19deb09c1841ce7acc33ddb96276030936a29/codex-rs/hooks/src/engine/command_runner.rs#L365-L424).
- The hook runner directly spawns the command; it does not invoke Codex's tool sandbox wrapper.
  However, this is not a promise of unrestricted access: process-level/host app/container sandbox
  restrictions inherited by Codex can still constrain the child. Neither the official hook page nor
  the hook runner promises that an arbitrary path is writable. Therefore `EPERM` must be treated as
  a real deployment condition, not as proof that hook discovery or JSON parsing failed.

## `codex exec` and version compatibility

The current official hook page does not carve non-interactive `codex exec` out of hook support, and
current core code shares hook runtime paths. Nevertheless, first-party issue #18607 reported that
an older non-interactive build fired `UserPromptSubmit` but not `PostToolUse`/Stop. Do not infer
support solely from config parsing: calibrate against the exact shipped CLI with a real tool call.

For every supported version, run a startup probe that records: CLI version, hook discovery/trust,
one short `Bash` completion, one unified-exec completion via polling, one `apply_patch`, and one
intentional sink-write denial. Treat the docs page as released behavior and pin source/schema claims
to the corresponding release tag when deploying; `main` can be ahead.

## Implication for this harness telemetry hook

The observed `EPERM` while appending `trace/tool-events.jsonl` means the hook command ran, parsed its
stdin, reached its sink, then exited non-zero. Codex correctly renders that as a failed hook. For a
pure observer, the robust contract is:

1. Read stdin fully and bound parsing/storage size.
2. Attempt the durable repo sink.
3. On sink `EPERM`/`EACCES`/read-only failure, emit a concise diagnostic to a separately observable
   channel if available, increment an in-memory/degraded marker if possible, and **exit 0 with empty
   stdout**. Do not return blocking JSON or exit 2.
4. Do not silently write authoritative telemetry to `/tmp`; that changes durability and provenance.
5. Calibrate adapter and sink separately: `payload/schema: pass`, `sink: writable|degraded`.
6. Prefer `async:true` for non-policy telemetry so sink latency cannot hold the tool loop, while
   accepting that shutdown may abort an unfinished event. If losslessness is required, use sync but
   still fail open on observational sink errors.

This is deliberate fail-open behavior in the telemetry script, not a Codex setting: Codex has no
output shape meaning “record this hook as degraded but successful.” Exit 0 with no stdout is the
only quiet-success signal in the current `PostToolUse` contract.
