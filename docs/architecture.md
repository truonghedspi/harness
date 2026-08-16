# Architecture — Harness

Structured around the **Fresh Session Test** (Lesson 3): a new agent session given only this repo
must be able to answer all five questions below. If it can't, the knowledge isn't in the repo yet
— add it here.

## What is this?

Build and verify reusable agent-harness assets and the autonomous maker-checker workflow.

It serves maintainers who install a durable, independently checked agent workflow into other
repositories. The core concepts are canonical templates, target-owned state, generated runtime
agents, typed routing, verification gates, and a feedback path from target findings to harness
defects.

## How is it organized?

```
harness-loop/       canonical skill, templates, scripts, references, and demo
docs/               this repository's dogfood knowledge layer
loop/               this repository's dogfood maker-checker control plane
tools/              vendored target-side tools used to verify dogfood behavior
skills/             capability packs installed into this dogfood target
examples/           dormant worked examples with their own scope and AGENTS.md
```

Canonical behavior flows from `harness-loop/templates/**` and `harness-loop/scripts/**` into a
target. The root-level harness is a consumer used for dogfooding; findings discovered here are
recorded in `harness-loop/harness-issues.jsonl` and fixed in the canonical source, never hidden in
the root copy.

## How do I run it?

```bash
./init.sh          # install + verify + baseline gate
node loop/route.mjs # report the next workflow node; there is no application server
```

## How do I verify it?

The three-level hierarchy is in `docs/testing-standards.md`. Fast path:

```bash
bash harness-loop/scripts/demo.sh
node check-coverage.mjs --target .
```

`./init.sh` is the full baseline gate.

## Where are we now? (current state)

Live status is in `progress.md` and `feature_list.json`. This section holds only the stable
architectural picture; day-to-day state does not belong here.
