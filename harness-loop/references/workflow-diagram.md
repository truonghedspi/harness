# Workflow diagrams — the map

Visual companions to `SKILL.md`. Nothing in these files is new information: each diagram is a
picture of a process already described in prose elsewhere in this skill. Read the linked section
for the reasoning; use the diagram to get oriented fast, or to hand to someone who has not read the
prose yet.

Three workflows, split because they have three different readers and three different moments:

| Workflow | Covers | Read it when |
|---|---|---|
| [workflow-onboarding.md](workflow-onboarding.md) | Floor 1: a requirement or an existing repo → a green harness. Adoption, scaffolding, the human interview, multi-service init, the gates | you are standing a harness up, or adopting one into a repo that already has history |
| [workflow-development.md](workflow-development.md) | Floor 2: a green harness → DONE. Design, decomposition, oracle, implementation, the per-iteration sequence, the K8s specialization | you are running the loop, or trying to work out why the router picked what it picked |
| [workflow-improvement.md](workflow-improvement.md) | The loop that repairs the **skill**: three signal producers, completed-feature telemetry proposals gated by a human, one ranked backlog, and a closing rule nothing can fake | a gate, a trace or a person says the harness itself is wrong |

The compact roster view is available as [five-agent-workflow.svg](diagram/five-agent-workflow.svg)
(with a PNG preview beside it). For the dispatch path and durable handoff contracts, read
[agent-interaction-contracts.svg](diagram/agent-interaction-contracts.svg) (also with a PNG preview).
They complement, rather than replace, the phase-level Mermaid diagrams below.

## Keeping these current — single source of truth

Workflow Markdown (`workflow-*.md`) **must not be edited manually**. It is generated from
[workflow-model.json](workflow-model.json), the sole source of truth for nodes, edges, layers,
and contracts. Workflow:

```
workflow-model.json   ←── edit here
        ↓
node scripts/generate-workflows.mjs     ←── sinh workflow-*.md
        ↓
node scripts/check-workflow-diagram.mjs ←── verify (CI gate)
```

`check-workflow-diagram.mjs` performs two checks:
1. **Generated check**: workflow-*.md matches the generator output (catches drift).
2. **Model check**: the model contains every agent (from `agents.manifest.json`), node, and layer
   (from `route.mjs --rules`), and every edge references a valid node and layer.

Change routing or a contract → edit `workflow-model.json` → run the generator → runtime,
Mermaid, and the contract table change together. There is no longer a "right name, wrong flow" diagram.

`verify-harness.mjs` runs the checker as the `workflow-diagram` gate, so CI catches drift automatically.
