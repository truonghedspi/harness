# Constraints — {{PROJECT_NAME}}

Hard rules the agent must not violate (Lesson 3/4). Keep these few, absolute, and — where
possible — mechanically enforceable (a lint rule or a check in `init.sh` beats a sentence here).

## MUST

- MUST run `./init.sh` to green before claiming any feature done.
- MUST keep one feature `active` at a time (WIP = 1).
- MUST record verification evidence in `feature_list.json` before a feature becomes `passing`.
- MUST stop and set `status: blocked` (with a reason in `checkerNotes`) once a feature's
  `attempts` reaches its `maxAttempts` — a timebox, not a suggestion. A hard problem retried
  forever with no budget is how a loop silently burns unbounded time/compute on one feature.
- MUST give every long-running or integration-level test a bounded, stack-appropriate per-test
  timeout mechanism (e.g. JUnit `@Timeout`/`@InterruptAfter`, pytest-timeout, `go test -timeout`,
  a `[Timeout]` attribute in .NET) — a single hung test must not be able to consume the whole
  `./init.sh` baseline timeout budget, and must fail loud and fast instead of hanging silently.
- [Project-specific MUST rules — e.g. respect module dependency direction, use fixed-point money]

### Spending human attention (the one scarce resource)

- MUST climb the exhaustion ladder before anything costs a human: registry → memory → environment
  → **spike** → prototype (`docs/reference/human-attention.md`). A fact you cannot read you can
  often prove; two minutes of spike has already beaten a week of reasoning in a real project.
- MUST ask when a question survives the ladder. Over-asking costs annoyance; under-asking produces
  a wrong system that passes every test. When unsure, spend two more minutes exploring, then ask.

### Working with files and documents (applies to every agent, every session)

- MUST keep every knowledge document **≤300 lines**. Past that an agent skims it and acts on a
  partial reading while believing it read the whole thing — a failure that raises no error.
- MUST split an over-budget document the way it grew: a **topic doc** into sections, keeping the
  original filename as a map so existing links still resolve; an **append-only log** by rotating
  closed periods into a frozen, dated archive. Method: `docs/reference/knowledge-layout.md`.
- MUST add every new document to `docs/INDEX.md` with a *"read it when"* line. An indexed archive
  directory is exempt from the size budget — you follow its index to one entry instead of reading
  it through.

## MUST NOT

- MUST NOT use `blocked` as a way to avoid asking (enforced: `verify-harness` `escalation-without-evidence`). A blocked feature nobody is asked about is a
  question with the human removed from it — escalate it as a question instead.
- MUST NOT guess an answer that belongs to a human. Once written down, a guess is indistinguishable
  from a verified fact, and every feature built on it inherits the error while passing its tests.
- MUST NOT split a document without adding it to `docs/INDEX.md` (enforced: `verify-harness` gate `docs`) — scattered files with no map
  are harder to use than the one long file they replaced.
- MUST NOT let the worker set `status: done` — only the checker or a verification script does
  (enforced: `verify-harness --promote` refuses past any blocker; the checker agent is write-restricted).
- MUST NOT modify files outside the active feature's scope.
- MUST NOT weaken a test or a vector to make it pass.
- MUST NOT set `status: blocked` without a concrete reason (enforced: `verify-harness` `blocked-unjustified`) in `checkerNotes` (or a matching
  `DECISIONS.md` entry) — an unexplained `blocked` is indistinguishable from an agent quietly
  giving up, and the checker/loop cannot judge whether it's legitimate.
- [Project-specific MUST NOT rules — e.g. no network calls in unit tests, no writes to prod]

## Enforcement

For each rule above, note how it is checked (Lesson 10 — turn rules into executable checks):

| Rule | Enforced by |
|---|---|
| Baseline green | `./init.sh` |
| WIP = 1 | review / `feature_list.json` state |
| Attempts timebox respected | `verify-harness.mjs` (flags `attempts >= maxAttempts` with `status` still not `blocked`) |
| Long-running tests have a bounded timeout | code review / checker spot-check |
| `blocked` has a real reason | `verify-harness.mjs` (flags empty `checkerNotes` with no matching `DECISIONS.md` mention) |
| [rule] | [lint rule / script / check] |
