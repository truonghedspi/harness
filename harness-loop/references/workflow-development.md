# Development workflow — from a green harness to DONE

**Scope: Floor 2.** Everything here assumes the gates in
[workflow-onboarding.md](workflow-onboarding.md) are already green. The loop that repairs the skill
itself is [workflow-improvement.md](workflow-improvement.md).

The **layer** labels are the ones `loop/route.mjs` returns. A rollback goes back to the layer the
defect came from, not one step back ([graph.md](graph.md)).

## 1. One feature, end to end

```mermaid
flowchart TD
    READY["harness ready\n(gates green)"] --> DS["design-facilitator\nLAYER: design\ncomponents · cited claims · live assumptions\n+ observable seam & invariants per component\n+ self-applied critique, never a verdict"]
    DS --> DA{"human writes\nloop/design-approval.json\nmatching the design digest?"}
    DA -- no --> DS
    DA -- yes --> FP["feature-planner + capability skill\nLAYER: decomposition\ndraft → check-plan.mjs → publish\nbuild/prove DAG + digest-bound context packet"]
    QS["quality-strategy\nCapability–Attribute risk → oracle\nscope ≠ execution size"] --> FP
    FP --> TD["test-designer\nLAYER: oracle\nspec → conditions. Never reads the code."]
    TD --> TI["test-implementer\nconditions → FAILING test, then a\nmutant-checked red run proving it discriminates"]
    TI --> MK["maker\nLAYER: implementation\nmakes the existing oracle pass"]
    MK --> BG{"loop/baseline-state.json\nLAYER: baseline\ngreen? (reused across sessions when\nbaseline-cache.mjs says inputs are identical)"}
    BG -- no --> RP
    BG -- yes --> RP{"a failure to repair?\nred baseline, or attempts >= 1"}
    RP -- yes --> DG["maker mode: diagnose\nLAYER: diagnosis\nprove the cause, rule one reading out,\nwrite loop/diagnosis/<key>.json, edit nothing"]
    DG --> MK
    RP -- no --> LOOP["node loop/run-loop.mjs N\nrouted by loop/route.mjs"]
    LOOP --> K8S{"verification invokes Kubernetes tooling\nor a tests/k8s/ journey?"}
    K8S -- yes --> KT["k8s-integration-tester\nLAYER: integration (Level 3)\nsame test-authoring rules;\nreads the code, so its independence\nis the boundary, not blindness"]
    KT --> BJ{"business outcome spans\nmultiple deployed services?"}
    BJ -- yes --> BJC["business-journey capability (Level 4)\npublic driver · per-run isolation\nconvergence + fault/idempotency oracle\nredacted journey metrics"]
    BJC --> STOP
    BJ -- no --> STOP
    K8S -- no --> STOP{"loop/goal.md\nstop condition met?"}
    STOP -- no --> LOOP
    STOP -- yes --> I["DONE"]
    CK["checker\nLAYER: final-acceptance\nre-runs the evidence; the only node\nthat may write status: done"] -- "APPROVE + FOLLOW-UP" --> FP
    MK -. "PostToolUse (redacted)" .-> TEL["tool-events.jsonl\ndirect reads/searches ≠ shell inference"]
    TEL --> RR["run-report\nduplicate reads · packet rediscovery\n+ coverage declaration"]
    classDef oracle fill:#eef7ee,stroke:#4a7
    class TD,TI,KT oracle
```

**Why the oracle sits between decomposition and implementation, and why half of it moved up into
design.** The same agent writing the code and the test can be wrong in both directions and still go
green. The defence is that the oracle's author has not read the implementation — which only holds
if the test exists *first*, so `route.mjs` refuses to make a build feature eligible until its prove
feature has a recorded red run, and that red run must be **mutant-checked**: a test that has never
been seen to fail against a deliberately wrong implementation has not been proven to discriminate.

But *case-level* test design needs a unit and an interface, which do not exist before decomposition,
while *"how would we know this works"* — the observable seam and the invariants — is a property of
the design itself. A component whose behaviour can only be seen by reaching inside it is a boundary
defect, and discovering that at test-writing time forces the choice between a bad test and a
redesign; the bad test always wins. So the design-facilitator states seam + invariants, the planner
derives each `falsifier` from them, and the test-designer builds cases on top
([test-authoring.md](test-authoring.md)).

Measured symptom of the version without this: on the dogfood project **every** unfinished feature
was missing its `falsifier` — not because the planner was lazy, but because nobody upstream had
produced an invariant to derive one from.

**Why a repair detours through `diagnosis`.** A repair implemented against a guessed cause spends an
attempt, edits production code, and leaves the real cause in place. The diagnose turn is not a
repair: it proves the cause and rules one competing reading out before anything is edited
(`loop/diagnosis/README.md`).

## 2. Inside one iteration — generator/evaluator separation (Lesson 9/13)

The maker never grades itself; only the checker (re-running evidence independently) may set
`status: done`. The separation is also temporal: makers finish and hand off the whole delivery
before the checker runs one final acceptance batch. See
[loop-engineering.md](loop-engineering.md)'s "Generator/evaluator separation" section for why.

