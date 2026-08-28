# Feature-planner memory — Kubernetes Log Debug Context

Index of what the feature-planner has learned across planning passes for this project
(`harness/docs/reference/agent-memory.md` documents the schema and why). One line
per entry, always loaded — keep it short.

Write a new entry when a feature you sized turned out wrong mid-project (too big, wrongly cut, a
dependency you missed) and the reason wasn't obvious from `harness/docs/reference/feature-decomposition.md`
alone — something specific to how *this* project's requirements are shaped. Don't write one for a
routine re-plan; that's expected, not a lesson.

Write entries and hooks **in English**, whatever language the rest of the project uses: memory is
addressed to whichever agent reads it next, not to this project's readers. Entries already written
in another language stay as they are — this governs what gets written from now on.

<!-- - [Title](slug.md) — one-line hook -->
- [Nonstandard source roots](nonstandard-source-root-ownership.md) — Verify manifest wiring before assigning product paths.
- [Bootstrap with adapter](lifecycle-bootstrap-with-adapter.md) — Keep them together when they share a client, resource, and proof.
- [Homebrew JDK 21 is keg-only](homebrew-jdk21-keg-only.md) — `/usr/libexec/java_home -v 21` returns Temurin 25; JDK discovery must check the Homebrew keg, not java_home alone.
