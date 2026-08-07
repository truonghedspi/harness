# Workflow diagrams

Visual companions to the "Lifecycle: create → verify → improve" and "Setup workflow" sections of
`SKILL.md`. Nothing here is new information — each diagram is a picture of a process already
described in prose elsewhere in this skill; read the linked section for the reasoning, use the
diagram to get oriented fast or to hand to someone who hasn't read the prose yet.

## 1. End-to-end: requirement → DONE

One pass through Floor 1 (harness) then Floor 2 (loop), matching `SKILL.md`'s Setup workflow
steps 1:1.

```mermaid
flowchart TD
    A["User requirement\n(doc / plain language)"] --> B["setup-harness-loop.mjs\nscaffold Floor 1 + Floor 2"]
    B --> C["feature-planner agent\ndecompose requirement into\nfeature_list.json DAG (once)"]
    C --> D{"./init.sh green?"}
    D -- no --> D1["Fix the baseline\n(only job until green — Lesson 6/9)"]
    D1 --> D
    D -- yes --> E{"check-coverage.mjs\n13/13 lessons?"}
    E -- no --> E1["Fill the missing artifact"]
    E1 --> E
    E -- yes --> F{"verify-harness.mjs --run-features\n0 blockers?"}
    F -- no --> F1["Fix it — layer:project → target repo\nlayer:harness → the skill itself"]
    F1 --> F
    F -- yes --> G["Start the maker/checker loop\nloop/run-loop.sh N"]
    G --> H{"loop/goal.md\nstop condition met?"}
    H -- no --> G
    H -- yes --> I["DONE"]
```

## 2. Inside one loop iteration — generator/evaluator separation (Lesson 9/13)

The maker never grades itself; only the checker (re-running evidence independently) may set
`status: done`. See `references/loop-engineering.md`'s "Generator/evaluator separation" section
for why.

```mermaid
sequenceDiagram
    participant RL as run-loop.sh
    participant M as maker agent
    participant FS as feature_list.json (disk)
    participant C as checker agent

    RL->>M: kiro-cli chat --agent maker
    M->>FS: pick first not-started feature<br/>whose dependencies are all done
    M->>M: implement one step, run its<br/>verification command for real
    M->>FS: write evidence, readyForCheck=true<br/>(cannot write status=done)
    RL->>C: kiro-cli chat --agent checker
    C->>FS: read every readyForCheck feature
    C->>C: re-run verification independently,<br/>try to falsify the claim
    alt evidence reproduces, scope is right
        C->>FS: status=done
    else evidence fails or scope drifted
        C->>FS: status=in-progress + checkerNotes<br/>(or blocked, if attempts exhausted)
    end
    RL->>RL: ./init.sh — red baseline stops the loop
```

## 3. The self-improvement loop (`harness-loop.sh`) — fixes the skill, not just the target

Runs alongside the project loop; every finding is routed by `layer`, and closing an issue
requires a real re-verify, never a claim. See `references/harness-improvement-loop.md` for the
full layer-classification contract this diagram implements.

```mermaid
flowchart TD
    V["verify-harness.mjs"] --> S{"green\n(0 blockers)?"}
    S -- yes --> Done["harness ready —\nstart/continue the project loop"]
    S -- no --> Sig{"same blocker set\nas the last iteration?"}
    Sig -- yes --> Stop["STOP — escalate to a human\n(no progress, don't spin forever)"]
    Sig -- no --> L{"finding layer?"}
    L -- harness --> HI["harness-issue.mjs import\nimprove-harness.mjs (rank)\ndispatch harness-improver agent\nfix templates/tree/** or scripts/*.mjs"]
    L -- project --> PJ["dispatch loop/run-loop.sh 1\nfix lands in the target repo"]
    HI --> V
    PJ --> V
```
