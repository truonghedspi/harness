# Architecture — {{PROJECT_NAME}}

Structured around the **Fresh Session Test** (Lesson 3): a new agent session given only this repo
must be able to answer all five questions below. If it can't, the knowledge isn't in the repo yet
— add it here.

## What is this?

{{PROJECT_PURPOSE}}

[Expand: the problem it solves, the primary users, the core domain concepts.]

## How is it organized?

[Directory map and the responsibility of each top-level folder. Module boundaries and the
allowed dependency direction between them — see `docs/constraints.md`.]

```
[top-level layout]
```

## How do I run it?

```bash
./init.sh          # install + verify + baseline gate
[run command]      # start the app / service / CLI
```

## How do I verify it?

The three-level hierarchy is in `docs/testing-standards.md`. Fast path:

```bash
[unit test command]
[cross-service / microservice integration command]
```

`./init.sh` is the full baseline gate.

## Where are we now? (current state)

Live status is in `progress.md` and `feature_list.json`. This section holds only the stable
architectural picture; day-to-day state does not belong here.
