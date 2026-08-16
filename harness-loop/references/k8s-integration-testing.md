# Kubernetes/Helm integration testing (no Docker)

**Opt-in, not scaffolded by default.** `setup-harness-loop.mjs` doesn't know whether a target is a
Kubernetes-deployed microservice, so this capability is a separate template tree
(`harness-loop/templates/k8s/`) you copy in deliberately — see "How to adopt" below. Use this
when a project's Level 3 test (`docs/testing-standards.md` — microservice integration/contract)
needs real cross-service behavior but the environment forbids Docker (so Testcontainers/Docker
Compose, the usual default for that tier, are not available) while Kubernetes + Helm charts are.

## The workflow (`tools/k8s-test-env.sh`)

One script, one contract: **deploy into an isolated namespace, wait for real readiness, run the
test command you give it, collect diagnostics BEFORE tearing anything down, then always clean
up** — matching the same "verify for real, don't trust a claim" spirit as the rest of this skill.

It takes either a single chart or a whole registry:

```bash
tools/k8s-test-env.sh charts/my-service -- ./run-tests.sh                       # one chart
tools/k8s-test-env.sh --services services.manifest.json -- ./run-tests.sh       # a system
tools/k8s-test-env.sh --services services.manifest.json --only api -- ./run.sh  # api + its deps
```

Multi-service mode installs in `dependsOn` order, refuses a dependency cycle before deploying
anything, gates each service on its own `health` command (and says `readiness UNVERIFIED` where the
registry has none — `--wait` alone only proves Running), and ranks the diagnostics by likely cause.
The registry and its fields: [multi-service.md](multi-service.md).

```
namespace = test-<short-git-sha>-<run-id>        # isolated per run, never reused
  ↓
helm upgrade --install <release> <chart> -n <namespace> --create-namespace --wait --timeout Ns
  ↓ (deploy failed / timed out)              ↓ (deploy succeeded)
  dump events + logs, exit 1                 run the test command against the namespace
                                              ↓
                                              dump events + logs regardless of test result
                                              ↓
                                              helm uninstall + delete namespace (always, via trap)
```

### Why namespace-per-run, on a SHARED cluster

A dedicated ephemeral cluster (kind/k3d-style) is usually built on Docker or needs its own VM
infra — often not worth it just for integration tests when a real cluster already exists. The
practical alternative that still gives full isolation: **one Kubernetes namespace per test run**,
named `test-<sha>-<run-id>` and labelled `harness-loop-test=true`. Two runs — a human's and an
agent's, or two agents' — never collide, because Kubernetes namespaces are cheap and
Role/RoleBinding scoping (below) keeps one run from ever seeing another's resources.

### Why collect diagnostics BEFORE teardown

The single most common mistake in this kind of script: tearing the environment down first, then
discovering the test output doesn't say WHY it failed. `kubectl get events` and pod logs are only
available while the namespace exists. `k8s-test-env.sh` always dumps
`kubectl get events --sort-by=.lastTimestamp` and the logs of every non-Ready pod into a report
directory *before* the teardown trap runs — this is what "the agent gets fast feedback" actually
means in practice: the failure signal has to survive past the moment the environment disappears.

### Bounded timeouts throughout

Every step (`helm --wait --timeout`, the test command itself, the diagnostic collection) has an
explicit timeout — matching `docs/constraints.md`'s bounded-timeout rule. A stuck `helm install`
waiting forever for a pod that will never become ready is exactly the kind of hang the
`attempts`/`maxAttempts` timebox exists to stop the maker from eating silently.

## MCP server: `containers/kubernetes-mcp-server`, read-only

