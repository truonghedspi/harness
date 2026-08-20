# INV-POOL-2's over-cap eviction is a different trigger than A-001's 15-min idle timer

A-001 (`docs/assumptions.md`) is confirmed as "cap of 3, evict LRU-idle **after 15 min**", which
reads at first glance like one policy: idle-timeout eviction. But `INV-POOL-2`'s own text
(`docs/design/runtime-model.md`) and `feat-prove-pool-lifecycle`'s context note ("use a small cap
fixture value... instead of waiting on the 15-minute idle window") make clear these are **two
distinct triggers on the same LRU-idle selection rule**:

1. A request beyond the cap → evict immediately (synchronous, `INV-POOL-2`'s territory).
2. A workspace sits idle for 15 minutes with no new request pressuring the cap → evict
   autonomously on a timer (A-001's other half; no `INV-` id names this timer mechanism
   anywhere in `runtime-model.md`'s INV-POOL table as of this pass).

Don't design a property/condition around the 15-minute timer under `INV-POOL-2` — that invariant's
observable seam is explicitly "process count under a burst of calls", not a clock. If a later pass
needs to test the timer-eviction behavior itself, that's either a genuine `spec_gap` (no INV- id
covers it) or belongs to whatever invariant a design update adds for it — don't stretch
`INV-POOL-2`'s scope to cover it, and don't invent a synthetic id for it.
