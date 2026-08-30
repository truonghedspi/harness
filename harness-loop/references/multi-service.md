# Multi-service: collecting what it takes to stand a system up

Everything else in this harness assumes one repository. `--target DIR`, one `feature_list.json`,
one `init.sh`, one router, one Helm chart. That holds until the first integration test that needs
two services running at once, and then none of it does.

This file is the design for the missing layer. It is grounded in a survey of seven real
repositories rather than in what a service registry usually looks like — and the survey changed the
design four times before a line of it was written.

## What the survey found

| Repo | Build | Dockerfile | Chart / compose |
|---|---|---|---|
| `fix-adapter` | maven, **three modules** | none | none |
| `auto-e2e` | npm | none | none |
| `aeron-demo` | maven | none | 1 chart |
| `exchange-core` | maven | none | none |
| `order-flow` | gradle | none | none |
| `trading-frontend` | npm | none | none |
| `mock-server` | **none at all** | none | none |

**1. The unit is a service, and a service is a directory — not a repository.** `fix-adapter`
contains `halo-cluster`, `gateway` and `hft-common`. A registry keyed on repositories cannot
express that.

**2. Not every module is a service.** `hft-common` is `<packaging>jar</packaging>` with no `main` —
a shared library. Only `halo-cluster` has an entry point. A collector that treats every module as
deployable will try to start a jar of SBE codecs.

**3. Some services have no build manifest at all.** `mock-server` is `server.js` plus `db.json`,
started with `node server.js`. Every "detect the build system" heuristic returns nothing, and the
right answer is not "unsupported" — it is *this service has no build step, only a run step*.

**4. Nothing here is containerised.** Seven repositories, zero Dockerfiles, one chart — *in this
local sample*. That is a fact about these seven checkouts and not a claim about any organisation:
where a team already deploys with Helm and Kubernetes, images exist and this finding simply does not
apply to them. What survives generalisation is the narrower rule: **the harness cannot collect its
way around a missing image.** Producing images is prerequisite work, not a field in a manifest, so
the collector reports an absent `image:` as work to schedule rather than as a blank to fill in. Where
images do exist, that report is empty and nothing is in the way.

A fifth thing, from `ClusterPorts.java`: services here are **cluster-shaped**, with ports derived
as `base + nodeId` across three nodes. "One service, one port" is wrong for this domain.

## The shape that follows

```
services.manifest.json          # the registry — one entry per SERVICE, not per repo
```

| Field | Meaning | Discoverable? |
|---|---|---|
| `id` | stable name used by every other field and by tests | no — chosen |
| `path` | directory, repo root or a module inside one | yes |
| `kind` | `service` \| `library` — libraries are dependencies, never deployed | yes (entry point + packaging) |
| `build` | command, or `null` for a service with no build step | yes |
| `image` | how an image is produced | **usually absent — that is the finding, not a gap in the collector** |
| `start` | how to run it locally, without Kubernetes | partly |
| `health` | how to know it is actually up, not merely running | rarely — usually `needs-human` |
| `ports` | including derived schemes like `base + nodeId` | partly |
| `replicas` | 1, or a cluster shape | no — a deployment fact |
| `dependsOn` | other service ids that must be healthy first | no — a topology fact |
| `chart` | Helm chart path, if one exists | yes |
| `values` | optional Helm values-file paths for explicit environment overrides | no — an environment fact |
| `rules` | original path, applicability scope, collection digest and provenance for service rules | yes |

The split down the "discoverable?" column is the same one this harness already runs on: what can be
read from the repository belongs to a survey agent, and what cannot belongs to the
the current agent using `human-interview`. `health` and `dependsOn` are the two that consistently cannot — *"the pod is
Running"* is not health, and nothing in a repository states which services a scenario needs.

## Each repo's rules stay in that repo

An agent in an integration target normally loads only that target's rules. The registry therefore
records each service's rules as original pointers with scope, digest and provenance — never copies.
At dispatch, `context-plan.mjs` matches the active feature's `context.touches` against those scopes;
`agent-context.mjs` reads only the matching originals and emits their actual digests as
`harnessContextInputs`. Missing or changed inputs are loud, while unrelated service conventions add
no context cost. The frozen paired measurements live in
`references/context-collection-{baseline,after}.json` and are replayed by `demo.sh`.

## Where multi-service work lives

**A separate integration target with its own harness**, whose `services.manifest.json` is its scope
and whose features are cross-service scenarios. Each service repository keeps its own harness for
unit and in-service work.

Rejected — **putting the scenario in the primary service's repo.** It reads naturally until you ask
which repo owns a test that spans three, and then every answer is arbitrary and the feature list of
whichever repo lost the argument acquires scope it cannot verify alone.

Rejected — **one harness above all repositories.** It collapses the per-repo loops that already
work, and forces a single `init.sh` to be green across seven projects before anything can run.

The integration target is just another target: `setup-harness-loop.mjs` scaffolds it, the router
routes it, the gates gate it. What is new is the registry and the collector, not the loop.

