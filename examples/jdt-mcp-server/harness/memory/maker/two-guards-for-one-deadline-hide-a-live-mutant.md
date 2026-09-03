# Two layers guard for the same time limit so that mutants can survive while the oracle remains green

**When to apply:** Any component has a deadline that is tightened in more than one place —
readiness-gate, lsp-client, every poll loop has its own timeout for each request. Meet at
`feat-readiness-gate`, turn 1.

## Symptoms

Mutant targets the correct falsifier of `INV-READY-3` — remove `settleBy(probe, at)` and `await` directly into probe —
runs out **6/6 green**. It's not that the oracle wrote carelessly: the other four cases all killed other mutants as designed.

## Root cause

The implementation of deadline tightening is in two independent places:

1. loop in `awaitReady` races probe to caller's deadline (`settleBy`);
2. `#probeOnce` clamps the request's own `timeoutMs` to `min(probeTimeoutMs, at - Date.now())`.

With the default probe, layer 2 alone is enough to do all settlements on time, so removing layer 1 doesn't change the behavior.
observable. Oracle isn't weak — it just doesn't have any cases going through the area that **only layer 1** covers.

That zone is real and dangerous: `probe` is an injectable parameter (`ReadinessGateOptions.probe`), so a
probe provided by another component has the discretion to ignore `timeoutMs`. At that time, only class 1 remained to keep their promise
`INV-READY-3`, and the mutant correctly deleted it.

## Rule of thumb

When a mutant targets the right falsifier and still lives, **don't rush to conclude that mutants are equivalent**. Ask back:
Is the deleted mechanism the only mechanism that keeps that invariant? If not, find the input as the remaining mechanism
lapse again — usually at the exact seam where the component allows injection from outside — then write a shift for it
correct input. The new case here is an injected probe that never settled and intentionally ignored the budget
time; Rebuilding the mutant will cause the case to hang and be canceled by `node --test`, meaning the mutant is captured.

Signs of reading results: `node --test` reports suspended mutant with `pass N / canceled M` attached
`Promise resolution is still pending but the event loop has already resolved`, not equal
an `ERR_ASSERTION`. That's still valid red evidence for a constant about "must settle in due course" —
hanging is the behavior that immutability prohibits.