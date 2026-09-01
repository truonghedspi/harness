# Maker memory — Harness

Index of what the maker agent has learned across runs (`docs/reference/agent-memory.md` documents the schema and why). One line per entry, always loaded — keep it
short; the reasoning lives in the linked file, read that only when the line looks relevant.

Write a new entry when a checker rejection, a failed reproduction, or a recurring review comment
teaches something the *next* maker run on this project shouldn't have to rediscover. Don't write
one for routine, expected outcomes — that's noise, not a lesson.

Write entries and hooks **in English**, whatever language the rest of the project uses: memory is
addressed to whichever agent reads it next, not to this project's readers. Entries already written
in another language stay as they are — this governs what gets written from now on.

- [compound-verification-commands](compound-verification-commands.md) — when verification combines unrelated checks with &&, implement against the falsifier not the compound failure
