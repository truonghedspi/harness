# Maker–checker contracts in popular agent harnesses

Checked: 2026-08-23. Sources are first-party documentation, source code, and GitHub repository/API pages. Star counts are snapshots and will drift; they indicate adoption, not contract quality.

## Verdict

Popular harnesses rarely ship a true independent maker–checker protocol. They mostly use one of four weaker contracts:

1. same-agent submit-time self-review (SWE-agent);
2. planner-to-editor handoff plus deterministic lint/test feedback (Aider);
3. task-output guardrails that return retry feedback (CrewAI);
4. configurable role conversations without a fixed verdict schema (AutoGen, OpenHands).

MetaGPT comes closest to a built-in review loop, but its `WriteCodeReview` action both judges and rewrites the code, and its default verdict is only `LGTM`/`LBTM`; it is not the evidence-bearing, independently falsifying checker used by this harness. DeepSeek Harness's Ralph has the strongest structured worker handoff in this sample, yet explicitly says completion is a worker self-report and independent evaluation is deferred.

## Comparison

| Project | Popularity snapshot | Concrete contract | Independent checker? | Useful pattern / limitation |
|---|---:|---|---|---|
| DeepSeek Harness | GitHub displayed 33.6k on one recent official crawl; local checkout is `deepseek-ai/deepseek-harness` | Fresh worker receives immutable objective, workspace, round/cap and prior bounded report; emits `{status, summary, evidence, nextSteps, blocker}` | **No** | Strong schema and status invariants; no evaluator certification |
| OpenHands | ~75.6k on official repo crawl | Action confirmation states and behavior/integration evals; reviewer workflows are composable, not default | **No default** | Separates permission approval from correctness evaluation |
| MetaGPT | ~69.9k on GitHub UI snapshot | Code-review checklist, `LGTM`/`LBTM`, then reviewer action rewrites on failure; bounded by `code_validate_k_times` | **Not cleanly** | Explicit criteria and retry bound, but reviewer also fixes and verdict lacks evidence |
| AutoGen | 60,580 via GitHub API | Framework supplies group chats/termination; reviewer/coder roles are user-authored prompts | **No fixed contract** | Flexible orchestration is not an acceptance protocol |
| CrewAI | 56.8k on official GitHub page crawl | `Task.guardrail(output) -> (bool, result_or_feedback)`; failure feedback is returned to agent; retry cap defaults to 3 | **Optional validator, not necessarily an agent** | Excellent minimal reject payload and bounded retry semantics |
| Aider | ~46.2k on official repo crawl | Architect emits natural-language solution; Editor turns it into edits; lint/test failures feed back automatically | **No** | Narrow typed responsibility and mechanical feedback, not semantic review |
| SWE-agent | 20,109 via GitHub API | Submit triggers same-agent review: rerun reproduction, require green, remove repro artifact, restore tests, inspect diff, resubmit | **No** | Strong admission gate, but no independent perspective |

