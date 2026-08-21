# Checker memory — JDT MCP Server

Index of what the checker agent has learned across runs (`harness/docs/reference/agent-memory.md` documents the schema and why). One line per entry, always loaded — keep it
short; the reasoning lives in the linked file, read that only when the line looks relevant.

Write a new entry when a maker's claim looked right but wasn't (and how you actually caught it),
or a class of feature keeps needing the same scrutiny. Don't write one for a routine approve/reject
— that's the job working as intended, not a lesson.

<!-- - [Title](slug.md) — one-line hook -->
- [Provisioner success path](provisioner-success-path.md) — Failure-path coverage can leave first-run installation untested.
- [Baseline gate oracle seam](baseline-gate-oracle-seam.md) — Helper-only tests do not prove that the startup gate calls the helper or propagates its failures.
