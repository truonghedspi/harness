# Design facilitator memory — Kubernetes Log Debug Context

Index of what the design-facilitator has learned about this project's shape across design sessions
(`harness/docs/reference/agent-memory.md` documents the schema and why). One line per entry, always
loaded — keep it short.

Write a new entry when a session hit something non-obvious about *this* project: an assumption that
turned out false, a library behaving unlike its docs, a boundary that looked clean and wasn't, or a
critique technique (Phase 4/5 of `harness/prompts/design-facilitator.md`) that surfaced a real flaw or missed
one the human later caught. Don't write one for a routine session.

Write entries and hooks **in English**, whatever language the rest of the project uses: memory is
addressed to whichever agent reads it next, not to this project's readers. Entries already written
in another language stay as they are — this governs what gets written from now on.

<!-- - [Title](slug.md) — one-line hook -->
- [Contained harness audit noise](contained-harness-audit-noise.md) — Vendored skills can make the cross-cutting audit report non-product concerns.
- [Schema policy seam](schema-policy-needs-observable-seam.md) — Compatibility needs an observable invariant.
- [MCP policy needs two seams](mcp-policy-needs-auth-and-surface-seams.md) — JWT admission and a closed tool set need distinct invariants.
- [Collector egress is OTLP-only](collector-egress-is-otlp-only.md) — The v1 "one JSON object" contract and the unmodified-stock-image decision are mutually unsatisfiable at the collector egress.
- [k8sattributes emits no workload.name](k8sattributes-emits-no-workload-name.md) — The pinned processor emits concrete per-owner names, never `k8s.workload.name`; the chart maps a field that is never produced.
