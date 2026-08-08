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
    B --> C["feature-planner agent\ndecompose requirement into\nfeature_list.json DAG (once;\nre-run on NEEDS RE-PLAN verdicts)"]
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
    G --> G2{"Feature needs K8s Level-3 testing\n(no Docker, real cluster)?"}
    G2 -- yes --> G3["k8s-integration-tester (opt-in,\ntemplates/k8s/) — deploy/write-test/\nrun/diagnose via tools/k8s-test-env.sh"]
    G3 --> H
    G2 -- no --> H{"loop/goal.md\nstop condition met?"}
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

    RL->>RL: all features done/blocked-with-reason?<br/>→ exit early, no LLM session spawned
    RL->>M: kiro-cli chat --agent maker
    M->>FS: pick first not-started feature<br/>whose dependencies are all done<br/>(skip NEEDS RE-PLAN and k8s-specialized ones)
    M->>M: implement one step, run its<br/>verification command for real
    M->>FS: write evidence, readyForCheck=true<br/>(cannot write status=done)
    RL->>FS: tools/verify-harness.mjs --promote —<br/>mechanical replay; flip clean reproductions<br/>to done (never touches blocked)
    RL->>C: kiro-cli chat --agent checker
    C->>FS: read remaining readyForCheck features<br/>+ spot-check the promoted ones
    C->>C: semantic review — behavior actually met,<br/>no scope bleed; falsify, don't confirm
    alt claim survives
        C->>FS: status=done
    else evidence fails or scope drifted
        C->>FS: status=in-progress + checkerNotes<br/>(or blocked, if attempts exhausted)
    else feature itself is mis-cut
        C->>FS: checkerNotes = "NEEDS RE-PLAN: ..."<br/>→ routes to feature-planner, not the maker
    end
    RL->>RL: ./init.sh — red baseline stops the loop
```

## 3. `k8s-integration-tester`'s own workflow (opt-in, `templates/k8s/`)

A specialized maker for K8s Level-3 features — same "cannot set status=done" rule as the maker in
diagram 2, plus one extra boundary: it diagnoses, `tools/k8s-test-env.sh` is the only thing that
ever deploys or tears down. See `references/k8s-integration-testing.md` for the full reasoning,
including the resource-contention and kubeconfig-wipe gotchas this diagram's Step 0/7 exist for.

```mermaid
flowchart TD
    S0{"Step 0: kubectl cluster-info\nreachable?"}
    S0 -- no, local minikube/kind --> S0a["start it myself\n(host-level op, not a K8s API write)"]
    S0 -- no, shared/remote --> S0b["report the connection error\nand stop — not my cluster to provision"]
    S0a --> S1
    S0 -- yes --> S1["Step 1-2: read testing-standards.md Level 3,\npoint k8s-test-env.sh at the real chart"]
    S1 --> S2["Step 3: write a real test exercising\nthe deployed Service over the network"]
    S2 --> S3["Step 4: run it —\ntools/k8s-test-env.sh chart -- test-cmd"]
    S3 --> S4{"passed?"}
    S4 -- no --> S5["Step 5: diagnose — dumped events/logs\nfirst, then read-only k8s-readonly MCP"]
    S5 --> S2
    S4 -- yes --> S6["Step 6: wire the confirmed command into\ntesting-standards.md's Level 3"]
    S6 --> S7["Step 7: stop the local cluster again\n(if local) — don't starve the JVM/other suites"]
    S7 --> S8["record evidence, readyForCheck=true\n(checker still decides done)"]
```

## 4. The self-improvement loop (`harness-loop.sh`) — fixes the skill, not just the target

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
