# Session Handoff — Harness

Written mid-feature or on escalation (Lesson 12), so the next session — or the loop's next
iteration — can resume without an information cliff.

## Current Objective

- Goal: simplify the canonical agent roster.
- Current status: human decisions are recorded; the canonical roster, routing and workflow diagrams are in progress. The demo fixture migration is still outstanding.
- Branch / commit: main (uncommitted work present).

## Completed This Session

- [x] Recorded that `maker` and `checker` remain separate roles in the simplified workflow.
- [x] Assigned planning/design to `orchestrator` and Kubernetes integration proof to `test-agent`.
- [x] Updated the canonical workflow diagrams to draw the five-agent roster and test-agent phases.
- [x] Added the interaction/contract diagram and a durable handoff-contract table.
- [x] Upgraded the dogfood graph from canonical source.

## Verification Evidence

| Check | Command | Result | Notes |
|---|---|---|---|
| Diagram coverage | `node harness-loop/scripts/check-workflow-diagram.mjs` | pass | All five manifest agents, router nodes and layers are drawn. |
| Interaction diagram | `xmllint --noout .../agent-interaction-contracts.svg` + Sharp render | pass | SVG is valid; PNG preview is 1680×1040 and was visually inspected. |
| Target upgrade | `node harness-loop/scripts/upgrade-harness.mjs --target .` | pass | Refreshed `docs/reference/graph.md`; customized target files remain explicitly drifted. |
| Generated configs | `node tools/gen-agents.mjs --target . --runtime all --check` | pass | 16 generated runtime files match the manifest. |
| Upgrade context | `node harness-loop/scripts/check-upgrade-context.mjs --target .` | pass | Roster/passing-handoff upgrade context is valid. |
| Target verifier | `node tools/verify-harness.mjs --target . --skip-baseline` | blocked | 4 pre-existing project blockers; workflow-diagram harness finding is gone. |

## Files Changed

- `harness-loop/references/workflow-{onboarding,development,improvement}.md`
- `harness-loop/references/graph.md`
- `harness-loop/references/diagram/five-agent-workflow.{svg,png}`
- `harness-loop/references/diagram/agent-interaction-contracts.{svg,png}`
- dogfood `docs/reference/graph.md` refreshed by upgrade

## Decisions Made (also log in DECISIONS.md)

```json
{
  "questionId": "agent-roster-maker-checker",
  "question": "Whether maker and checker remain after simplifying the agent roster",
  "answer": "maker and checker still must remain",
  "answeredBy": "human",
  "answeredAt": "2026-09-02T12:24:00+07:00",
  "scope": ["agents.manifest.json", "loop/route.mjs", "generated runtime agents"],
  "basis": [{"kind": "human", "pointer": "conversation: user message 'maker and checker must remain'"}],
  "supersedes": null,
  "openFollowUps": []
}
```

```json
{
  "questionId": "agent-roster-planning-k8s",
  "question": "Whether the reduced roster assigns planning to orchestrator and Kubernetes integration proof to test-agent",
  "answer": "yes",
  "answeredBy": "human",
  "answeredAt": "2026-09-02T12:26:00+07:00",
  "scope": ["orchestrator", "test-agent", "loop/route.mjs", "agents.manifest.json"],
  "basis": [{"kind": "human", "pointer": "conversation: user message 'yes'"}],
  "supersedes": null,
  "openFollowUps": []
}
```

## Blockers / Risks / Human Checkpoints Hit

- None.

## Next Session Startup

1. Read `AGENTS.md`.
2. Read `feature_list.json` and `progress.md`.
3. Review this handoff.
4. Run `./init.sh` before editing.

## Recommended Next Step

- Migrate `demo.sh` fixtures and remaining canonical/root documentation to the five-agent role names, then run the full demo.
