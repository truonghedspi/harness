---
name: human-interview
description: Elicit consequential information or decisions that only a person can provide, without switching to a separate interview agent. Use this skill in the current working context whenever progress depends on business intent, risk appetite, ownership, environment facts, acceptance criteria, permissions, priorities, or an unresolved needs-human assumption. First exhaust discoverable evidence, then ask an evidence-rich dependency-ordered round, validate the answer, and persist a durable receipt. Do not use it for facts available from code, tools, documentation, or a safe probe.
version: 0.1.0
---

# Human Interview

Keep the agent that discovered the gap in the conversation. It already holds the causal context;
switching to a specialist makes another model rediscover the project and weakens the question.

## Before asking

1. State the blocked decision and what changes depending on the answer.
2. Separate `discoverable fact`, `human-owned fact`, `preference`, and `authorization`.
3. Search the scoped sources and run safe probes for discoverable facts. Record source pointers, not
   copied source content. Never ask the human to act as search or build tooling.
4. List the unresolved questions as a dependency graph. Ask only the current frontier: questions
   whose prerequisites are already settled and which cannot invalidate one another.
5. Read [question-design.md](references/question-design.md) for consequential or multi-question
   interviews. Read [persistence.md](references/persistence.md) before recording an answer.

## Ask an information-rich round

Lead with one sentence explaining why this round is needed. Number questions so the person can
answer compactly. For each question include:

```text
Q<n> — <decision title>
Known: <the relevant evidence and its source pointer>
Need from you: <one precise question>
Options: <only genuine options, with the deciding trade-off>
Recommendation: <default and reasoning, or "none" when neutrality is material>
Impact: <what this answer unblocks or changes>
Answer as: <typed answer contract or short example>
```

Do not expose this full template mechanically when a natural two-sentence question carries the
same information. Richness is measured by decision usefulness, not visible fields.

Default to the whole independent frontier in one round. Ask one question at a time when the user
requests it, the topic is sensitive, or an answer is likely to reshape all later questions. Never
ask more than the person can evaluate carefully; split a broad subject by decision boundary.

## Use LLM strengths without inheriting LLM weaknesses

- Synthesize scattered evidence into the smallest decision frame the person needs.
- Generate real alternatives and explain the axis each wins on; do not pad the list.
- Recommend when evidence favors an option, but mark the recommendation as inference rather than
  presenting it as a discovered fact.
- Challenge vague, contradictory, or incomplete answers once with the concrete conflict and a
  proposed reconciliation. Do not badger the user into agreeing.
- Detect answers that reveal a new dependency. Recompute the frontier instead of continuing a
  stale script.
- Do not answer the human-owned question yourself, manufacture certainty, or treat silence as
  consent unless an explicit reversible default was agreed before the pause.

## Close the loop

Read back the interpreted decision before acting when the answer is consequential or ambiguous.
Persist the distilled answer and provenance in the artifact owned by the current workflow; never
store only a chat transcript. If this agent cannot write the owning artifact, write a typed handoff
receipt to an allowed state file and name the owner—do not spawn an interview agent.

Report what was closed, what remains open, and which new questions surfaced. Resume the original
task in the same context when authority and permissions allow it.

## Boundaries

- Interviewing supplies information and authority; it does not expand task scope.
- A prototype can settle a preference and a probe can settle a fact. Build the cheapest one when
  conversation cannot answer the question reliably.
- Preserve the user's wording for commitments; summarize surrounding discussion.
- Do not persist secrets, personal data, or raw transcripts when a redacted decision is sufficient.
- Apply `EXTEND.md` if present, but never weaken evidence exhaustion, answer validation, or durable
  receipt requirements.
