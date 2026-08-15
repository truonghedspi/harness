# DeepSeek Harness workflow research

Research date: 2026-08-15. Scope: the official
[`deepseek-ai/deepseek-harness`](https://github.com/deepseek-ai/deepseek-harness) repository at its
`master` branch. This note compares its mechanisms with this repository's autonomous harness loop.

## Executive finding

DeepSeek Harness does **not** currently implement a self-improving software-delivery loop comparable
to our `verify -> classify -> issue -> improve -> reverify` loop. Its Ralph workflow explicitly says
completion is a worker self-report with no independent evaluator, has no process-resume checkpoint or
scheduler, and treats ordinary child failure as terminal rather than retrying it
([Ralph limitations](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/workflow/tool-ralph/README.md#known-limitations-and-deferred-work)).
It therefore has not directly solved our missing review edges, baseline repair routing, issue
selection, template upgrading, or memory promotion.

What it has solved well is the substrate beneath those problems:

- durable typed events are the source of truth, while prose is only a rendering;
- orchestration policy is a replaceable plugin, not hard-coded into the agent loop;
- each iterative round has one immutable objective and a bounded, schema-validated handoff;
- lifecycle outcomes are closed unions, failure is not presented as partial success, and cleanup is
  bounded;
- repeated activity is detected from canonical structured inputs and scoped per agent;
- workspace instructions are discovered by filesystem scope and represented by typed changes and
  content digests rather than hidden text markers.

These are the mechanisms we should borrow. We should not copy Ralph as our meta-loop because it lacks
independent verification and durable cross-process execution.

## How DeepSeek structures the loop

The concrete agent loop intentionally contains only `call model -> execute tools -> repeat`. New
policy attaches through lifecycle events; compaction, retries, sandboxing, subagents, persistence,
and UI all live in plugins
([agent-loop plugin boundary](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/core/agent-loop/README.md#what-belongs-to-plugins)).
Every part, including the session log and agent loop, is replaceable through ordered plugin layers;
configuration patches target stable row IDs
([architecture](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/architecture.md#cordis),
[profiles and bundles](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/architecture.md#profiles-and-bundles)).

The session log is the source of model history. Model-visible input must be reconstructable from the
log, and a runtime invariant independently reconstructs requests from that log
([session log](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/architecture.md#session-log),
[request reconstruction invariant](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/core/agent-loop/README.md#invariant-companion)).
This is stronger than deriving routing state from Markdown notes: execution facts and their
presentation share one typed source.

The optional workflow engine executes model-authored orchestration, but deployment policy owns the
provider route and total-child ceiling; a workflow script cannot inspect or replace them. Workflow
metadata is validated as data before any script executes
([workflow start request](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/subsystems/workflow.md#the-start-request)).
Outcomes use the closed union `completed | cancelled | error`; non-completion carries an error and is
mapped to an error tool result, never partial success
([workflow result](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/subsystems/workflow.md#the-terminal-result-workflowresult)).

Cancellation has a bounded grace period, `dispose()` waits for child cleanup, and a stuck workflow
cannot wedge its caller after cancellation
([live workflow lifecycle](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/subsystems/workflow.md#a-live-run-workflowrun)).
Fatal orchestration misuse is re-thrown instead of being converted to an ordinary child failure
([failure discipline](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/subsystems/workflow.md#failure-discipline-workflowerrorfatal)).

## Ralph: the closest analogue to iterative improvement

Ralph runs one immutable objective through a bounded sequence of fresh children. Parent conversation
and previous child sessions are not inherited. The shared workspace is authoritative long-term
memory, and only the previous structured report crosses rounds
([Ralph contract](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/workflow/tool-ralph/README.md#contract)).

Each report has typed fields:

```text
status: continue | complete | blocked
summary: non-empty string
evidence: string[]
nextSteps: string[]
blocker: string
```

Status-specific invariants require next steps for `continue`, evidence and no next steps for
`complete`, and a concrete blocker for `blocked`. The handoff is size-bounded, validated inside the
workflow and decoded again at the consumer boundary
([fixed workflow source](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/workflow/tool-ralph/src/index.ts#L81-L164),
[defensive decoder](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/workflow/tool-ralph/src/index.ts#L228-L313)).
The objective, provider, schema, and caps are deployment-owned; the model supplies only data
([fixed policy](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/workflow/tool-ralph/src/index.ts#L72-L80),
[start call](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/workflow/tool-ralph/src/index.ts#L411-L446)).

This avoids context drift and malformed handoffs, but it does not prove progress. Ralph stops on a
worker's `complete`/`blocked` report or a round cap. It has no evaluator and no comparison of
workspace state between rounds
([Ralph limitations](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/workflow/tool-ralph/README.md#known-limitations-and-deferred-work)).

## Context and memory

DeepSeek separates three kinds of continuity:

1. The append-only session event log supplies conversational history, replay, resume, and telemetry
   ([session log](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/architecture.md#session-log)).
2. A Ralph run treats the shared working tree as durable long-term memory and transmits one bounded
   structured handoff between fresh children
   ([Ralph child prompt](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/workflow/tool-ralph/src/index.ts#L139-L164)).
3. Workspace rules are dynamically loaded by filesystem scope. The loader reads global and project
   `AGENTS.md`/`CLAUDE.md` candidates from project root to the session cwd, then discovers nested
   rules after successful structured filesystem operations
   ([instruction lifecycle](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/context/agent-instructions/README.md#lifecycle)).

Instruction state is not encoded in model-visible marker text. Durable message sources carry typed
`{ action, scope, path, digest? }` changes and a baseline identity; unchanged files are suppressed by
provider version plus SHA-1 content identity
([instruction state](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/context/agent-instructions/README.md#state-and-refresh)).
The loader has an explicit byte budget, preserves more-specific rules first, and emits a visible
diagnostic for omitted/truncated paths
([instruction budgeting](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/context/agent-instructions/README.md#budgeting-and-bounded-reads)).

This directly supports our cross-service rule problem: service rule locations should be structured
resources with stable identity, then resolved in the service's own root. However, DeepSeek only
walks one project-root-to-cwd chain. An integration workspace still needs our collector to record
off-tree service roots; DeepSeek's loader alone would not discover sibling repositories.

DeepSeek has no demonstrated promotion pipeline from episodic memory to rule, gate, template, or
routing policy. Its “workspace as memory” prevents session loss, but does not generalize lessons.

## Progress and livelock

DeepSeek has a useful narrow detector, not a general progress detector. The repeat-tool reminder
keys a chain by `(tool name, canonical arguments)`, where arguments are deep-key-sorted before JSON
serialization. Counters are per live agent, excluded bookkeeping calls do not launder repetition,
and user input resets the chain
([chain semantics](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/guard/repeat-tool-reminder/README.md#chain-semantics)).
At configured thresholds it injects escalating advice, but deliberately does not veto the call
([guard contract](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/guard/repeat-tool-reminder/README.md)).

This is better than hashing an entire free-text note because it canonicalizes exactly the operation
whose repetition matters. It is still only advisory, in-memory, and reset after resume; it cannot
detect semantic cycles such as `designer -> reviewer -> designer` or alternating blocker sets
([known persistence behavior](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/guard/repeat-tool-reminder/README.md#chain-semantics)).

## Application to our known problems

| Our problem | What DeepSeek demonstrates | Recommended adaptation |
|---|---|---|
| Design-review rejection has no return edge | Lifecycle facts use named typed events, paired start/end records, and closed terminal unions; policy belongs in a plugin rather than prose. | Add a typed `design.review` record with design/review revision and `approved | rejected | needs-human`; route every nonterminal state explicitly. Add a graph/demo assertion that every emitted verdict has a consumer. |
| Baseline-red contract says repair, dispatcher exits | Workflow failures remain explicit outcomes; cancellation and error cannot become success. | Make baseline state an input to the router, not a pre-router shell exit. Route `baseline:red` to a bounded repair node, and reserve terminal `blocked` for an explicit typed blocker. |
| Meta-loop chooses global top issue instead of current finding | Ralph binds all rounds to one immutable objective; workflow provider and caps are fixed outside the model. | Bind a repair run to one `issueId`/finding identity returned by import. Keep global backlog ranking as a different maintenance workflow. Reject a result whose issue identity differs. |
| Hashing all `checkerNotes` makes marker identity unstable | Instruction tracking stores typed path/action/digest state; repeat detection canonicalizes only tool name and arguments. | Replace prose hashes with `{ type, id, revision, status }`. If migration requires hashing, hash only a canonical typed marker, never the whole note body. |
| `NEEDS RE-PLAN` and test-designer can redispatch forever | Ralph has a round cap and typed status invariants; repeat guard scopes counters per agent. | Record dispatch attempts by `{ requestId, revision, node }`; one unchanged request may advance only through a finite ladder, then becomes `needs-human`. Put per-request and total-run ceilings outside agent-editable state. |
| Progress detection compares only consecutive blocker IDs | DeepSeek has canonical exact-call repetition but no semantic progress proof. | Build a durable progress fingerprint from typed finding evidence/revisions, feature states, relevant tree hash, and route request. Detect repeated states within a window, including A-B-A cycles. Keep exact-call detection as an earlier advisory signal. |
| Improver patches template and target | DeepSeek uses ordered bundles plus higher-layer patches; there is no privileged core to mutate. | Introduce explicit ownership layers: skill-owned runtime is upgraded from a versioned bundle; project-owned files remain overlays; customized skill-owned files produce conflicts/proposals. Never copy an improver edit opportunistically into the target. |
| Memory is stored but never promoted | No equivalent mechanism exists upstream. | Keep our proposed promotion audit: repeated lesson -> candidate -> human-reviewed rule/gate/template/routing change. Promotion requires independent reproduction and `demo.sh`; do not claim this is borrowed from DeepSeek. |

## Proposed control-plane shape

Borrow DeepSeek's typed-event and fixed-policy ideas without copying its missing evaluator:

```json
{
  "runId": "repair-HI-022-1",
  "objective": { "kind": "repair-harness-issue", "issueId": "HI-022" },
  "stateRevision": 4,
  "route": { "node": "designer", "requestId": "design-7", "attempt": 2 },
  "baseline": { "status": "green", "evidenceDigest": "..." },
  "findings": [{ "id": "...", "evidenceDigest": "...", "status": "open" }],
  "workspaceDigest": "...",
  "outcome": "continue"
}
```

One iteration should:

1. load the immutable objective and current typed state;
2. choose one route from an exhaustive transition table;
3. run one bounded action;
4. append start/end/outcome events, preserving interruption evidence;
5. independently re-run the relevant verifier;
6. compare a canonical progress fingerprint over a sliding window;
7. stop on verified completion, typed blocker, budget exhaustion, or detected cycle.

Completion must remain the verifier's decision. DeepSeek explicitly labels Ralph completion as a
worker report rather than certification
([result rendering](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/workflow/tool-ralph/src/index.ts#L338-L353));
our maker-checker separation is stronger and should be preserved.

## Adoption order

1. Replace routing markers and dispatch sentinels with typed records and revisions.
2. Bind each repair meta-run to one immutable imported issue identity.
3. Make baseline red and design rejection ordinary router states with explicit return edges.
4. Add canonical progress fingerprints, a cycle window, and deployment-owned attempt ceilings.
5. Add versioned skill-owned upgrade bundles plus project-owned overlays.
6. Add a promotion-candidate workflow, retaining human checkpoints and independent verification.

The high-value lesson is not “use more agents.” It is: keep the loop mechanically small, move
policy into replaceable modules, make control state typed and durable, and never let a worker's prose
be the authority for routing, progress, or completion.
