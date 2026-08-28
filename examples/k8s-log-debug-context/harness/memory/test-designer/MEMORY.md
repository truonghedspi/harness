# Test designer memory — Kubernetes Log Debug Context

Index of what the test-designer agent has learned across runs (`harness/docs/reference/agent-memory.md`
documents the schema and why). One line per entry, always loaded — keep it short; the reasoning
lives in the linked file, read that only when the line looks relevant.

Write a new entry when a spec turned out to be ambiguous in a non-obvious way, when a behaviour's
logic shape was genuinely hard to classify, or when a condition that looked discriminating turned
out to pass against a wrong implementation. Don't write one for a routine design pass.

Write entries and hooks **in English**, whatever language the rest of the project uses: memory is
addressed to whichever agent reads it next, not to this project's readers. Entries already written
in another language stay as they are — this governs what gets written from now on.

<!-- - [Title](slug.md) — one-line hook -->
- [Collector mapping](collector-contract-still-contains-a-mapping.md) — Split transport from metadata properties.
- [Bootstrap races are stateful](bootstrap-races-are-stateful.md) — Treat external create races as stateful commands, not memory-model concurrency.
