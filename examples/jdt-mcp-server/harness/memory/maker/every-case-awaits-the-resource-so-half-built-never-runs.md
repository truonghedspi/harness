# All shifts wait for resources, so no shifts enter the semi-edit state

**When applicable:** a component has a two-phase lifecycle — build (`spawn`, `connect`, `start`) then connect
string (`attach`, `subscribe`, `register`) — and you're proving a cleanup invariant. Meet at
`feat-tool-layer-core`, turn 1 REJECTed.

## What happened

Six mutants `M1`–`M6` of round 1 all died exactly as declared. Checker runs again: perfect match. Okay
checker constructs a probe **not a mutant** — calls `close()` while `spawn` is in progress — and measures
`attached=1, detached=0, stopped=1` on **pristine** version. The error is in the production code, it's not
in branch map: `#evict` runs `#runDetachments` before `await entry.started`, which the detach array points to
fully after the start function finishes running.

Root cause of no one seeing it: **every shift in the spec file begins with
`const lease = await pool.acquire(...)`.** After that line, the entry is always in the wired state.
The `"starting"` state exists in the data type (`WorkspaceState`), is assigned in the code, and is not
No one has ever observed it. A mutant can only die if a mutant crosses over to the branch it damaged; here
That branch has no cases, so all cleanup order mutants look like equivalent mutants.

## Identification signs, applicable to the next turn

Read the component's state type and then count how many shifts each value is **observed** by. Price
Any value that is assigned but not read is a blind area. `"starting"`, `"draining"`, `"reconnecting"`
almost always falls there, because the most convenient fixture is the one that resolves immediately.

## How to build that window deterministically

Do not use `setTimeout`. Place two stoppers around the injected seam itself:

```ts
const spawnReached = deferred();   // seam says "I'm here"
const spawnGate = deferred();      // test decides when seam returns
const spawnWorkspace = async () => { spawnReached.resolve(); await spawnGate.promise; return real; };

const acquiring = pool.acquire(root);
await spawnReached.promise;   // definitely in between two phases
const closing = pool.close(); // the event to be measured falls into the correct window
spawnGate.resolve();          // build phase ends AFTER cleanup has begun
await closing; await closing;
```

Two things are required, otherwise the mutant will be suspended instead of red (see
`a-leaked-handle-turns-a-red-mutant-into-a-cave`): opens the handle in `t.after` so that no shift gets stuck
after a red assertion, and keep the reference to the actual resource (`fs.watch`) to close it straight, out of the way
is being tested.

## Two smaller things, at the same time

- **A coordinate that goes out in prose is still a coordinate.** `HoverAnswer.reason` is constructed
  equal to the template string adding `+ 1`, i.e. a second conversion boundary next to the conversion function
  official. The old case only requires `reason.length > 0` so the 0-based mutant lives. When immutable says "convert
  in exactly one place", `grep` the entire format string, not just typed returns.
- **Fixture contains unverified emoji that cannot be processed as surrogate pairs.** Emoji is not an identifier part,
  so the branches `width = 2` and `width = 1` give the same result. Need a REAL astral-plane letter
  (`𝐀`, U+1D400 — `\p{L}`) is in an identifier. That shift revealed that the reverse scan was equal
  `codePointAt(start - 1)` is wrong from the start: in exactly one surrogate pair, that position is the second half, not
  pair — width must be derived from trail surrogate range `0xDC00`–`0xDFFF`.