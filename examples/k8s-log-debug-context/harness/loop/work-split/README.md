# Work-split plans — one file per feature that a parallel maker iteration is planned for

`<feat-id>.json` holds a `work-split/1` plan: the disjoint slices a single feature's implementation
step is cut into, the interfaces every slice codes against, and the one verification the integrator
runs afterwards. Written by the maker acting as lead, admitted by
`node harness/tools/work-split.mjs validate <feat-id>`, read by `harness/loop/route.mjs` and `harness/tools/guard-write.mjs`.

`<feat-id>.<slice-id>.json` holds one slice's outcome, written only by that slice's own worker.
The status lives in its own file rather than as a field in the plan for the same reason the slices
have disjoint paths: several workers finishing at once would otherwise read-modify-write one file,
and the completion that landed second would be the one that survived. `work-split-log.jsonl` beside
this directory is the append-only audit trail of the same transitions.

A plan is state, not scratch work: commit it with the iteration it drove. An empty directory means
every feature so far has been advanced serially, which is the normal case — a split earns its
overhead only when the step genuinely has two or more independent file sets.

Shape:

```json
{
  "kind": "work-split/1",
  "feature": "feat-x",
  "contractDigest": "<node harness/tools/review-contract.mjs feat-x --json>",
  "sharedContracts": ["OrderGateway.submit() @ src/api/order-gateway.ts"],
  "integration": { "verification": "<the feature's own verification, exactly>" },
  "slices": [
    {
      "id": "s1",
      "intent": "<what this slice builds, in enough detail to start without asking>",
      "acceptance": "<what makes this slice done>",
      "paths": ["src/api/**", "test/unit/api-*.spec.ts"],
      "mustRead": ["harness/docs/design/order-flow.md#seam", "src/api/types.ts"],
      "verification": "<this slice's own narrower command>"
    }
  ]
}
```