Counts above are deliberately reported as dated snapshots. GitHub documents that `stargazers_count` is the repository star count ([GitHub REST documentation](https://docs.github.com/en/rest/activity/starring)).

## What each contract actually guarantees

### DeepSeek Harness: Ralph is a disciplined worker-to-worker handoff

The local checkout at commit `b150a551b8d465e31e418e1b2eaf5e79bbb7d28e` corresponds to the [official repository](https://github.com/deepseek-ai/deepseek-harness). Its [`tool-ralph` README](https://github.com/deepseek-ai/deepseek-harness/blob/main/packages/workflow/tool-ralph/README.md) defines one immutable objective and a sequence of fresh children with no inherited conversation. The workspace is authoritative long-term memory; only the previous structured report crosses rounds.

The report schema is unusually concrete:

```text
status: continue | complete | blocked
summary: non-empty normalized string
evidence: normalized string[]
nextSteps: normalized string[]
blocker: normalized string
```

The [implementation](https://github.com/deepseek-ai/deepseek-harness/blob/main/packages/workflow/tool-ralph/src/index.ts) enforces status-specific invariants twice, inside the workflow and at the consumer boundary:

- `continue` requires non-empty `nextSteps` and empty `blocker`;
- `complete` requires evidence, no next steps, and empty blocker;
- `blocked` requires a concrete blocker;
- reports over `maxHandoffChars` fail rather than being truncated;
- the terminal state distinguishes `complete`, `blocked`, `budget-limited`, and `round-failed`;
- a failed round preserves the last successful continuing report when one exists.

However, the README is explicit: completion/blocking labels say a **worker reported** the outcome, and “there is no independent evaluator or verifier.” Ralph therefore offers a strong progress/handoff contract, not a maker–checker contract. For this harness, it is a good model for `reviewPacket` shape and status invariants, but not for approval authority.

### SWE-agent: self-review is an admission gate

[SWE-agent](https://github.com/SWE-agent/SWE-agent) had 20,109 stars in the [GitHub repository API snapshot](https://api.github.com/repos/SWE-agent/SWE-agent). Its [default configuration](https://github.com/SWE-agent/SWE-agent/blob/main/config/default.yaml) loads `review_on_submit_m`: submission returns a review prompt to the same agent, including the diff, and requires it to rerun the reproducer after code changes, ensure it passes, remove the reproducer, restore modified tests, and submit again.

The [trajectory inspector](https://github.com/SWE-agent/SWE-agent/blob/main/docs/usage/inspector.md) and benchmark evaluation are outside that interactive loop. Thus SWE-agent's contract is `candidate patch -> mandatory self-audit -> resubmit`, followed by an external oracle—not `maker evidence -> independent counterexample -> verdict`.

Borrow: make `readyForCheck` an admission operation that can fail locally. Do not borrow: treating a maker's self-review as independent approval.

### Aider: planner-to-editor, then executable feedback

[Aider](https://github.com/aider-ai/aider) describes [Architect mode](https://aider.chat/2024/09/26/architect.html) as a two-model handoff: the Architect proposes a solution in natural language; the Editor converts it to well-formed file edits. There is no accept/reject response from Editor to Architect, so Editor is an implementer, not a checker.

Correctness feedback instead comes from [linting and testing](https://aider.chat/docs/usage/lint-test.html): edited files can be auto-linted, non-zero command output is fed back for repair, and users can configure automatic tests. This cleanly separates proposal, edit syntax, and executable oracle.

Borrow: keep handoff payload responsibility narrow and make command failure first-class feedback. Limitation: green lint/test output still does not establish specification coverage.

### CrewAI: the smallest useful reject contract

[CrewAI](https://github.com/crewAIInc/crewAI) displayed 56.8k stars on the official repository page snapshot. Its [Task documentation](https://github.com/crewAIInc/crewAI/blob/main/docs/edge/en/concepts/tasks.mdx) defines the clearest generic validator interface in this sample:

```python
guardrail(task_output) -> (True, accepted_or_transformed_output)
guardrail(task_output) -> (False, actionable_feedback)
```

On failure, feedback is sent to the agent and the task is retried until success or `guardrail_max_retries` (default 3). Guardrails may be deterministic functions or LLM descriptions and can be chained; the [implementation](https://github.com/crewAIInc/crewAI/blob/main/lib/crewai/src/crewai/lite_agent.py) enforces the retry cap.

This is not automatically an independent reviewer: an LLM guardrail may use the same agent model, and criteria are supplied by the application. Yet the return type is excellent: a reject must carry feedback the worker can act on, and retry ownership is unambiguous.

### MetaGPT: explicit code review, weak separation of duties

[MetaGPT](https://github.com/FoundationAgents/MetaGPT) is the strongest apparent reviewer example among the large general frameworks. Its [`WriteCodeReview`](https://github.com/FoundationAgents/MetaGPT/blob/main/metagpt/actions/write_code_review.py) prompt asks six fixed questions: requirements, logic, declared data structures/interfaces, missing functions, imports, and cross-file reuse. It emits only `LGTM` or `LBTM`; on `LBTM`, the same action asks the model to rewrite the file, repeating up to `code_validate_k_times`.

That is a concrete review loop, but not a strong maker–checker boundary:

- review output is prose plus a two-token verdict, not a replayable counterexample;
- the reviewer mutates the artifact it judges;
- no required command, evidence, violated requirement ID, or reproduction field appears in the verdict contract;
- the loop is file-oriented and prompt-judged.

Borrow: stable review questions and an explicit bounded iteration count. Avoid: allowing checker and fixer ownership to collapse.

### AutoGen and OpenHands: capabilities, not contracts

[AutoGen](https://github.com/microsoft/autogen) had 60,580 stars in its [GitHub API snapshot](https://api.github.com/repos/microsoft/autogen). It provides orchestration primitives and examples with coder/reviewer roles, but those roles are prompts selected by the application; the framework does not define an approval schema, evidence requirements, or reject-to-maker transition. A team containing a role named “reviewer” is not itself a checker contract.

[OpenHands](https://github.com/OpenHands/OpenHands) similarly exposes agent execution, delegation and evaluation facilities. In the SDK, [`WAITING_FOR_CONFIRMATION`](https://github.com/OpenHands/software-agent-sdk/blob/main/openhands-sdk/openhands/sdk/conversation/state.py) gates whether an action may execute; that is a safety/authority contract, not code correctness. Its [agent instructions](https://github.com/OpenHands/software-agent-sdk/blob/main/AGENTS.md) distinguish behavior tests from functional integration tests, while specialized/review workflows remain application composition rather than a default maker–checker protocol.

The important negative finding is that generic multi-agent topology does not answer: what must maker hand over, what may checker reject, how is the rejection reproduced, and who may declare done?

## Implications for this harness

This harness already has the rare and valuable property missing from most surveyed systems: checker independence and exclusive authority to mark work done. The improvement should preserve that property while importing the strongest narrower ideas.

Recommended contract:

```json
{
  "reviewPacket": {
    "claimRefs": ["INV-...", "TCON-..."],
    "changedPaths": ["..."],
    "runs": [{"cmd": "...", "exit": 0, "result": "..."}],
    "falsifier": {"mutation": "...", "observedFailure": "..."},
    "residualUnknowns": []
  },
  "checkerVerdict": {
    "status": "approve | reject | needs-design | blocked",
    "violatedRef": "INV-...",
    "counterexample": "...",
    "reproduction": "...",
    "observed": "...",
    "exitCriterion": "..."
  }
}
```

Design rules supported by the comparison:

1. **Admission before dispatch** — SWE-agent pattern: refuse `readyForCheck` until required runs, diff/scope inspection and cleanup checks exist.
2. **Actionable reject value** — CrewAI pattern: rejection must contain machine-preservable feedback and has a bounded retry policy.
3. **Narrow handoff plus status invariants** — DeepSeek Ralph pattern: schema validation, bounded payload, and mutually exclusive completion/continuation/blocker semantics.
4. **Mechanical oracles remain separate** — Aider pattern: command results are data in the handoff, not prose claims.
5. **Stable review axes** — MetaGPT pattern: publish the review questions before maker starts, while keeping checker free to falsify claims.
6. **Do not confuse roles with guarantees** — AutoGen/OpenHands lesson: naming an agent `reviewer` or adding a handoff edge is insufficient without verdict schema, authority and routing invariants.
7. **Keep checker write-restricted** — a deliberate improvement over MetaGPT. The checker should return a counterexample; maker owns repair.

The target metric should not be minimum raw rejection rate. It should be minimum **avoidable** rejection: missing evidence, unreplayable runs, known lifecycle omissions, or malformed handoff. Novel counterexamples are evidence that the independent checker is working.

## Bottom line

There is no high-star repository in this sample whose default contract is stronger end-to-end than this harness's intended maker–checker separation. The best upgrade is compositional: Ralph's structured handoff and invariants, CrewAI's `(accepted, feedback)` retry interface, SWE-agent's submit admission ritual, and Aider's executable feedback—while retaining independent checker authority and counterexample-based rejection.