Every integration target also receives `skills/business-journey/`, a deliberately red
`business-environment.json`, and `feat-business-journey-contract`. Deployment capability alone is
not proof of a business flow: it stays red until per-run isolation, public seed/input/observation
seams, convergence invariants, cleanup, telemetry and at least one oracle are explicit.

```bash
node tools/collect-services.mjs --roots ~/work/a,~/work/b --out services.manifest.json
node setup-harness-loop.mjs --target ~/work/trading-sit --integration services.manifest.json
```

`--integration` does three things beyond a normal scaffold, all of them about making the collection
*load-bearing* rather than a file nobody opens:

- **k8s on regardless of `--k8s auto`.** Running several services together is a cluster job by
  definition, and the charts live in the service repos, not in this directory — so chart-presence is
  the wrong signal here.
- **`docs/services.md`, generated from the registry.** The design surface an agent reads. It marks
  every unanswered field **needs-human** as prominently as the answered ones, and leaves libraries
  blank rather than manufacturing gaps in something that is never deployed.
- **`feat-registry`, a `prove` feature whose verification is `node tools/services-check.mjs`.** It
  exits non-zero while any deployable service lacks a chart, an image, a health command or an
  explicit `dependsOn`. That is the difference between collection and a survey: the loop cannot get
  past an incomplete registry by describing it, and the gate closes when the fields are answered.

## The collector

`harness-onboarder` already solves the hard half. It surveys a repository nobody documented and
extracts its real build and verification commands — that ran against `auto-e2e` and got them right.
Multi-service collection is that primitive applied N times, writing into the registry instead of
into a scaffold, plus the classification the survey showed is necessary: service vs library, and
"no build step" as a real answer rather than a failure.

What it must not do is guess `health` or `dependsOn`. Those go in as `needs-human` rows with a
recommended answer, and the loop stops on them exactly as it does today — a fabricated health check
is worse than none, because the environment then reports ready and the test fails somewhere less
obvious.

### Running it

```bash
node tools/collect-services.mjs --roots ~/work/repo-a,~/work/repo-b --out services.manifest.json
```

Calibrated against the real workspace while being written, and it earned two corrections there:

- A `main()` seven levels down a Java package tree was missed by a depth-4 walk, and a real service
  was filed as a library. **Third time in this codebase a bounded walk has been set too shallow for
  Java** — the collector now starts at 12 and says so in a comment.
- `fix-adapter/gateway` carries three Spring Boot dependencies, one config class, and no entry
  point. It is neither a library nor a running service, so it reports as **`incomplete`**. Labelling
  it either way would have been tidy and would have hidden work nobody has done.

## `k8s-test-env.sh`, plural

Built. `--services services.manifest.json [--only a,b]` reads the registry and installs in
`dependsOn` order; the single-chart form is unchanged and is now just a one-service plan.

| Behaviour | Why it is not a loop over the single-chart mode |
|---|---|
| topological install order | a cycle is a **hard error naming the cycle**, before anything is deployed. Picking an order arbitrarily produces a failure whose cause is the manifest, not the code |
| `--only api` pulls in `db`, `cache` | asking for a service means asking for what it needs; a partial plan fails in the least informative way possible |
| `health`, not `--wait` | Helm's `--wait` knows only about readiness probes. A chart without one reports ready as soon as the container starts. Where the registry states a health command it is retried to a budget; **where it does not, the run prints `readiness UNVERIFIED`** rather than inventing a check |
| explicit `values` files | environment-specific topology stays opt-in; the runner validates each manifest path and passes it as `helm --values` instead of changing chart defaults |
| ranked diagnostics | `READ-THIS-FIRST.txt` orders the dump: failing service, then its dependencies, then events. Five services down otherwise produce five walls of logs |
| namespace teardown on every path | one namespace per run, so partial bring-up has no separate teardown path to get wrong |

Two things the build itself taught:

- **Tab is an IFS whitespace character.** The plan was a TSV; bash collapses runs of IFS whitespace,
  so a service with `health: null` lost its empty field and `dependsOn` shifted into its place — the
  script ran the string `db` as a health command and reported the *next* service unhealthy. The
  separator is now `0x1F`, which preserves empty fields. This is the invisible-failure class again:
  every step logged success in the wrong column.
- **An unreachable cluster used to read as a deploy failure.** `kubectl create namespace` was
  unchecked, so the run continued and blamed the first chart. There is now a preflight that names the
  context and exits 2 without deploying — an environment problem must not look like a red test.

## What this does not solve

**The images.** A collector cannot invent a Dockerfile, and no amount of registry design makes a
Kubernetes SIT possible for services that cannot be built into containers. In the local sample that
is six services out of seven; in a Helm-and-Kubernetes shop it is usually none, and this section is
then a no-op rather than a project. It is the first piece of work, it is ordinary engineering rather than
harness engineering, and pretending otherwise would produce a beautifully specified environment
that has never once started.
