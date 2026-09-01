# The baseline cache — paying for the gate once, not once per session

The baseline is a **start gate** (Lesson 6): before any feature work, `init.mjs` proves the project
still builds and its tests still pass. `run-loop.mjs` already runs it once per session rather than
once per iteration. The remaining cost is the one nobody measured: **every new session re-pays it
in full, even when nothing that feeds it has changed.**

That is not a rounding error. In `jdt-mcp-server` the provisioner replay takes **562 s** because
the clean-cache path really downloads a JDT LS distribution. Ten sessions in a day is an hour and a
half spent re-proving a fact that was already true.

The fix is a cache keyed on the gate's **inputs**, not on a clock.

## What the cache is allowed to be wrong about

Only one thing, and it must be wrong in one direction. A cache that hands back a stale green turns
the gate into decoration — the exact failure the gate exists to prevent, and one that hides itself,
because a green baseline is what everything downstream trusts. So every rule fails toward
**running**:

| Situation | Decision | Why |
|---|---|---|
| No `loop/baseline-cache.json` | run | opt-in. A project that has not thought about its inputs does not get a cache |
| `HARNESS_BASELINE_CACHE=0` | run | one escape hatch, no argument needed |
| Not a git work tree | run | the digest cannot enumerate what it cannot see |
| No baseline recorded yet | run | nothing to reuse |
| Recorded baseline is **red** | run | red is a claim about *now*; only a fresh run retires it |
| Recorded baseline has no `inputsDigest` | run | it predates the cache and belongs to an unknown tree |
| Digest differs | run | something the gate reads has changed |
| Recorded run older than `maxAgeHours` | run | bounds drift the digest cannot see (a rotated credential, an expired cache elsewhere) |
| Working tree too large to digest cheaply | run | refuse rather than make skipping the gate slow |

Reuse happens in exactly one case: a **green** run, recorded under a digest identical to the
current one, inside the age limit.

## What goes into the digest

- **Every file in the working tree**, by content — tracked and untracked-not-ignored, enumerated
  with `git ls-files`. Content rather than commit id, so an uncommitted edit can never pass as the
  committed state. Only the last run's digest is kept, so reverting an edit after an intervening
  run costs one extra run; that is the cheap direction to be wrong in.
- **Declared toolchain probes** — `node -v`, `./mvnw -v`, whatever the gate actually depends on. A
  green recorded under JDK 21 says nothing once the JDK is swapped, and no amount of file hashing
  sees that. A probe that fails to execute is itself a state change, so its failure goes *into* the
  digest rather than silently disabling the cache.
- **Nothing the loop itself rewrites.** `loop/baseline-state.json`, `loop/current.json`,
  `loop/route-log.jsonl`, `loop/approval*`, `trace/trace.jsonl` are ignored unconditionally. Left
  in, they would guarantee a miss on every run and the cache would be dead code that still pays the
  cost of looking.

## The policy file

`loop/baseline-cache.json`, written by the project — the harness never guesses it:

```json
{
  "schema": "baseline-cache/1",
  "enabled": true,
  "maxAgeHours": 24,
  "root": "..",
  "probes": ["node -v", "./mvnw -v"],
  "ignore": ["docs/"]
}
```

| Field | Default | Meaning |
|---|---|---|
| `enabled` | `true` | `false` disables without deleting the file |
| `maxAgeHours` | `24` | how long a green may be trusted at most |
| `root` | `..` when the tree is installed as `<project>/harness`, else `.` | the directory the gate actually builds |
| `probes` | `[]` | argv to run; their exit code and output join the digest |
| `ignore` | `[]` | extra paths (a trailing `/` matches a prefix) on top of the loop bookkeeping above |

Add to `ignore` anything the gate *writes* that git does not already ignore — otherwise the run
invalidates its own cache entry and you get a permanent miss.

## Reading the result

`loop/baseline-state.json` gains three fields on a cached session:

| Field | Meaning |
|---|---|
| `inputsDigest` | the tree and toolchain this verdict belongs to |
| `reusedAt` | when the loop last traded on it |
| `reuseCount` | how many sessions have done so |

`checkedAt` keeps saying when the gate **actually ran**. A reuse is recorded, never disguised as a
run — so "green" in a report can always be traced back to a real execution and its age.

Inspect the decision without running anything:

```bash
node loop/baseline-cache.mjs            # exit 0 = would reuse, 1 = would run, with the reason
node loop/baseline-cache.mjs --digest   # the current inputs digest
```

## What this deliberately does not do

- **It does not cache fixtures.** Downloading a dependency faster is the project's job (pin it,
  check its checksum, keep it out of `init.mjs`'s hot path). This caches the *verdict*.
- **It does not survive a red.** There is no "known flaky, skip it" mode.
- **It does not cache the end-of-session feature replay.** That replay is regression evidence about
  work the loop just did, so it always runs.
