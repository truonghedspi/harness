# Teardown runs before startup can register — every eviction mutant misses it

**When applicable:** every attach/detach pair has a spawn ↔ evict — pool, registry, subscriber lifecycle
list, watcher. Found in `feat-tool-layer-core` (2026-08-24), wiring section `WorkspaceAttachment` in
`workspace-pool.ts`.

## Why does the list of evict mutants look complete but it's still missing?

Maker correctly constructs two mutants for the debugging path: "evict only calls forget, not detach" and "evict doesn't
let's run detach". Both are red, both are reappearing. But both run on a single fixture
First: the workspace HAS to be started before evict. The axis that no one touches is the axis of time.

The source code has this form:

```
async #evict(victim) {
  this.#entries.delete(victim.workspaceId);
  await this.#runDetachments(victim);   // splice(0) on an EMPTY array
  const spawned = await victim.started;  // start to run again, then push the detach into the array
  await spawned.stop();
}
```

`close()` evicts all entries, including starting entries. When `splice(0)` runs, `#startWorkspace` is not available
promptly push any detach function into `entry.detachments`; soon it pushed in, and no one ran them anymore.
The process is killed, but the registration lives forever.

## How to measure, cheaply and decisively

No need to mutate — this is a bug on the pristine version, so the probe only needs a SLOW spawn seam:

1. `spawnWorkspace` returns after ~120 ms.
2. Call `acquire()` WITHOUT await; wait ~20 ms then `await close()`.
3. Count `attached` with `detached`. Here: `attached=1, detached=0, stopped=1`.

The second probe turns numbers into visible consequences: replace counted attachments with real attachments
(`attachFileSync`). After `close()` has resolved, the node process **never exits** — handle
`fs.watch` leak keeps the event loop alive. Control (await complete acquisition then close) exits inside
222 ms. Always wrap probes of this type with a SIGKILL wrapper at the parent process level: the proof here is
"it hangs", so the ceiling order will hang for the entire screening.

Rule of thumb: for each attach/detach pair, ask "if the teardown runs when the startup is halfway done
What about the road?" and correctly construct a probe with a slow seam. Mutant about evict can never answer the question
That's because every mutant runs on a fixture that has already started.

## Same entry: a coordinate hidden in the message string is the second transition boundary

At the same time, the comment at the beginning of the file states "this entire file has exactly two functions that touch addition and subtraction
index... there are no shortcuts that add up by themselves". If you read carefully, there is a third place, located in the template
string constructs the error message:

```
reason: `... resolved no element at line ${position.line + POSITION_BASE}, column ${...}`
```

Mutant changes that position to 0-based to survive the entire suite, because the only case that touches that branch only confirms
`reason.length > 0`. Quick read: `grep` is the conversion constant name in both the file and the count
point appears, don't believe the statement "only two functions" in the comment. The coordinates are in the reader's text still
is the coordinate — it leaves the system and the agent acts according to it.