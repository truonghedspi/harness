# Harness-setup memory — Kubernetes Log Debug Context

Index of what harness-setup has learned about this project's real environment/toolchain
(`harness/docs/reference/agent-memory.md` documents the schema and why). One line
per entry, always loaded — keep it short.

Write a new entry when a toolchain/environment quirk cost real time to figure out (a flag needed
for this stack, a version mismatch, an MCP connectivity gotcha) — future re-setup or
troubleshooting shouldn't have to rediscover it. Don't write one for a routine, expected setup.

Write entries and hooks **in English**, whatever language the rest of the project uses: memory is
addressed to whichever agent reads it next, not to this project's readers. Entries already written
in another language stay as they are — this governs what gets written from now on.

<!-- - [Title](slug.md) — one-line hook -->
- [Keep Maven's repository inside the project sandbox](project-local-maven-repository.md) — use
  `.mvn/repository` because the sandbox cannot populate `~/.m2/repository`.
- [Keep red-first contract oracles outside the startup baseline](red-first-oracles-need-separate-maven-profile.md)
  — default Maven verification runs implemented features; `-Poracle-test` opts into pending contracts.
