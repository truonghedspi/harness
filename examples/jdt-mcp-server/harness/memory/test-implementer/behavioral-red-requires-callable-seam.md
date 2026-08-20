# Behavioral red requires a callable seam

## Observation

`feat-prove-pool-crash-handling` was routed to the test implementer before either
`feat-lsp-client` or `feat-workspace-pool` exposed a callable interface. Its validated conditions
require starting a real child, placing requests in flight, killing that child, and observing all
pending promises.

## Evidence

- `node harness/tools/feature.mjs --deps feat-prove-pool-crash-handling` reported both dependencies
  `not-started`.
- The workspace contained no `src/` files or other interface declarations for those components.
- A test written at that point could fail only through a missing import, missing fixture, or an
  invented test-only substitute, none of which falsifies `INV-POOL-3`.

## Rule for later runs

Before implementing a cross-component red-first oracle, confirm the dependency interfaces needed
to create and observe the condition exist. If they do not, record the dependency blocker and stop;
do not treat compilation or fixture failure as red evidence and do not invent production APIs from
the test role.
