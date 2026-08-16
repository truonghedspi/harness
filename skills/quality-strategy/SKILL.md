---
name: quality-strategy
description: Build and review risk-driven test portfolios. Use whenever a capability, business journey, test plan, integration suite, CI stage, or test-size decision is created or changed; keep capability/attribute risks traced to executable oracles and classify test scope separately from execution size.
---

# Risk-driven quality strategy

Use `test-risk.json` as a living decision surface, not a prose test plan and not a coverage target.

1. Read the requirement, component map, public seams, `feature_list.json`, and existing oracles.
2. Name user-visible capabilities. For each, record the components involved and the quality
   attributes whose failure matters: correctness, availability, latency, security, privacy,
   recoverability, compatibility, or usability.
3. Ask humans only for consequence, likelihood, detectability, stakeholders, and risk appetite.
   Provide source evidence and retain `answeredBy`; do not infer business impact from source code.
4. Map every material risk to one or more executable oracle IDs. High consequence/likelihood or
   low detectability needs an oracle; a coverage percentage is not a substitute.
5. Classify each verification on two independent axes:
   - `scope`: unit, component, contract, or journey — what behavior the test covers.
   - `size`: small, medium, or large — resources and scheduling constraints.
6. Prefer the smallest test that answers the risk. Do not relabel a cross-service journey as small
   because it runs quickly. Small has no network/shared state; medium may use localhost on one
   machine; cluster/external dependencies are large.
7. Run `node skills/quality-strategy/scripts/check-quality-strategy.mjs`. Fix the typed finding,
   never a number target. Revisit the register when components, capabilities, or oracles change.

Read `references/google-concepts.md` when explaining why the model separates responsibilities,
risk, scope, size, testability, and signal health. The harness preserves responsibilities rather
than copying historical Google job titles or a fixed test pyramid ratio.
