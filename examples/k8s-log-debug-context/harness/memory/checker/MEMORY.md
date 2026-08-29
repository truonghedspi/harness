# Checker memory — Kubernetes Log Debug Context

Index of what the checker agent has learned across runs (`harness/docs/reference/agent-memory.md` documents the schema and why). One line per entry, always loaded — keep it
short; the reasoning lives in the linked file, read that only when the line looks relevant.

Write a new entry when a maker's claim looked right but wasn't (and how you actually caught it),
or a class of feature keeps needing the same scrutiny. Don't write one for a routine approve/reject
— that's the job working as intended, not a lesson.

Write entries and hooks **in English**, whatever language the rest of the project uses: memory is
addressed to whichever agent reads it next, not to this project's readers. Entries already written
in another language stay as they are — this governs what gets written from now on.

<!-- - [Title](slug.md) — one-line hook -->
- [Recorded command environment](recorded-command-environment.md) — Replay Maven proofs without maker-only runtime setup; JDK selection must be reproducible.
- [Integration-test per-test timeout](integration-test-per-test-timeout.md) — Green ITs can still lack a JUnit `@Timeout`; transport defaults are mitigation, not compliance.
- [Duplicated config pinned wrong copy](duplicated-config-pinned-wrong-copy.md) — A green policy test can assert a marker on the hermetic config while the live deployment config drifts unpinned.
- [OTLP filter direction is blind to a static marker test](otlp-filter-direction-blind-static-test.md) — `contains("debug.logs/enabled") && contains("\"true\"")` passes on both `==` and `!=`; OTel filter drops where the condition is true, so `== "true"` inverts the opt-in and a static test never catches it.
- [Referenced identity not defined](referenced-identity-not-defined.md) — A green RBAC test can assert a binding names the right ServiceAccount while that SA is never DEFINED; check the `kind: ServiceAccount` exists, not just that the name is wired.
