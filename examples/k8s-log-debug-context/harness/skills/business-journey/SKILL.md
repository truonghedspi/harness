---
name: business-journey
description: Design and verify full business journeys across deployed microservices. Use whenever a feature describes an end-to-end user/business flow, Cucumber/Gherkin acceptance scenario, command-to-event journey, distributed state convergence, or fault/retry behavior across service boundaries.
---

# Business journey capability

Turn a business rule into an executable journey against public system boundaries. The purpose is
not merely to make every service return green; it is to prove that the distributed system converges
to the business outcome without duplicate or missing effects.

## Workflow

1. Read `business-environment.json`, `services.manifest.json`, and the requirement. If the
   environment checker is red, fix/ask for the missing deployment fact before authoring scenarios.
2. Name the public input seam (HTTP, gRPC, FIX, or message contract) and public observation seams
   (events and query APIs). Database/internal calls are diagnostics only.
   Implement those seams behind the test SDK described in `references/driver-contract.md`.
3. Write one journey oracle under `business-oracles/`. Start with the smallest happy-path tracer
   bullet; add failure/recovery slices only after it runs red then green.
4. Use Cucumber only when business stakeholders benefit from approving Given/When/Then. Read
   `references/cucumber-profile.md` then. Otherwise use the project's native test runner and keep
   the same oracle schema.
5. Run `node skills/business-journey/scripts/check-business-journey.mjs --environment
   business-environment.json --oracles business-oracles` before deploying.
6. Run the journey through `tools/k8s-test-env.sh --services services.manifest.json -- <command>`.
   The script owns namespace lifecycle; the journey runner owns only public test traffic.
7. Prove isolation by running two different run IDs concurrently. Prove idempotency by repeating a
   command/fault. A fixed namespace, consumer group, topic, account or order ID is a failed proof.
8. On timeout collect the oracle's named diagnostics. Never turn a diagnostic database read into
   the passing assertion.

## Required artifacts

- `business-environment.json`: isolation, seed, readiness, cleanup and telemetry ownership.
- `business-oracles/*.json`: public input, correlated observations, invariants, deadlines,
  diagnostics and optional fault probe.
- Executable scenario code inside the project's test framework. The JSON is a contract and checker
  input, not a substitute for the test.

The schemas are in `schemas/`. The deterministic checker catches missing public seams, fixed
isolation identifiers, `sleep`-based waiting, database assertions, absent convergence deadlines,
non-idempotent cleanup and a fault probe with no recovery invariant.

## Report

Report the run ID and isolation mode; deployed services and readiness duration; scenario/event-wait
duration; command/event correlations; invariants checked; retry/fault outcome; diagnostics path;
and teardown outcome. Never report business payloads or credentials in telemetry.
