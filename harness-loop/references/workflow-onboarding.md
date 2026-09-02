# Onboarding workflow — requirement to a green harness

**Scope: Floor 1.** Do not start delivery until the harness is observable, verifiable, and green.
The development and self-repair maps are [workflow-development.md](workflow-development.md) and
[workflow-improvement.md](workflow-improvement.md).

```mermaid
flowchart LR
    U["human requirement"] -->|"decision contract\nintent + known constraints"| O["orchestrator\nfront door"]
    O --> E{"existing harness?"}
    E -- no --> S["setup-harness-loop.mjs"]
    E -- yes --> UP["upgrade plan\nownership + drift"]
    S --> HI["human-interview\nLAYER: spec\nanswer receipt"]
    UP --> HI
    HI -->|"setup contract\nanswers + environment facts"| HM["harness-manager\ntoolchain + baseline"]
    HM -->|"verification contract\ninit + coverage + verifier"| G{"gates green?"}
    G -- no, layer:harness --> HM
    G -- no, layer:project --> P["fix target configuration"]
    P --> G
    G -- yes --> R(["harness ready\nenter delivery loop"])
```

The human provides only decisions that tools cannot discover. `harness-manager` turns those answers
into a real baseline and verification commands; a target defect stays in the target, while a
`layer:harness` finding returns to canonical source repair.

For integration projects, collect the service inventory before setup. Unknown health, dependency,
or environment facts remain human-owned answers rather than guessed defaults.
