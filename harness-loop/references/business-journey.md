# Distributed business journeys

Level 3 proves services agree on a boundary. Level 4 proves a business command crosses several
deployed services and converges to one externally observable outcome, including the failure path
whose retry could duplicate or lose that outcome.

## Five load-bearing pieces

1. `skills/business-journey/` packages the workflow, public test-driver boundary, optional Cucumber
   profile, schemas, deterministic checker and good/bad fixtures.
2. `business-environment.json` owns run ID derivation, namespace/data/consumer isolation, public
   seed, business readiness beyond Pod Running, idempotent cleanup and redacted metric names.
3. `business-oracles/*.json` binds a requirement to a public command, correlated public event/query
   observations, independently stated invariants, convergence deadline and timeout diagnostics.
4. A `faultProbe` names an environment-owned fault, same-command retry and recovery invariant.
   Scenario code never gains arbitrary cluster mutation just to perform the probe.
5. `k8s-test-env.sh` emits deploy/readiness/scenario/total duration and exposes a redacted detail
   file for event-wait/retry metrics. Payloads and credentials never enter telemetry.

Setup with `--integration` vendors the pack, writes a deliberately incomplete environment, creates
`business-oracles/`, and adds `feat-business-journey-contract` after `feat-registry`. The red start
is intentional: a collector cannot discover business-session readiness or the public fixture API.

## Cucumber boundary

Cucumber is useful for the small set of flows product, QA, operations or compliance must approve.
It sits above a project-specific business driver. Step definitions use verbs such as `placeOrder`,
`awaitTrade`, and `position`; they never expose SQL, pods, topics, offsets or sleeps. Native tests
remain preferable for combinatorial matching rules and infrastructure lifecycle.

## Capability evaluation

The paired order-match prompt was given to two fresh agents. The with-skill output passed the
checker with one oracle and zero findings. The baseline wrote thoughtful prose and public-seam
intent, but its artifacts missed the typed environment/oracle contract: the checker returned 17
findings including isolation/readiness/cleanup/telemetry, correlation/deadline/invariant and
diagnostics gaps. This is why the pack contains executable schemas/checks rather than advice only.

This evaluation did not mutate a cluster. Runtime proof still requires the target's real charts,
public fixture API and service endpoints; the harness must not invent those deployment facts.
