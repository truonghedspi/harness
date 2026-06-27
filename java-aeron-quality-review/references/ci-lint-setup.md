# CI / lint setup for Java + Aeron quality enforcement

Reviews fix the present; guardrails protect the future. Recommend these when the user wants a class
of issue to stop recurring — especially the determinism rules, which must survive staff turnover.
Tune versions to the project's build (Maven/Gradle) and JDK.

## The three tools and what each is good at

- **ErrorProne** (compile-time, Google) — best signal-to-noise for *bug* patterns; runs as a javac
  plugin so it fails the build. Strong for concurrency, equals/hashCode, format strings, and—via
  custom checks—banning forbidden APIs.
- **SpotBugs** (bytecode analysis) + the **fb-contrib** and **find-sec-bugs** plugins — catches
  null-deref, resource leaks, and security issues (deserialization, crypto, injection). find-sec-bugs
  is the security workhorse.
- **Checkstyle** — style/consistency and some structural rules (method length, cyclomatic complexity,
  import hygiene). Lowest value for bugs; useful for keeping the codebase uniform.

Start with ErrorProne + SpotBugs/find-sec-bugs (real defects); add Checkstyle if the team wants
enforced style.

## Banning forbidden APIs (the determinism guardrail)

The highest-value Aeron guardrail is a rule that **fails the build if service-logic code calls
wall-clock/random/threading APIs**. Two practical ways:

### Option A — ErrorProne `BanForbiddenApis` style custom check / `@RestrictedApi`
ErrorProne supports `@RestrictedApi` and custom `BugChecker`s. A custom check can flag
`System.currentTimeMillis`, `System.nanoTime`, `Math.random`, `UUID.randomUUID`,
`Instant.now`, `new Thread`, etc. when the enclosing class is in the cluster service package.

### Option B — `forbidden-apis` (Policeman's Forbidden APIs) — simplest to adopt
A standalone Maven/Gradle plugin (`de.thetaphi:forbiddenapis`) that fails the build on configured
signatures. A signature file scoped to the service module:

```
@defaultMessage Non-deterministic in Aeron Cluster service logic — use cluster-supplied time / ids
java.lang.System#currentTimeMillis()
java.lang.System#nanoTime()
java.util.Random#<init>()
java.util.UUID#randomUUID()
java.util.concurrent.ThreadLocalRandom#current()
@defaultMessage No thread/async in service logic — it is single-threaded and must not block
java.lang.Thread#<init>(java.lang.Runnable)
java.util.concurrent.CompletableFuture#supplyAsync(java.util.function.Supplier)
```

Apply it only to the service module/package (not bootstrap or test code) so legitimate cold-path
usage isn't blocked. This is usually the fastest win.

## Allocation / hot-path enforcement
Static rules are weaker here (allocation isn't always wrong — only on the hot path). Better
guardrails:
- **JMH micro-benchmarks** in CI on the critical handlers, with a regression threshold.
- **Allocation assertions in tests** — e.g. JOL or an allocation-counting harness asserting the hot
  handler allocates zero bytes per message.
- Run benchmarks on a quiet, pinned machine; latency numbers from a noisy CI runner are misleading.

## CI wiring
- Run ErrorProne + SpotBugs + forbidden-apis on every PR; **fail** the build, don't just warn —
  warnings get ignored.
- Run the JMH/allocation regression gate on a schedule or pre-merge (it's slower).
- Keep determinism/snapshot/replay integration tests (see `aeron-checklist.md`) in the same pipeline
  — they catch what static analysis structurally cannot.
