# Read/search telemetry: runtime facts and proposed contract

HI-029 exists because `trace/trace.jsonl` currently proves session boundaries, selected shell
commands, writes and explicit decisions, but not which code or documentation an agent inspected.
The Aeron A/B run therefore measured reads from agent-authored reports, not an independent sensor.
This note defines the smallest telemetry layer that can make duplicate discovery measurable without
storing source contents.

## What each runtime can actually expose

| Runtime | Reliable native signal | Important limit | Primary evidence |
|---|---|---|---|
| Claude Code | `PostToolUse` for `Read`, `Grep`, `Glob`, and `Bash`; hook input carries `session_id`, `tool_name`, `tool_input`, and tool response | A read performed inside `Bash` is only a command string. Shell syntax may hide several paths, pipes, substitutions, aliases, or a program that reads more files internally. | [Anthropic hooks reference](https://code.claude.com/docs/en/hooks), [hooks guide](https://code.claude.com/docs/en/hooks-guide) |
| Kiro CLI | `postToolUse` can match `fs_read`/`read`, the search tools, `execute_bash`, or `*`; payload carries session, tool name/input/response. Its documented read example includes the requested path. | Search payload shapes must be fixture-tested against the installed CLI. Shell has the same inference limit as Claude. Do not persist `tool_response`: it contains file contents. | [Kiro hooks](https://kiro.dev/docs/cli/hooks/), [built-in tools](https://kiro.dev/docs/cli/reference/built-in-tools/), [agent configuration](https://kiro.dev/docs/cli/custom-agents/configuration-reference/) |
| Codex CLI | `codex exec --json` is a JSONL event stream; shell command execution is observable. Current hooks declare `PreToolUse`/`PostToolUse`, but OpenAI's migration reference says those events currently run for shell commands only. | Native file reads/searches and `apply_patch` are not a portable hook boundary. A shell-only sensor cannot claim complete Read/Grep/Glob coverage. `codex exec` hook dispatch has also had version-specific gaps, so startup calibration is required. | [Codex exec JSONL source](https://github.com/openai/codex/blob/main/codex-rs/exec/src/cli.rs), [hook event source](https://github.com/openai/codex/blob/main/codex-rs/hooks/src/lib.rs), [OpenAI migration reference](https://github.com/openai/skills/blob/main/skills/.curated/migrate-to-codex/references/differences.md), local live findings in [runtimes.md](runtimes.md) |

The important distinction is **direct observation** versus **shell inference**. `Read(path)` is a
direct event. `Bash("sed ... path")` is evidence that a command was attempted/completed, but parsing
it into a read is best-effort. `mvn test` may read thousands of files internally and should remain a
shell event, not be expanded into fake file-read precision.

## Recommended architecture

Add one runtime-neutral append-only stream, `trace/tool-events.jsonl`. Runtime adapters normalize
hook/JSONL payloads before appending; analysis reads this stream but never raw transcripts.

```text
Claude PostToolUse ─┐
Kiro postToolUse ───┼─> telemetry adapter ─> tool-events.jsonl ─> context metrics/report
Codex exec JSONL ───┘          │
                               └─> startup calibration + coverage declaration
```

Use a versioned record such as:

```json
{
  "schema":"tool-event/1", "ts":"...", "runId":"...", "sessionIdHash":"...",
  "actor":"maker", "feature":"feat-gap-boundaries", "runtime":"claude",
  "runtimeVersion":"...", "phase":"completed", "tool":"read", "class":"file-read",
  "path":"src/main/java/.../RecordedEvent.java", "queryHash":null,
  "scope":"file", "success":true, "durationMs":null,
  "observation":"direct", "coverage":"native-complete", "bytes":null
}
```

Implementation boundaries:

1. `tools/telemetry.mjs` accepts hook JSON on stdin, identifies the runtime payload, strips results,
   normalizes paths relative to the target, hashes session IDs and search queries, and appends one
   event per operation. Reject paths outside the target or record only `external:<basename>`.
2. Generated Claude hooks match `Read|Grep|Glob|Bash`; Kiro hooks match `fs_read`, documented
   grep/glob canonical names confirmed by fixtures, and `execute_bash`. Codex dispatch captures its
   `--json` stream; hooks remain useful for shell but are not labelled native-complete.
3. `tools/telemetry-calibrate.mjs` runs one known read, grep, glob, and shell-read fixture after
   generation. It writes `trace/telemetry-capabilities.json` with runtime/version and observed
   event classes. A missing fixture downgrades coverage; it must not silently produce zero reads.
4. `run-report.mjs` derives metrics only inside a `(runId, actor, feature)` window. It reports both
   counts and coverage so a Codex zero never looks better than a Claude observed count.

Do not make the first release an enforcement gate. First calibrate on a fresh scaffold and the
Aeron target, then decide thresholds with real distributions as required by this repo's gate rule.

## Metrics that answer the actual question

- `directReads`: completed native file-read operations.
- `uniquePaths`: normalized unique paths read directly.
- `duplicateReadRate = 1 - uniquePaths / directReads`; report only when `directReads > 0`.
- `packetMustReadCoverage`: fraction of the active packet's `mustRead` files directly read.
- `packetEscapeReads`: direct reads outside `mustRead`, feature touches, active rules and required
  state files. This is a diagnostic, not automatically waste.
- `rediscoveryReads`: reads of packet `sourceInputs` that were not also `mustRead` while the packet
  was fresh. This measures reopening design sources the packet was intended to replace.
- `searches`, `repeatedQueryHashes`, and search scope (`file`, `directory`, `repository`).
- `progressPer100Reads`: feature state transitions or accepted evidence per 100 direct reads.
- `unobservedShellReads`: shell commands classified as possible reads. Keep this separate from
  direct counts; never add inferred and direct events into one denominator.

Compare A/B arms only when runtime, runtime version, feature/oracle, and telemetry coverage match.

## Privacy and budget contract

Persist allowlisted metadata only: timestamp, run/actor/feature, runtime/version, normalized relative
path, operation class, success, duration, observation/coverage, byte count if supplied, and a
salted query hash. Never persist file content, grep matches, shell stdout/stderr, prompts, responses,
full hook payloads, absolute home paths, environment values, tokens, or URLs with query strings.

Default budgets:

- maximum 2 KiB per normalized event and 20,000 events per run;
- rotate/archive at 10 MiB; retain detailed events for 14 days, aggregate metrics for 90 days;
- hash session IDs with a per-project salt; hash queries after whitespace normalization;
- if the event budget is exceeded, append one `telemetry-truncated` marker with dropped count;
- allow opt-out path globs for secrets and generated/vendor trees; record the exclusion count, not
  excluded names.

`trace.mjs` currently stores raw stdin up to 2,000 characters. Tool telemetry must not call that raw
path: a `PostToolUse` payload can contain the exact source text. The normalizer must be a separate
entry point or `trace.mjs` must gain an explicit redacted schema before any read hook is enabled.

## Known limits and interpretation

- “Read” means the runtime invoked a tool, not that the model understood or used the result.
- Re-reading after a file changed, compaction, handoff, failed search, or an ambiguous packet may be
  necessary. Metrics surface candidates; they do not prove waste.
- Shell parsing cannot be made complete portably. OS-level tracing (`execve`/`open`) would see
  subprocess reads but adds platform, privacy and sandbox complexity; reserve it for controlled
  evaluation labs, not the default harness.
- MCP tools need an allowlist of known read-only payload shapes. Unknown MCP calls remain
  `class:mcp`, not guessed reads.
- Failed or refused runtime turns require a completion/state-transition check independently of
  telemetry; a zero-event, exit-0 run is exactly HI-032's failure mode.

## Implemented first rollout

`tools/telemetry.mjs`, generated runtime hooks, `tools/telemetry-calibrate.mjs`, and the telemetry
section of `tools/run-report.mjs` now implement the first three rollout stages. Demo fixtures prove
duplicate-read aggregation and that source/query content is absent from the stored stream. Codex
remains explicitly `shell-incomplete`; Claude/Kiro remain `native-configured-needs-live-probe`
until a live probe observes their installed runtime's payloads. No threshold is an enforcement gate.

The remaining rollout is to collect calibrated distributions on real targets, then consider a
human-reviewed warning such as “fresh packet rediscovery above baseline.”
