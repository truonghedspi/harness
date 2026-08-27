---
name: mcp-policy-needs-auth-and-surface-seams
description: JWT admission and an exact tool list require separate MCP wire invariants; read-only and bounds cannot stand in for either.
metadata:
  type: lesson
  date: 2026-08-26
---

X-007 and feat-007 initially named Kubernetes ServiceAccount JWT authorization and two MCP tools,
but their only invariant citations covered budgets and side effects. That left valid, missing, and
invalid caller outcomes, and the absence of an extra read tool, untestable without false
traceability.

**Why:** rejecting a bad token is a pre-dispatch admission property, while an exact public surface
is a capability-negotiation/set-equality property. A server can satisfy read-only and every budget
while failing either.

**How to apply:** state separate invariants and wire seams: HTTP result plus dispatch/index counts
for JWT admission, then initialize/`tools/list` plus rejected-unlisted-tool counts for the closed
surface. Do not let test design cite a nearby invariant merely because the same server owns it.
