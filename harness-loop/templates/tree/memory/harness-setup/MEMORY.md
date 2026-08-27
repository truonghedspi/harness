# Harness-setup memory — {{PROJECT_NAME}}

Index of what harness-setup has learned about this project's real environment/toolchain
(`docs/reference/agent-memory.md` documents the schema and why). One line
per entry, always loaded — keep it short.

Write a new entry when a toolchain/environment quirk cost real time to figure out (a flag needed
for this stack, a version mismatch, an MCP connectivity gotcha) — future re-setup or
troubleshooting shouldn't have to rediscover it. Don't write one for a routine, expected setup.

Write entries and hooks **in English**, whatever language the rest of the project uses: memory is
addressed to whichever agent reads it next, not to this project's readers (`docs/reference/agent-memory.md`).

<!-- - [Title](slug.md) — one-line hook -->
