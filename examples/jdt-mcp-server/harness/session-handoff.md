# Session handoff — checker APPROVE closes feat-prove-routing at 3/3, one proven gap routed onward

## Verdict

`feat-prove-routing` is **done**. This was its third and final allowed attempt (3/3), so the verdict
was decisive: approve, or the feature goes to `blocked`. It survived a full independent check.

- Recorded verification re-run by the checker, unmodified:
  `npm run test:integration -- test/integration/project-router.integration.spec.ts` →
  7/7 pass (TCON-ROUTE-0001..0007), 179.6 ms, 0 fail / 0 cancelled / 0 skipped. The maker's green
  evidence reproduces exactly.
- `status` set to `done`, `readyForCheck` removed, evidence block kept. `feature_list.digest.md`
  regenerated (32 features; `feat-prove-routing` now shows **done** (3/3)).
- Verdict traced via `harness/tools/trace.mjs checker verdict feat-prove-routing`.

## Why the approval is not just "a green suite"

`TCON-ROUTE-0007` passed green on its very first run against unchanged source, so by itself it
proved nothing — a condition that has never been red is not evidence that it can go red. The checker
therefore reproduced, in a scratch copy of source + spec under `harness/trace/scratch/probe-route-0007/`,
the exact mutant that motivated the condition:

- **CONTROL** (unmutated copy): 7/7 green — the scratch copy is faithful.
- **M3** — `mavenRoots.find(({ isReactor }) => isReactor)` instead of `findLast(...)`, i.e. select
  the innermost enclosing reactor instead of the outermost. This is the mutant that survived the
  previous 6-condition suite. It is now killed, and `TCON-ROUTE-0007` is the **only** condition that
  kills it. The `outermost` clause of `INV-ROUTE-1` is genuinely proven.
- Condition-to-mutant assignment stays clean: **M1** (always outermost ancestor pom, `<modules>`
  check deleted) is killed by `TCON-ROUTE-0006` alone; **M2** (always nearest ancestor) by five
  conditions; **M13** (workspace id hashed from the argument rather than the project root) by five;
  **M14** (error message not naming the path) by `TCON-ROUTE-0005`; **M17** (stop the upward walk at
  the first pom-less directory) by six; **M19** (no nearest-ancestor fallback) by four.

No `R-T3` tautology (`outerReactorRoot` comes from the fixture and from the spec sentence, not from
re-deriving the code's directory walk) and no `R-T9` (the condition was derived from a mutant plus a
spec clause, not from the implementation's branches). The scratch probe was deleted; `git diff --stat src/`
is empty and `src/workspace/project-router.ts` is unchanged since commit 2503299. The oracle diff is
purely additive (+64 lines, zero deletions), so no earlier assertion was weakened.

## The one remaining gap — route as NEW scope, never as a fourth widening

A broader mutant sweep (run deliberately in this turn, so survivors surface all at once instead of
trickling one per review round) left one genuinely new survivor:

- **M12** — *if any ancestor is a reactor, take the outermost ancestor `pom.xml`, even when that pom
  itself declares no `<modules>`; otherwise take the nearest ancestor.* Survives all 7 conditions.
- It is **not** an equivalent mutant. Proven directly: for the tree `parent-pom-only/pom.xml`
  (`packaging=pom`, no `<modules>`) containing `reactor/pom.xml` (declares `<modules>`) containing
  `mod-a/`, the real implementation resolves `mod-a` to `parent-pom-only/reactor` while M12 resolves
  it to `parent-pom-only`.
- Root cause: `INV-ROUTE-1` says "the outermost enclosing ancestor `pom.xml` **that declares
  `<modules>`**". The qualifier clause is a separate axis from the superlative, and no fixture in
  `TCON-ROUTE-0001..0007` places a non-reactor `pom.xml` *above* a reactor root. Distinct from the
  gap `TCON-ROUTE-0006` closed (non-reactor above non-reactor) and from `TCON-ROUTE-0007` (reactor
  above reactor).

**Routing constraint for the feature-planner:** do **not** widen `feat-prove-routing` in place a
fourth time. It is closed at `attempts` 3/3 and the maker has no attempts left, so an in-place
widening would produce a feature that can never be judged again. Choose either a small new oracle
feature carrying `TCON-ROUTE-0008`, or an explicit accepted-risk row under `A-006` in
`harness/docs/assumptions.md`.

**Recommended shape, so this stops after one more round.** Three successive widenings each closed
exactly the axis they were ordered for and then exposed the next one. One condition closes the whole
selection predicate at once: a five-level ancestor chain — non-reactor top, reactor A (`<modules>`),
non-reactor middle, reactor B (`<modules>`), leaf module — where a path under the leaf module must
resolve to **reactor A**. That single row kills M3, M12, and every "just take the farthest ancestor"
variant together. After it lands, the checker's judgement is that the `INV-ROUTE-1/2/3` family is
solid and further FOLLOW-UP churn on routing should stop.

## Survivors that are already documented, not new gaps

- **Loosened `<modules>` regex** (`/modules/i`): the accepted risk recorded in design approval
  `3d68e0857fbfac45` — no real Maven model parser. Needs a `modules` substring inside a comment or a
  property to bite.
- **Dropped `realpathSync`**: out of scope while `X-005` is an open recommendation. The spec file's
  own header states it asserts nothing about symlink resolution. Worth an oracle only once X-005
  closes.
- **Dropped `statSync(...).isDirectory()` branch**: an equivalent mutant.
  `path.join(<file path>, "pom.xml")` never exists and the loop moves to the parent directory on the
  very next iteration, so behaviour is identical.

## Other open threads, unchanged by this turn

- `feat-prove-provisioner` — blocked/timeboxed at 3/3: the 13-case green replay still lacks a
  corrupt-download / checksum-rejection condition.
- `feat-lsp-client` — rejected at 1/4: still needs a bounded cross-process oracle that kills a
  spawned scripted child with requests in flight.
- `feat-project-router` — `done` and untouched throughout this sequence.
