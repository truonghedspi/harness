# Feature context packets

A feature's `context.touches` is a routing hint, not a handoff. In the first Aeron lab it caused
the handoff agent to read the same design, architecture, test, codec, downstream example, build
file and state as the rediscovery agent. Naming what to reread preserved correctness but saved no
work.

## Contract

The feature planner may materialize `loop/context-packets/<feature-id>.json` and point
`feature.context.packet` at it:

```json
{
  "schema": "feature-context-packet/1",
  "objective": "Resolve the last R1 and first R2 logical log positions",
  "mustRead": ["src/main/RecordedEvent.java", "src/test/GapBoundaryResolverIT.java"],
  "facts": ["returned boundaries are decoded event log positions, not replay byte positions"],
  "mustNotRead": ["retention and day-index sources are outside this feature"],
  "sourceInputs": [{"path": "docs/design/gap.md", "sha256": "..."}]
}
```

Facts must be bounded implementation decisions already established by cited sources. The packet is
an index with conclusions, not a copy of those sources. `mustRead` contains the live code seam and
independent oracle that implementation must still inspect. `mustNotRead` is negative scope, not a
security boundary.

At dispatch, `context-plan.mjs` hashes every `sourceInput`. `agent-context.mjs` injects facts and
the live `mustRead` originals only when all inputs are current, and emits a typed
`context-receipt/1`. A stale or invalid packet is not injected as truth; the maker returns to the
cited sources and the planner refreshes it.

## Aeron paired result

Two fresh agents implemented the same `GapBoundaryResolver` against the same frozen real-Archive
integration test. Runs were serialized because concurrent Aeron suites contend for fixed ports.
Both implementations passed `./mvnw -q verify -Dit.test=GapBoundaryResolverIT`.

The rediscovery arm reported 11 deliberately read files plus repository-wide source searches. The
packet arm reported the packet, its two `mustRead` files, and the targeted feature state entry; it
did not reopen the cited design/cross-cutting sources. This is evidence that materialized facts can
remove repeat discovery without lowering this oracle's result.

The read counts remain agent-reported: the current trace does not capture Read/Grep/Glob events
(HI-029). Treat the direction as useful experimental evidence, not precise telemetry. One feature
and one runtime are insufficient to claim a general speedup.

## When to create one

Create a packet when design/planning discovered a non-obvious seam, invariant, API constraint, or
negative scope that the maker would otherwise rediscover. Omit it for obvious one-file work: packet
maintenance would exceed its context savings. Refresh it whenever a cited digest changes, and
promote only stable cross-feature lessons to agent memory; feature-local facts stay in the packet.
