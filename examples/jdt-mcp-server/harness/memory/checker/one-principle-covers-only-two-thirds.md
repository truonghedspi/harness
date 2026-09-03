# A maker-stated oracle principle often covers only two-thirds of the cases

**When to apply:** Maker explains why a ca class must be more expensive ("Writable is injected without looking
see console.log, so these two cases run shim like a real child process"), then submit the mutant to prove it is correct
that class. Meet at `feat-mcp-shim` (2026-08-23).

## Trap

The explanation is correct, the mutant reappearance is correct, the expensive case is real. What no one checks: that principle
applied to **how many** of the positions that need it. In `mcp-shim` there are three calls to `log()` —
Normal noise line, broken auto-spawn line, reconnect/stop line. Two cases of sub-process cover two
head assembly. The third cluster, which also calls `log()` the thickest, has only in-process shifts — the right kind of shifts
which Maker himself just proved to be blind to `console.log`.

The quick catch: count the **call locations** of the mechanism that the rule protects (here `grep -c "log("`), then object
projection with a list of expensive shifts. The main difference is the mutant list that needs to be built. Three mutants
`console.log` on reconnect/stop both survived 7/7.

## The second, more serious trap: two redundant mechanisms supporting each other

The caption at the beginning of the file states "full message buffering is what makes reconnecting safe...restart
may corrupt the in-flight call but never corrupt the frame". There are actually **two** mechanisms at the same time
keep that assertion: `new LineFramer()` recreates in `attach()` each link, and `framer.flush()` in close
handler empties the buffer. Destroy them one by one and the mutant will survive — not because the oracle is good, but because of the good
The rest help. This is a variation of `redundant-fallback-masks-a-mutant.md`, but harder to see: two muscles
The mechanism lies in two different functions and neither function refers to the other.

Destroy **both at the same time**: spec is still green 7/7, while probe correctly builds the "daemon dies at once" scenario
message is only halfway through" shows that the response after restart is completely swallowed (stdout is empty,
client crashes). Derivation rule: when a comment asserts immutability, **count the number of mechanisms together
execute that sentence before designing the mutant**, then build an additional mutant that destroys the entire cluster. A living mutant
remaining on the redundant mechanism does not say anything; The whole surviving cluster is proof that the oracle is blind.

## Measure before asking

Two things were measured before writing REJECT, and both changed the verdict:

- Placing recorder on `process.stdout.write` in the body of the in-process run case **can** catch it
  `console.log`. Thanks to that the request becomes a cheap assertion, not requiring additional child processes.
- The branch that the `launch` port removed (daemon dies, no one replaces it, shims itself to the daemon shoulder) **run
  correct** in the current version. Thanks to that it comes down to a missing shift, not an implementation error — and
  The verdict did not blame Maker.