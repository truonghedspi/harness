# Testing Standards — {{PROJECT_NAME}}

Only a full pipeline run counts as real verification (Lesson 10). Unit tests are systematically
blind to defects that only appear across boundaries — interface mismatch, state propagation,
resource lifecycle, environment dependency, and — in a microservice system — the *contracts
between services*. Verification is a **three-level hierarchy**, and any change that crosses a
service boundary requires all three.

## Level 1 — Unit

- Scope: a single function/module in isolation.
- Command: `[unit test command]`
- Blind to: anything that only appears when components are wired together.

## Level 2 — In-Service Integration

- Scope: two or more components inside a single service, across their real internal boundary
  (DB, cache, internal modules).
- Command: `[in-service integration command]`
- Catches: interface mismatches, serialization, state that doesn't propagate within a service.

## Level 3 — Microservice Integration (cross-service / contract)

- Scope: the interaction **between microservices** exercised the way they actually call each
  other — service-to-service HTTP/gRPC, published/consumed events and messages, and the
  **contracts** on those boundaries (request/response schema, event shape, error semantics).
- Command: `[microservice integration / contract test command — e.g. contract tests, a compose
  spin-up of the involved services, or a cross-service flow test]`. If Docker isn't available but
  Kubernetes + Helm are, see `docs/reference/k8s-integration-testing.md` (copied in when adopting the harness-loop k8s template) for a
  namespace-per-run Helm deploy/test/teardown script (`tools/k8s-test-env.sh`) instead of
  Testcontainers/Compose.
- Required for: any change that touches a service boundary — a changed endpoint, a new event, a
  modified payload. This is the level that catches "each service passes its own tests but they
  don't agree on the wire." Never skip it to save time; a passing per-service suite on a broken
  contract is the classic false green.

## Rule

A feature's `verification` in `feature_list.json` must exercise the highest level its change
touches. "Unit tests pass" is not "done" for cross-service work — the contract must be verified.
When a review comment recurs, promote it into an automated check here (Review Feedback
Promotion) so the harness self-strengthens. Prefer consumer-driven contract tests where you can,
so a producer change that breaks a consumer fails fast in the pipeline.
