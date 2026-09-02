# Improvement workflow — repair the harness, not one target

<!-- GENERATED from workflow-model.json by scripts/generate-workflows.mjs. Do not hand-edit. -->

Every repair starts with a reproducible finding and ends only after the detector no longer emits
that finding. Delivery work remains in [workflow-development.md](workflow-development.md).

```mermaid
flowchart LR
    V["verify-harness\nor trace insight"] -->|"issue contract\nsignature + layer + evidence"| I["harness issue\nappend-only record"]
    H["human feedback"] -->|"human issue contract"| I
    O["orchestrator proposal\nhuman approved"] -->|"approved improvement contract"| I
    I --> L{"finding layer?"}
    L -- project --> P["target delivery loop\nrouter chooses owner"]
    L -- harness --> HM["harness-manager\ncanonical source repair"]
    HM -->|"proof contract\ndemo + reverify"| R{"signature gone?"}
    R -- no --> I
    R -- yes --> U["upgrade contract\ncontext + target propagation"]
    U --> D(["resolved"])
```

`harness-manager` edits `templates/tree/**` or `scripts/**`, never only the target that exposed
the bug. A human-owned issue does not auto-resolve: no detector can prove a person's observation
has disappeared.
