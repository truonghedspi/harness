# Durable answer receipt

Distil conversation into the workflow's canonical artifact. Keep enough provenance to distinguish
a human decision from an agent inference after the chat is gone.

Minimum receipt:

```json
{
  "questionId": "stable-id",
  "question": "the decision asked",
  "answer": "the interpreted answer",
  "answeredBy": "human identifier or role",
  "answeredAt": "ISO-8601 timestamp",
  "scope": ["affected component or requirement"],
  "basis": [{"kind": "source|observation|human", "pointer": "durable pointer"}],
  "supersedes": null,
  "openFollowUps": []
}
```

Prefer the native project form when it preserves these semantics: a verified assumptions row, a
cross-cutting policy with owner and enforcement, a decision record, or a typed integration-init
answer receipt. Do not create a parallel truth store merely to match this example.

If the current role cannot write the canonical artifact, place the receipt in its allowed handoff
state and name the owning role. The owner transfers the receipt; it does not re-interview the human.
