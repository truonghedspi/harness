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
      "command": "npx",
      "args": ["-y", "kubernetes-mcp-server@latest", "--read-only", "--disable-destructive"],
      "env": { "KUBECONFIG": "/path/to/kubeconfig" }
    }
  }
}
```

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

## How to adopt this in a scaffolded project

1. Copy the opt-in tree into the target: everything under `harness-loop/templates/k8s/` mirrors
   the target's own layout (e.g. `templates/k8s/tools/k8s-test-env.sh` → `tools/k8s-test-env.sh`).
2. Fill in the script's `CHART_PATH` / `RELEASE_NAME` / `NAMESPACE_LABEL_SELECTOR_FOR_READINESS`
   variables at the top for the real Helm chart.
3. Point `docs/testing-standards.md`'s Level 3 command at it:
   `tools/k8s-test-env.sh charts/my-service -- ./run-cross-service-tests.sh`.
4. Add the MCP config above so the agent can self-diagnose a failure without shelling out blind.
5. `verify-harness.mjs` doesn't have a k8s-specific gate (cluster access can't be assumed present
   in every environment that runs verify) — the check that matters is the same one that already
   exists: does `docs/testing-standards.md`'s Level 3 command actually get exercised by
   `init.sh`/the loop, and does it have a bounded timeout (`docs/constraints.md`).