Recommended over the wrapper-style alternatives because it talks to the Kubernetes API directly
(no `kubectl`/`helm` binary dependency for the MCP server itself — though your test scripts still
use the real CLIs), ships prebuilt binaries plus `npx`/`uvx` install paths (no Docker needed to run
it), and has first-class `--read-only` / `--disable-destructive` flags rather than being a
separate, less-maintained "read-only fork." It also surfaces `events`, which the dedicated
read-only alternatives (e.g. `mcp-kubernetes-ro`) currently don't — and events
(`FailedScheduling`, `BackOff`, `Unhealthy`, `FailedMount`) are usually the fastest signal of what
actually broke, faster than reading through logs.

```jsonc
// .kiro/settings/mcp.json (or wherever your MCP client reads config)
{
  "mcpServers": {
    "k8s-readonly": {
      "command": "tools/mcp-k8s-readonly-wrapper.sh",
      "args": [],
      "env": { "KUBECONFIG": "/path/to/kubeconfig" }
    }
  }
}
```

**Route through `tools/mcp-k8s-readonly-wrapper.sh`, don't call `npx kubernetes-mcp-server`
directly — a bare local-cluster kubeconfig can make the server crash before the MCP handshake
even completes.** Found via real use: a stopped local minikube doesn't just make the cluster
unreachable, it clears `current-context`/`clusters`/`contexts` from kubeconfig entirely (confirmed
behavior, not a fluke). `kubernetes-mcp-server` then exits immediately with "no current-context is
set" — before it can send an `initialize` response — which an MCP client reports as a bare
"connection closed: initialize response", giving no hint that the real cause is a stopped local
cluster. The wrapper checks for exactly that condition (no context at all) and starts a local
minikube itself first; a real shared/remote cluster's context persists in kubeconfig even when
unreachable, so the wrapper is a harmless pass-through in that case (confirmed: near-zero overhead
when the cluster is already up — it only blocks on `minikube start` for the cold-start case).

**Known caveat:** the cold-start path (cluster was stopped, wrapper starts it) takes as long as
`minikube start` does — 15-20s on a typical machine — before the MCP server can complete its
`initialize` handshake. If an MCP client's own handshake timeout is shorter than that, the first
connection attempt after a stop may still report a failure; reconnecting a moment later succeeds
because minikube is warm by then. There's no way to make `minikube start` itself faster from this
wrapper — this is a real cold-start cost, not a bug to chase further.

