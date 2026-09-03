# node:test’s `after` hook runs in REGISTRATION order, not reverse order

## Observe

Two consecutive passes of `feat-prove-navigation-tools` were interrupted because the test process never exited.
The cause lies not in the product but in the cleanup sequence of the test file itself.

Verify directly on node 22:

```
t.after(() => console.log("A"));   // print first
t.after(() => console.log("B"));   // print later
```

That means FIFO. Many test writers assume LIFO out of habit from Go's `defer` or `addCleanup`
Python `unittest`, and that assumption is wrong here.

## Consequences

The pattern is familiar in the repo — and is present in `pool-lifecycle`, `diagnostics-identity`,
`pool-crash-handling` — is:

```
t.after(() => rmSync(root, { recursive: true, force: true }));   // pre-register ⇒ PRE-RUN
t.after(() => pool.close());                                     // register later ⇒ run later
```

The directory is deleted while the JDT LS process is alive. Delete command throws error, JVM survives and keeps stdio, `node
--test` does not close the child process's stdin, so it never exits. Symptoms are one turn
The agent is interrupted due to timeout, which can easily be mistakenly attributed to the infrastructure.

## Rules for next time

Don't subscribe to multiple `t.after` directly when there are child processes. Use a single stack to remove
reverse direction:

```
function cleanupStack(t) {
  const steps = [];
  t.after(async () => {
    for (let i = steps.length - 1; i >= 0; i -= 1) {
      try { await steps[i](); } catch { /* best-effort */ }
    }
  });
  return (step) => { steps.push(step); };
}
```

Two things attached, both of which saved this file:

1. **Register as soon as the resource exists**, not after the constructor returns. Handshake throws error
   In the middle of the process, you still leave an orphan JVM if you wait until it returns to register.
2. **Cover each step with a separate try/catch.** A red assertion in the middle still requires a clean machine to be left behind.

Cheap and convincing mechanical proof: wipe `$TMPDIR/<prefix>-*`, run again, then count. There are 0 folders left
temporary and 0 residual processes then the cleanup sequence is correct. In this turn, the remaining 15 folders all have a time stamp
The timing of two takes is interrupted, none of the takes are edited.