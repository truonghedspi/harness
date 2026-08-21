# Design facilitator memory — JDT MCP Server

Index of what the design-facilitator has learned about this project's shape across design sessions
(`docs/reference/agent-memory.md` documents the schema and why). One line per entry, always
loaded — keep it short.

Write a new entry when a session hit something non-obvious about *this* project: an assumption that
turned out false, a library behaving unlike its docs, a boundary that looked clean and wasn't, or a
critique technique (Phase 4/5 of `prompts/design-facilitator.md`) that surfaced a real flaw or missed
one the human later caught. Don't write one for a routine session.

- [JDT LS is stale until told](jdtls-stale-until-told.md) — it ignores on-disk edits and answers confidently wrong; both of this system's silent failure modes look like an empty result
- [An echoed input cannot falsify](echoed-input-cannot-falsify.md) — the coordinate converter's likeliest bug is self-inverse, so a result field echoing the request passes the astral fixture while hovering the wrong token
- [A permissive clause is not coverage](permissive-clause-is-not-coverage.md) — a commitment named only on the permissive side of an invariant's `or` has no falsifier; it greps clean and covers nothing
- [Wording drift can pass oracles](wording-drift-can-pass-oracles.md) — a passing oracle can still cite an invariant whose literal rule differs
