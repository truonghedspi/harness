# Initializing an integration-test project

Use this workflow when the target is a new repository above several deployable services. It turns
repository facts plus human-owned operational/business decisions into an executable Level-3/4
test scaffold. It does not pretend source code contains production topology or business truth.

## Two phases, one checkpoint

```bash
node harness-loop/scripts/init-integration-project.mjs \
  --target /work/order-integration-tests \
  --roots /work/gateway,/work/matching,/work/trade-capture \
  --journey "accepted order becomes one matched trade"

# A human edits /work/order-integration-tests/answers.json

node harness-loop/scripts/finalize-integration-init.mjs \
  --target /work/order-integration-tests
```

Phase 1 inventories first and writes no harness scaffold. Phase 2 refuses incomplete or stale
answers before invoking `setup-harness-loop.mjs --integration`. This keeps an unanswered decision
from becoming a plausible default that later makes a test green for the wrong reason.

## Phase 1 outputs

Under `inventory/integration-context/`:

- `request.json` — immutable target, source roots and business outcome.
- `services.discovered.json` — cheap service/build/chart/image/rules inventory with source paths.
- `collection-plan.json` — what was materialized and what waits for scope decisions.
- `questions.json` — typed decision requests bound to the request digest.

At the target root:

- `integration-init-review.md` — human-readable review, ordered by context.
- `answers.json` — typed answer slots. Humans fill `value`, `answeredBy`, and optionally rationale.

## What makes a question information-rich

Every question carries:

1. A stable ID and context (`service-readiness`, `deployment-topology`, `public-input-seam`,
   `public-outcome-seams`, `test-data`, or `parallel-safety`).
2. The evidence already collected, including the service source and scoped rule pointers.
3. Why repository inspection cannot safely settle the decision.
4. A typed answer shape, required fields, bounded choices where possible, and a contextual example.
5. The suggested human owner and the concrete downstream artifact/feature it blocks.

The collector asks no question for a service field it already knows. `dependsOn: []` is a valid
answer; `null` is not. Health means an executable business-serving check, not Pod Ready. Journey
input and observations must be public interfaces. SQL, logs, and internal state remain diagnostics.

## Phase 2 outputs

Finalization checks the answer schema, request digest, provenance and per-question required fields,
then creates:

- `services.manifest.json` with human-resolved readiness/topology and decision provenance;
- `business-environment.json` with per-run isolation, public seed, readiness and cleanup;
- `business-oracles/initial-journey.json` with a public command, correlated public observations,
  a bounded convergence deadline and independent invariants;
- `inventory/integration-context/answer-receipt.json`, binding accepted question IDs to the request;
- the normal integration harness, K8s layer, feature graph and business-journey capability pack.

The generated oracle is a tracer-bullet contract, not a final claim about production. Review it,
then run `node tools/services-check.mjs` and the business-journey checker. Add fault authorization
as a later explicit decision; never infer permission to restart or partition company services.

## Collection boundary

The current vertical slice inventories repositories and asks evidence-rich questions. It does not
yet resolve OpenAPI/protobuf/event-schema dependency closure or inspect live Helm releases. Add
those as source-specific collectors behind the same plan/questions/receipt contract; summaries
remain indexes, while agents read the pinned originals needed by the chosen journey.
