# Coverage Checklist

Read this before mechanical extraction (Phase 1). It is the catalogue of things that count as a branch or a side effect. Missing a category here is how a flow ends up under-documented. Hunt for each item across the in-scope code; for each found, log a location.

## Branching constructs (control flow)
- [ ] `if` / `else if` / `else`
- [ ] `switch` / `case` / `default` (and the absence of `default` is itself a branch)
- [ ] Ternary `a ? b : c`
- [ ] Pattern match / `when` / `match` arms
- [ ] Guard clauses and early `return` / `break` / `continue`
- [ ] Loop conditions and loop-empty vs loop-runs cases
- [ ] Null / undefined / empty / zero checks (each is a branch)
- [ ] Boundary comparisons (`<`, `<=`, `==`, `>=`, `>`) — note exact boundary values
- [ ] Boolean combinations (`&&`, `||`) — short-circuit paths
- [ ] Optional / Maybe / Result unwrapping (present vs absent)
- [ ] Default parameter values and fallbacks (`?? default`, `|| default`)

## Business & validation rules
- [ ] Field-level validation (format, length, range, required)
- [ ] Cross-field / cross-entity rules (e.g., "discount only if member")
- [ ] Eligibility / permission / authorization checks
- [ ] Feature flags / toggles / A-B branches
- [ ] Quota / limit / threshold checks
- [ ] Time/date-conditional logic (business hours, expiry, cutoffs)
- [ ] Money/rounding/currency rules

## Error & exception paths
- [ ] `throw` / `raise` sites and what triggers each
- [ ] `try/catch/finally` — what's caught, what's swallowed, what's rethrown
- [ ] Error return codes / Result.Err / negative responses
- [ ] Validation-failure responses (which HTTP status / error body)
- [ ] Timeouts and their handlers
- [ ] Fallback / degraded-mode behavior
- [ ] Retry logic (count, backoff, what's retryable)
- [ ] Rollback / compensation / saga-undo on failure

## External integrations (each is a side effect + a success/failure branch)
- [ ] Outbound HTTP / gRPC calls (endpoint, when called)
- [ ] DB reads and writes (which tables, transaction scope)
- [ ] Cache reads/writes/invalidation
- [ ] Message/event publish (topic, payload, when)
- [ ] Message/event consume (topic, handler, ack/nack)
- [ ] File / blob / storage operations
- [ ] Third-party SDK calls (payment, email, SMS, etc.)
- [ ] For each: success path vs failure path vs timeout path

## State & lifecycle
- [ ] Every write to a status/state/phase field
- [ ] Allowed transitions vs rejected transitions
- [ ] Idempotency: what happens on a duplicate request/event
- [ ] Concurrency: locks, optimistic versioning, race conditions
- [ ] Ordering assumptions (does event order matter?)

## Enforced-elsewhere rules (not in the code, still real)
- [ ] DB constraints: NOT NULL, defaults, enums, unique, FK, CHECK `[db: …]`
- [ ] Config-driven behavior: retries, timeouts, flags, topic names `[cfg: …]`
- [ ] Infra/gateway: auth, rate limits, routing `[cfg/infra: …]`

## Cross-service completeness (for multi-service flows)
- [ ] Every outbound call's target service located (or marked ❓)
- [ ] Every published event's consumer(s) located (or marked ❓)
- [ ] No hop silently ends — boundary reached explicitly

## After extraction
- [ ] Total branch count recorded, broken down by family
- [ ] Each branch has a location
- [ ] Anything you couldn't trace is written as an open question, not omitted