One iteration may be several makers at once, over disjoint file sets inside one feature — but never
several *features*, and never a parallel test run. [graph.md](graph.md) states the fan-out and
fan-in rules; the short version is that the verification is what makes a claim, and a claim is made
once, by one agent.

```mermaid
sequenceDiagram
    participant RL as run-loop.mjs
    participant M as maker agent
    participant FS as feature_list.json (disk)
    participant C as checker agent

    RL->>RL: all features done/blocked-with-reason?<br/>→ exit early, no LLM session spawned
    RL->>RL: baseline gate — reuse a green one when<br/>loop/baseline-cache.mjs says the inputs are identical
    RL->>M: dispatch (retry only when nothing came back)<br/>ACP initialize → session/new → session/prompt
    M->>FS: pick first not-started feature<br/>whose dependencies are done or handed off<br/>(skip NEEDS RE-PLAN and k8s-specialized ones)
    alt the step has 2+ independent file sets
        M->>FS: write loop/work-split/<feat>.json, then stop
        RL->>FS: tools/work-split.mjs validate —<br/>slices disjoint? briefs self-contained?<br/>fan-in runs the feature verification?
        RL->>M: mode slice-fanout: one maker per slice,<br/>each confined to its paths by guard-write.mjs
        RL->>M: mode integrate: ONE maker runs the tests<br/>(the verification never fans out)
    else one file set
        M->>M: implement one bounded step, run the<br/>most relevant verification for real
    end
    alt feature-level behavior is incomplete
        M->>FS: checkpoint evidence/progress,<br/>readyForCheck=false
        RL->>RL: next iteration routes the<br/>active feature to maker
    else complete behavior + green verification + complete evidence
        M->>FS: reviewPacket + readyForCheck=true<br/>(cannot write status=done)
        RL->>RL: continue delivery while any<br/>non-blocked open feature is not handed off
        alt every remaining feature handed off
        RL->>FS: review-contract.mjs --ready<br/>admits the complete final batch
        RL->>C: one final ACP session/prompt<br/>(kiro-cli acp --agent checker)
        C->>FS: review every readyForCheck feature<br/>as one integrated delivery
        C->>C: semantic review — behavior actually met,<br/>no scope bleed; falsify, don't confirm
        alt claim survives
            C->>FS: status=done
        else evidence fails or scope drifted
            C->>FS: attempts += 1; status=in-progress<br/>+ checkerNotes (or blocked at maxAttempts)
        else feature itself is mis-cut
            C->>FS: checkerNotes = "NEEDS RE-PLAN: ..."<br/>→ routes to feature-planner, not the maker
        end
        end
    end
    RL->>FS: record baseline-state.json<br/>with outcome + evidence digest
    alt baseline red and its cause is not on record
        RL->>M: mode diagnose — prove the cause, edit nothing
    else cause on record, first repair
        RL->>M: bounded baseline repair turn
    else same red digest after repair
        RL->>H: stop — needs human
    end
```

## 3. `k8s-integration-tester`'s own workflow (opt-in, `templates/k8s/`)

A specialized maker for K8s Level-3 features — same "cannot set status=done" rule as the maker in
diagram 2, plus one extra boundary: it diagnoses, `tools/k8s-test-env.sh` is the only thing that
ever deploys or tears down. See [k8s-integration-testing.md](k8s-integration-testing.md) for the
full reasoning, including the resource-contention and kubeconfig-wipe gotchas this diagram's
Step 0/7 exist for.

```mermaid
flowchart TD
    S0{"Step 0: kubectl cluster-info\nreachable?"}
    S0 -- no, local minikube/kind --> S0a["start it myself\n(host-level op, not a K8s API write)"]
    S0 -- no, shared/remote --> S0b["report the connection error\nand stop — not my cluster to provision"]
    S0a --> S1
    S0 -- yes --> S1["Step 1-2: read testing-standards.md Level 3,\npoint k8s-test-env.sh at the real chart\n+ explicit manifest values files"]
    S1 --> S2["Step 3: write a real test exercising\nthe deployed Service over the network"]
    S2 --> S3["Step 4: run it —\ntools/k8s-test-env.sh chart -- test-cmd"]
    S3 --> SR{"interrupted teardown left an exact\nlabelled namespace + uninstalling release?"}
    SR -- yes, human approved exact identity --> SRS["script cleanup-stuck-release:\npin context + live identity\nretry uninstall → delete namespace → verify absent"]
    SRS --> S3
    SR -- no --> LR{"blocked by pre-fix Helm orphan?"}
    LR -- yes, human approved exact identity --> LRR["script recover-orphan:\npin context + annotations + RBAC allowlist\nadopt → uninstall → verify absent"]
    LRR --> S3
    LR -- no --> S4{"passed?"}
    S4 -- no --> S5["Step 5: diagnose — events, then separate\ninit/app container logs, then read-only MCP"]
    S5 --> S2
    S4 -- yes --> S6["Step 6: wire the confirmed command into\ntesting-standards.md's Level 3"]
    S6 --> S7["Step 7: uninstall every attempted release,\ndelete the namespace, then stop the local cluster\n(if local) — don't starve the JVM/other suites"]
    S7 --> S8["complete journey: record evidence, readyForCheck=true\npartial checkpoint: leave false; checker is not dispatched"]
```
