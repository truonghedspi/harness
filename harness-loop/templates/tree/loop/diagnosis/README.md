# `loop/diagnosis/` — the recorded root cause, written before the repair

A repair implemented against a **guessed** cause is the expensive kind of wrong. It spends an
attempt, edits production code, and leaves the real cause in place — so the next run fails the same
way, and now there is an unexplained change in the tree as well.

The router therefore splits a repair into two turns. The first proves the cause and writes one file
here. The second implements against it. `route.mjs` reads this directory; nothing else gates on it.

## When the router asks for one

| Situation | Key |
|---|---|
| `loop/baseline-state.json` is red | `baseline:<evidenceDigest>` |
| the picked feature has been rejected before (`attempts >= 1`) | `<feat-id>#<attempts>` |

The key is bound to the **failure identity**, not to the feature. A different baseline digest, or
one more rejection, is a different failure and needs its own diagnosis — an old file cannot
authorize a new repair.

The file name is the key with every character outside `A-Za-z0-9._-` replaced by `-`, so
`baseline:8fa1…` is `baseline-8fa1….json`. The router prints the exact path it wants.

## Shape

```json
{
  "schema": "diagnosis/1",
  "key": "feat-sync#1",
  "symptom": "TCON-SYNC-0001 fails with `resyncing` on every third run, green in isolation",
  "cause": "the guard polls before the watcher has settled, so a stale result is returned once",
  "layer": "project",
  "provedBy": { "cmd": "node --test test/workspace/sync-guard.spec.ts", "exit": 1,
                "result": "3/6 red, all three in the not-quiescent case" },
  "ruledOut": [
    { "hypothesis": "the fixture leaks a workspace between cases",
      "killedBy": "ran the case alone in a fresh tmpdir — still red, so it is not cross-case state" }
  ],
  "at": "2026-09-01T04:11:00.000Z"
}
```

## What makes it valid

`route.mjs` accepts the diagnosis only when all of these hold:

| Field | Requirement |
|---|---|
| `schema` | exactly `diagnosis/1` |
| `key` | equal to the key the router named |
| `symptom` | non-empty — what was actually observed, not what you think it means |
| `cause` | non-empty — the one explanation that survived |
| `provedBy.cmd` | non-empty — the command that ran, so anyone can re-run it |
| `ruledOut` | at least one entry with a non-empty `hypothesis` **and** `killedBy` |

`ruledOut` is the load-bearing field. A file with a cause and no competing explanation is the first
guess written down; the whole point is that the spike **discriminated** between two readings of the
same symptom. This is the mutant-check applied to a diagnosis: an explanation that nothing could
have contradicted has not been tested.

## `layer` — and the answer that is "change nothing"

`project`, `harness`, `host` or `external`. Naming the layer is often the entire value of the turn.

Observed on `examples/jdt-mcp-server`: a repeated `EMFILE` in the file-sync watcher looked exactly
like a watcher defect, and the plausible fix was a patch to production code. A standalone spike —
watch an empty directory from a Node process that loads no repo code — reproduced it, which proved
the cause was host directory-watch state (`layer: "host"`). The correct repair was to change
nothing and stop. Without the diagnosis turn, the loop would have shipped a change that hid a host
problem inside the project, and the evidence would have looked green.

## The spike

Keep it throwaway and keep it out of the build — `spikes/` under the rules in
`docs/reference/design-engineering.md`. Two minutes of running something beats an hour of confident
reading, and the output quoted in `provedBy.result` is what makes this file evidence rather than a
memo.
