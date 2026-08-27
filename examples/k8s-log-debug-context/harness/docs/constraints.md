# Constraints — Kubernetes Log Debug Context

Hard rules the agent must not violate (Lesson 3/4). Keep these few, absolute, and — where
possible — mechanically enforceable (a lint rule or a check in `init.sh` beats a sentence here).

## MUST

- MUST run `./harness/init.sh` to green before claiming any feature done.
- MUST keep one feature `active` at a time (WIP = 1).
- MUST record verification evidence in `harness/feature_list.json` before a feature becomes `passing`.
- MUST treat `attempts` as failed checker review cycles, never as maker checkpoints. On a rejection,
  the checker increments it and sets `status: blocked` with a reason when it reaches `maxAttempts`.
  This timeboxes repeated failed claims without punishing safe partial commits before a claim exists.
- MUST give every long-running or integration-level test a bounded, stack-appropriate per-test
  timeout mechanism (e.g. JUnit `@Timeout`/`@InterruptAfter`, pytest-timeout, `go test -timeout`,
  a `[Timeout]` attribute in .NET) — a single hung test must not be able to consume the whole
  `./harness/init.sh` baseline timeout budget, and must fail loud and fast instead of hanging silently.
- MUST compile custom service code with `maven.compiler.release=21`; the build may run on a newer
  JDK, but emitted bytecode and APIs must remain Java 21 compatible.
- MUST keep red-first tests under the `contract` test package and run them through the explicit
  `-Poracle-test -Dtest=<ContractTest>` feature command. The default Maven baseline MUST still run
  all implemented-feature tests and MUST NOT suppress failures from them.
- MUST redact configured sensitive fields before any record crosses the OpenSearch adapter boundary.
- MUST keep MCP operations read-only and enforce the query budgets recorded in X-006.

### Spending human attention (the one scarce resource)

- MUST climb the exhaustion ladder before anything costs a human: registry → memory → environment
  → **spike** → prototype (`harness/docs/reference/human-attention.md`). A fact you cannot read you can
  often prove; two minutes of spike has already beaten a week of reasoning in a real project.
- MUST ask when a question survives the ladder. Over-asking costs annoyance; under-asking produces
  a wrong system that passes every test. When unsure, spend two more minutes exploring, then ask.

### Working with files and documents (applies to every agent, every session)

- MUST keep every knowledge document **≤300 lines**. Past that an agent skims it and acts on a
  partial reading while believing it read the whole thing — a failure that raises no error.
- MUST split an over-budget document the way it grew: a **topic doc** into sections, keeping the
  original filename as a map so existing links still resolve; an **append-only log** by rotating
  closed periods into a frozen, dated archive. Method: `harness/docs/reference/knowledge-layout.md`.
- MUST add every new document to `harness/docs/INDEX.md` with a *"read it when"* line. An indexed archive
  directory is exempt from the size budget — you follow its index to one entry instead of reading
  it through.
- MUST write `harness/progress.md`/`harness/DECISIONS.md` entries as short factual bullets — what changed, what
  state now — never prose narrative. Reasoning belongs in a memory entry or design doc, not the
  state log.
- MUST check the existing toolbox before writing a new script to inspect state: `node
  harness/loop/route.mjs`, `harness/tools/loop-status.mjs`, `harness/tools/feature.mjs <id>`, `harness/tools/timeline.mjs`,
  `harness/tools/memory-query.mjs`, `harness/tools/verify-harness.mjs`, `harness/tools/run-report.mjs`. A one-off `node -e`
  check is the same waste as a throwaway script — reach for these first.

## MUST NOT

- MUST NOT use `blocked` as a way to avoid asking (enforced: `verify-harness` `escalation-without-evidence`). A blocked feature nobody is asked about is a
  question with the human removed from it — escalate it as a question instead.
- MUST NOT guess an answer that belongs to a human. Once written down, a guess is indistinguishable
  from a verified fact, and every feature built on it inherits the error while passing its tests.
- MUST NOT split a document without adding it to `harness/docs/INDEX.md` (enforced: `verify-harness` gate `docs`) — scattered files with no map
  are harder to use than the one long file they replaced.
- MUST NOT let the worker set `status: done` — only the checker or a verification script does
  (enforced: `verify-harness --promote` refuses past any blocker; the checker agent is write-restricted).
- MUST NOT modify files outside the active feature's scope.
- MUST NOT weaken a test or a vector to make it pass.
- MUST NOT set `status: blocked` without a concrete reason (enforced: `verify-harness` `blocked-unjustified`) in `checkerNotes` (or a matching
  `harness/DECISIONS.md` entry) — an unexplained `blocked` is indistinguishable from an agent quietly
  giving up, and the checker/loop cannot judge whether it's legitimate.
- MUST NOT access production namespaces; collection and Kubernetes journeys are limited to labeled,
  disposable test namespaces.
- MUST NOT require a locally installed Maven; the checked-in `./mvnw` is the canonical build entry.

## Enforcement

For each rule above, note how it is checked (Lesson 10 — turn rules into executable checks):

| Rule | Enforced by |
|---|---|
| Baseline green | `./harness/init.sh` |
| WIP = 1 | review / `harness/feature_list.json` state |
| Attempts timebox respected | `verify-harness.mjs` (flags `attempts >= maxAttempts` with `status` still not `blocked`) |
| Long-running tests have a bounded timeout | code review / checker spot-check |
| `blocked` has a real reason | `verify-harness.mjs` (flags empty `checkerNotes` with no matching `harness/DECISIONS.md` mention) |
| Java 21 compatibility | Maven compiler `release` property and Enforcer rule |
| Real test suite | Surefire `failIfNoTests=true` and `BaselineTest` |
| Red-first oracle isolation | Surefire default `contract` package exclusion plus explicit `oracle-test` profile in each prove-feature verification |
| Maven reproducibility | checked-in `./mvnw` pinned to Maven 3.9.11 and SHA-512 |