**Give the agent read-only cluster access by default.** The same generator/evaluator instinct
this whole skill applies to `feature_list.json` (the maker can't self-grade `done`) applies here:
an agent diagnosing a failed deploy needs to SEE pod state, not be able to `kubectl apply`/`helm
install` arbitrary things into a shared cluster. `k8s-test-env.sh` itself (a plain shell script,
not the agent) is what actually runs `helm install`/`uninstall` — scope the agent's own kubeconfig
or a RoleBinding to that namespace pattern only, and let the SCRIPT hold whatever write access it
needs, not the agent's own MCP session. If a project's loop genuinely needs the agent to deploy
directly (rare — usually the script should do it), that's a deliberate, separate decision, not the
default.

## Cleanup discipline (namespaces are cheap, forgotten ones are not)

`k8s-test-env.sh`'s teardown runs in a `trap ... EXIT`, so it fires even on a failed test or a
`Ctrl-C` — but a killed process (`kill -9`, an OOM, a CI runner that got torn down mid-run) can
still leak a namespace. Two safety nets:

1. Every namespace this script creates carries `harness-loop-test=true` and a `created-at`
   annotation — a cluster-side reaper CronJob (out of scope for this skill to provide; ask
   whoever owns the shared cluster whether one already exists) can sweep anything past a TTL.
2. `k8s-test-env.sh list-stale` (see the script's own `--help`) lists namespaces with that label
   older than a threshold, for a human to review before deleting by hand if no automated reaper
   exists yet.

## Local minikube/kind competes for RAM with heavy test suites — found via real use

If the cluster is a **local** minikube/kind on the same machine that runs the project's own JVM
(or otherwise memory-heavy) test suite — not the shared-cluster default this doc otherwise assumes
— its static memory footprint (minikube's `--memory` allocation is reserved for as long as it's
running, whether or not a test is deploying anything at that instant) can starve the test suite
enough to turn real, previously-passing tests into flaky timeouts. This surfaced on real use
(aeron-demo, 2026-08-07): a local 3 GB minikube running alongside `verify-harness.mjs
--run-features` replaying 16 embedded-MediaDriver/Archive/Cluster SIT commands sequentially
produced 3 failures (2 timeouts, 1 real-looking failure) that vanished completely once `minikube
stop` freed the RAM back — not a code regression, a resource-contention false alarm that looks
exactly like one if you don't know to check for it. **The cluster must be stopped before the
project's own heavy test suite runs, and started again only for K8s-targeted work** — don't run
both at once on a resource-constrained dev machine. This doesn't apply to the shared-cluster
default (the cluster's compute is remote, not competing with the local test JVM).

**This is the `k8s-integration-tester` agent's own job, not a step for a human to remember.** Its
prompt's Step 0 checks cluster reachability and starts a local cluster itself if it's down (a
host-level VM/container operation, not a Kubernetes API write — it doesn't cross the read-only
cluster-access boundary elsewhere in this doc), and its Step 7 stops it again once k8s-targeted
work for the session is done. A human should never need to run `minikube start`/`stop` by hand to
use this agent — if it asks you to, that's the prompt regressing, file it as a `layer: harness`
issue.

## How to adopt this in a scaffolded project

1. **Setup does the copy.** `setup-harness-loop.mjs --k8s auto` (the default) installs this tree
   when the target already holds a `Chart.yaml`; `--k8s on` forces it. Everything under
   `harness-loop/templates/k8s/` mirrors the target's own layout, and copying
   `prompts/k8s-integration-tester.md` is what *enables* the agent — it is `optional` in
   `agents.manifest.json`, and `gen-agents.mjs` emits an optional agent into both runtimes exactly
   when its prompt file exists. There is no separate config to hand-write.
   **Also copy THIS document** → `docs/reference/k8s-integration-testing.md` — the agent's prompt
   cites it, and a prompt citing a file that isn't in the repo fails the Fresh Session Test
   (knowledge not in the repo is invisible to the agent, Lesson 3).
2. The MCP config is written by setup for **both** runtimes (`.kiro/settings/mcp.json` and
   `.mcp.json`) with the read-only server already in it, so the agent can self-diagnose a failure
   without shelling out blind. Gate `mcp-runtime-skew` fails them if they later diverge.
3. Run the agent — `kiro-cli chat --agent k8s-integration-tester` — and point it at the real Helm
   chart. There is nothing in the script to fill in — it takes the chart, or the whole registry,
   as an argument. The agent writes real Level 3 tests against the deployed
   service, runs them through the script, and points `docs/testing-standards.md`'s Level 3 command
   at the confirmed-working invocation
   (`tools/k8s-test-env.sh charts/my-service -- ./run-cross-service-tests.sh`). It behaves like a
   specialized maker — it records evidence, it does not set `status: done` itself.
4. `verify-harness.mjs` still runs no gate that needs a *cluster* (cluster access can't be assumed
   present in every environment that runs verify), but it does gate the two things it can see from
   the repo: `k8s-agent-missing` (a chart is here and nothing verifies the deployed shape) and
   `mcp-runtime-skew`. Beyond those the check that matters is the same one that already
   exists: does `docs/testing-standards.md`'s Level 3 command actually get exercised by
   `init.sh`/the loop, and does it have a bounded timeout (`docs/constraints.md`).

## Business-journey metrics

For a Level 4 journey the test command receives `HARNESS_RUN_ID`, `NAMESPACE`, and
`HARNESS_JOURNEY_METRICS`. The driver may write redacted `eventWaitDurationMs` and `retryCount` to
the last path. The environment always emits `journey-metrics.json` with deploy/readiness/scenario/
total duration, diagnostics presence, exit code and no business payload. Environment and oracle
contracts live in `skills/business-journey/`.
