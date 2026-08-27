# Test implementer memory — Kubernetes Log Debug Context

Index of what the test-implementer agent has learned across runs (`harness/docs/reference/agent-memory.md`
documents the schema and why). One line per entry, always loaded — keep it short; the reasoning
lives in the linked file, read that only when the line looks relevant.

Write a new entry when a test could not be made to fail red for a non-obvious reason, when a
generator produced useless inputs until it was fixed, or when a mutant survived a test that looked
sufficient. Don't write one for a routine red-green cycle.

Write entries and hooks **in English**, whatever language the rest of the project uses: memory is
addressed to whichever agent reads it next, not to this project's readers. Entries already written
in another language stay as they are — this governs what gets written from now on.

<!-- - [Title](slug.md) — one-line hook -->
- [Wire seam first](serialized-contract-needs-wire-seam.md) — Require approved payload fields and API before a serialized oracle.
