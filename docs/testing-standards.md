# Testing Standards — Harness

Only a full pipeline run counts as real verification (Lesson 10). Unit tests are systematically
blind to defects that only appear across boundaries — interface mismatch, state propagation,
resource lifecycle, environment dependency, and — in a microservice system — the *contracts
between services*. Verification is a **three-level hierarchy**, and any change that crosses a
service boundary requires all three.

## Level 1 — Unit

- Scope: a single function/module in isolation.
- Command: focused Node fixture/checker commands under the affected capability pack.
- Blind to: anything that only appears when components are wired together.

## Level 2 — In-Service Integration

- Scope: two or more components inside a single service, across their real internal boundary
  (DB, cache, internal modules).
- Command: `node harness-loop/scripts/verify-harness.mjs --target <fixture>` for a focused target.
- Catches: interface mismatches, serialization, state that doesn't propagate within a service.

## Level 3 — Microservice Integration (cross-service / contract)

- Scope: the interaction **between microservices** exercised the way they actually call each
  other — service-to-service HTTP/gRPC, published/consumed events and messages, and the
  **contracts** on those boundaries (request/response schema, event shape, error semantics).
- Command: `bash harness-loop/scripts/demo.sh`; it scaffolds and mutates disposable targets to
  exercise the full installation/verification contract. If Docker isn't available but
  Kubernetes + Helm are, see `docs/reference/k8s-integration-testing.md` (copied in when adopting the harness-loop k8s template) for a
  namespace-per-run Helm deploy/test/teardown script (`tools/k8s-test-env.sh`) instead of
  Testcontainers/Compose.
- Required for: any change that touches a service boundary — a changed endpoint, a new event, a
  modified payload. This is the level that catches "each service passes its own tests but they
  don't agree on the wire." Never skip it to save time; a passing per-service suite on a broken
  contract is the classic false green.

## Level 4 — Distributed Business Journey

- Scope: a business command through all participating services until public events and query
  projections converge, including retry/fault behavior for critical flows.
- Contract: `business-environment.json` plus `business-oracles/*.json`, validated by
  `skills/business-journey/scripts/check-business-journey.mjs`.
- Execution: `tools/k8s-test-env.sh --services services.manifest.json -- <journey command>`.
- Boundary: public input and observation only. SQL/repositories/pods are diagnostics, not passing
  assertions. Cucumber is optional when stakeholders need executable Given/When/Then.
- Required for: a business outcome spanning three or more independently deployed services, or one
  whose correctness depends on distributed convergence/idempotent recovery.

## Rule

A feature's `verification` in `feature_list.json` must exercise the highest level its change
touches. "Unit tests pass" is not "done" for cross-service work — the contract must be verified.
When a review comment recurs, promote it into an automated check here (Review Feedback
Promotion) so the harness self-strengthens. Prefer consumer-driven contract tests where you can,
so a producer change that breaks a consumer fails fast in the pipeline.

## Scope is not execution size

Levels 1–4 above describe **scope/fidelity**. Separately classify resource constraints in
`test-risk.json`: `small` has no network/shared state and is hermetic; `medium` may use localhost
on one machine; `large` covers cluster/external execution and therefore requires an owner, bounded
timeout, non-shared isolation, cleanup evidence and postsubmit/staging placement. A fast cluster
journey is still large. Use risk to choose the smallest test that answers the claim; do not enforce
a fixed pyramid ratio or use coverage percentage as a quality target.

Run `node skills/quality-strategy/scripts/check-quality-strategy.mjs` for risk-to-oracle
traceability and scope/size safety.

## Where a verification lives

**Proof belongs inside one of the three levels above, run by this project's test framework.**

The `verification` field demands a runnable command and says nothing about where that command may
live, so the cheapest way to satisfy it is a one-off script — `node -e "..."`, or a `check-thing.mjs`
dropped at the repo root. That passes every gate and is not a test: no test run executes it again,
no one maintains it, and it is invisible to coverage. The harness itself models the bad habit —
most of its own machinery is `.mjs` — so it is worth saying out loud that *harness tooling* and
*proof of a feature* are different things.

**A one-off verification script is a smell that a level is missing.** If the claim is about one
unit, it is a Level 1 test. If it crosses a service boundary, it is Level 3. If it genuinely is
project machinery rather than proof — an environment check, a generator — commit it under `tools/`
and index it, so it is maintained rather than abandoned.

`verify-harness.mjs` reports `verification-outside-test-framework` for the three shapes with no
home: an inline `node -e`, a script that is not committed, and a script living outside `tools/`.
