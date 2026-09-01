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
| [workflow-improvement.md](workflow-improvement.md) | The loop that repairs the **skill**: three signal producers, one ranked backlog, and a closing rule nothing can fake | a gate, a trace or a person says the harness itself is wrong |

## Keeping these current

A diagram that lags the code is worse than no diagram: it is read as authoritative.
`node scripts/check-workflow-diagram.mjs` is the mechanical check —
it reads `agents.manifest.json` and `loop/route.mjs --rules` and fails when a real node, layer or
named file is missing from every diagram. `verify-harness.mjs` runs it as the `workflow-diagram`
gate, so the picture cannot silently fall behind the routing table it claims to draw.

What the checker cannot see is whether an *arrow* is still right. That stays a human's job, and the
cheapest moment to do it is the same commit that changed the workflow.
