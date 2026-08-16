# Known workflow migrations

## `context-interviewer` agent → user-scope `human-interview` skill

Apply only when the canonical manifest no longer declares `context-interviewer` and the installed
user skill is available.

1. Confirm `memory/context-interviewer/` contains no substantive entries. If it does, migrate the
   durable facts to their canonical assumptions, decisions or context documents before removal.
2. Remove the manifest entry and its prompt/memory stub.
3. In customized routers/prompts, replace dispatch instructions with: the agent that discovers a
   human-owned gap invokes `human-interview` before leaving its current context.
4. Keep `needs-human` as a human checkpoint in `loop/route.mjs`; it must not name another agent.
5. Regenerate every runtime and assert no generated `context-interviewer` remains.
6. Verify a `needs-human` fixture returns `{node:"human", kind:"human", layer:"spec"}` and names
   `human-interview` in its reason.

Why: the discovering agent already holds the evidence and causal context. Dispatching an interview
specialist repeats collection and weakens the question; the skill retains the discipline without
the context switch.
