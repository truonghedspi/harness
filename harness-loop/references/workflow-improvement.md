# Improvement workflow — the loop that fixes the skill, not the target

Runs alongside the development loop. Every finding is routed by `layer`, and closing an issue
requires a real re-verify, never a claim. See
[harness-improvement-loop.md](harness-improvement-loop.md) for the full layer-classification
contract this diagram implements.

## Three producers, one backlog

The backlog began with one producer — the static gates, which inspect files. Two more signals
existed and evaporated at the end of every session: what the loop actually *did*, and what it made
a *person* do. Human attention is the one input this harness cannot renew
([human-attention.md](human-attention.md)).

```mermaid
flowchart TD
    V["verify-harness.mjs\nstatic gates over files\nsignature: gate/id"] --> IMP
    TI["trace-insights.mjs --report\nreplays trace/*.jsonl, route-log,\napproval-log, assumptions.md\nsignature: trace/id"] --> IMP
    RETRO["orchestrator after a new done\nrun-report + trace-insights + trajectory\none evidence-backed proposal"] --> APPROVE{"human explicitly\napproves proposal?"}
    APPROVE -- canonical harness --> TI
    APPROVE -- project --> PJU
    HU["a person\nharness-issue.mjs feedback\ngate: human"] --> IMP["harness-issue.mjs import\nappend-only harness-issues.jsonl\nfold: open / occurrence / regressed"]
    TI --> PJU["layer:project options\n(unverified assumptions, residual unknowns)\nstay with the target — a citation or a spike there,\nnever an edit to the skill"]
    IMP --> RANK["improve-harness.mjs\nscore = occurrences x severity\nx distinct targets x (regressed ? 2 : 1)"]
    RANK --> ROUTE{"--route?"}
    ROUTE -- yes --> FEAT["top issue becomes a feature\nverification = --reverify --id HI-NNN\n(gate:human is never routed —\nno detector means no way to close it)"]
    ROUTE -- no --> PR["--prompt --id HI-NNN\none immutable repair objective"]
    FEAT --> FIX
    PR --> FIX["fix lands in templates/tree/** or scripts/*.mjs\nnever in the one target"]
    FIX --> RV["improve-harness.mjs --reverify\nre-runs BOTH detectors per target"]
    RV --> GONE{"signature still\nreproduces?"}
    GONE -- yes --> RANK
    GONE -- no --> RES["resolved\n(gate:human issues excepted —\nonly a person closes what only a person saw)"]
```

## The rule that makes it honest

**Nothing can type "fixed" and have it stick.** The only route to `resolved` is `--reverify`
actually re-running the detectors against a real target and finding the signature gone. That is the
same generator/evaluator separation the maker–checker loop already requires, applied to the
skill's own defects.

Two consequences worth stating outright:

- **Re-verification runs every detector.** Running only the static gates would make every
  trace-sourced issue look fixed the moment it was imported — absence from a detector that never
  emits it is not evidence of anything.
- **A `gate: human` issue never auto-resolves and is never auto-routed.** It has no detector to
  fall silent, so silence retiring it would mean the loop closes the complaint by being unable to
  see it; and a routed feature with no way to verify itself is a livelock, eligible forever.
- **Telemetry does not authorize an edit.** The orchestrator proposes one evidence-backed change
  after a newly completed feature; only an explicit human approval sends it to this graph or to the
  project's feature planner.

## The meta-loop's stop condition

```mermaid
flowchart TD
    V["verify-harness.mjs"] --> S{"green\n(0 blockers)?"}
    S -- yes --> Done["harness ready —\nstart/continue the development loop"]
    S -- no --> Sig{"canonical state seen before?\nfindings + evidence + features + workspace"}
    Sig -- yes --> Stop["STOP — escalate to a human\n(no-op or A-B-A cycle)"]
    Sig -- no --> L{"finding layer?"}
    L -- harness --> HI["harness-issue.mjs import → issueId\nimprove-harness.mjs --id issueId\ndispatch one immutable repair objective\nfix templates/tree/** or scripts/*.mjs"]
    L -- project --> PJ["dispatch node loop/run-loop.mjs 1\nfix lands in the target repo"]
    HI --> V
    PJ --> V
```

It keeps **every** fingerprint seen during the run, not just the previous one: comparing only
consecutive states misses an A→B→A cycle, and stops falsely when the same gate is producing changed
evidence.
