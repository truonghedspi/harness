# The "invisible" inner layer is often exposed right at the injection port

**When to apply:** oracle patch after the checker lists the mutant as alive, and the checker himself acknowledges that
a mutant "does not require ca because the effect is not observable through the current seam". Meet at
`feat-readiness-gate`, pass 2, mutant RM8.

## Key takeaways

RM8 unclamps `Math.min(#probeTimeoutMs, Math.max(1, at - Date.now()))` in `#probeOnce`. Effects
according to the description — an abandoned request outlives the caller's budget — which is truly unmeasurable from the side
caller, because the caller has already been released on time by the outer `settleBy` class. But a lot of it is done by mutants
false **passed via a public gateway parameter**: `ReadinessGateOptions.probe` received
`ProbeOptions.timeoutMs`. Inject a probe, record `timeoutMs` each time it is given, then assert every time
budget is in `[1, caller limit]` while probe ceiling is 5000 ms — RM8 gives 5000 ms to a
call 150 ms and die immediately.

Takeaway rule: before accepting "unobservable", list every value that the **component confers
out** through the injectable port, not just the value it **returns**. A parameter passed to the collaborator
is the same public behavior as the return value, and it is often the only place the inner class is visible. Article
The condition for this assertion is not internal testing: the port must have been made public for another reason
(Here `probeSemanticIndex` is called directly by `feat-prove-sync`).

## Side lesson: suspended cases are weak evidence

Under mutant RM2, case 5 hangs for 10 seconds and then `node:test` cancels (`cancelled`) all subsequent cases. Mutant still
was killed, but the test said nothing about the remaining cases, and the message was just "test timed out".

How to fix it without weakening the case: keep all the old assertions, just replace `await` with no limit
`Promise.race` with a watchdog more than ten times longer than the term being tested, then add a "caller" assertion
still waiting after N ms". The invariant is checked unchanged, but the violation becomes a red line stating true
The names are invariant, and 0 cases are canceled so the same run can still measure other mutants.