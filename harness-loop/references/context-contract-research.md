# Context contract between the orchestrator and worker agents

Research date: 2026-09-01. Scope: compare Claude Code, Codex, Augment/Pi, and DeepSeek Harness with this harness’s context channels to design an effective orchestrator-to-worker contract.

## Main finding

The systems converge on three principles: isolate context windows, load detail on demand rather than all at once, and use structured handoffs rather than unconstrained prose. This harness has rich resources, context packets, and shared memory, but its dispatch message is only one prose sentence. That is the bottleneck.

## External-system lessons

| System | Strength | Gap | Lesson for this harness |
|---|---|---|---|
| Claude Code | Isolated subagent context, YAML-configured resources, worktree isolation | Parent task message is free prose | Start workers clean with only role resources |
| Codex | AGENTS.md routing and progressive skill loading | No typed feature handoff | Keep routing documents short and load detail on demand |
| Augment/Pi | On-demand codebase queries through MCP, isolated workers | No required handoff schema | Query the codebase when needed instead of preloading it |
| DeepSeek Ralph | Size-bounded, schema-validated structured reports | No independent evaluator or rich feature state | Validate handoffs at both producer and consumer boundaries |

## Current harness channels

1. **Resources** from `agent-context.mjs` give a worker AGENTS.md, constraints, standards, and a feature digest. They are current at spawn but static by role.
2. **Context packets** carry objective, `mustRead`, facts, `mustNotRead`, and digested sources for difficult feature seams. They reduce rediscovery but do not carry checker feedback or diagnosis.
3. **Dispatch messages** currently carry only `next.why`. The worker must rediscover feature state, checker notes, baseline status, and session handoff.

## Proposed dispatch brief

Use a size-bounded, schema-validated JSON brief. Prose is rendering; structured data is the source of truth.

```json
{
  "schema": "dispatch-brief/1",
  "node": "maker",
  "feature": {"id": "f-03", "behavior": "...", "verification": "...", "falsifier": "..."},
  "checkerNotes": null,
  "diagnosis": null,
  "baseline": {"status": "green", "command": "./init.sh"},
  "recentChanges": ["5356819 Added baseline cache that reuses a green verdict between sessions"],
  "mustRead": ["docs/..."],
  "sessionContext": "The previous session completed f-01 and f-02; the maker is implementing f-03 on attempt 2."
}
```

### Invariants

| Field | Present when | Null when |
|---|---|---|
| `feature` | Node is maker/checker/test-designer | Node is harness-setup |
| `checkerNotes` | Feature has passed checker at least once | It has never reached checker |
| `diagnosis` | `checkerNotes` starts with a `NEEDS` marker | No marker exists |
| `baseline` | Always | Never |
| `recentChanges` | Always, at most five commits | Never |
| `mustRead` | Packet or non-obvious seam exists | Simple feature |
| `sessionContext` | A non-stale handoff exists | Handoff is empty or stale |

Validate the brief before dispatch and again in the worker. Limit the total brief to 8 KiB; trim `recentChanges`, then `sessionContext`, while retaining required fields.

## Implementation plan

1. Add `tools/dispatch-brief.mjs` to build and validate the JSON brief from `feature_list.json`, `session-handoff.md`, Git history, and baseline state.
2. Pass `JSON.stringify(brief)` through `run-loop.mjs`, retaining the old string only as a warned fallback.
3. Update worker prompts to validate and consume the brief; fall back to current discovery if it is missing or invalid.
4. Measure files read and tokens consumed before the first implementation step across at least five features.

The dispatch brief complements, rather than replaces, context packets: the brief describes current iteration state, while a packet provides domain knowledge and seam-specific sources.
