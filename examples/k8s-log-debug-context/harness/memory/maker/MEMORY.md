# Maker memory — Kubernetes Log Debug Context

Index of what the maker agent has learned across runs (`harness/docs/reference/agent-memory.md` documents the schema and why). One line per entry, always loaded — keep it
short; the reasoning lives in the linked file, read that only when the line looks relevant.

Write a new entry when a checker rejection, a failed reproduction, or a recurring review comment
teaches something the *next* maker run on this project shouldn't have to rediscover. Don't write
one for routine, expected outcomes — that's noise, not a lesson.

Write entries and hooks **in English**, whatever language the rest of the project uses: memory is
addressed to whichever agent reads it next, not to this project's readers. Entries already written
in another language stay as they are — this governs what gets written from now on.

- [OpenSearch ISM attach is async; match is OR](opensearch-ism-attach-and-match-or-semantics.md) — poll explain until policy_id, use match_phrase for message filters
- [init.mjs JDK-21 autoselect only covers its own subprocess](jdk21-autoselect-only-applies-to-init-subprocess.md) — direct `./mvnw` commands still need `JAVA_HOME=/opt/homebrew/opt/openjdk@21/...` exported
