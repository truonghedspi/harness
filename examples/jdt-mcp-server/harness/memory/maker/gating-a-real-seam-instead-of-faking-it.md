# Pacing an injectable port, instead of replacing it with a dummy

**When to apply:** The test case must kill one component and then let another component take its place
same shared resource (socket, port, key file). Found in `feat-mcp-shim`, ca `INV-SHIM-3`
"daemon killed mid-session, shim must reconnect during".

## The race that the innocent script created for itself

Desired scenario: daemon A is serving socket, shim hooked up; SIGKILL A; daemon B up; right shim
reconnect and route to B.

The naive version kills A and then starts B. But as soon as A dies, the socket path is **empty**, and the mechanism
The shim's connect-or-spawn will automatically bind it. Depending on machine speed, or shim wins (it makes its own daemon, B
then delegate to shim), or B wins. Green shift for different reasons in each run, and not each time
Which proves what it claims.

## How to fix

Don't replace `startDaemon` with a dummy function — doing so will miss the very protocol being proven.
Let's **stop** it: the injection port still calls the real `startDaemon`, just waiting for a promise held by the test.

```ts
let gate: Promise<void> = Promise.resolve();
let openGate: () => void = () => {};
const closeGate = () => { gate = new Promise((resolve) => { openGate = resolve; }); };
const launch: LaunchDaemon = async (options) => { await gate; return startDaemon(options); };
```

The sequence becomes deterministic: `closeGate()` → kill A → wait for shim to **see** broken link
(`waitFor(() => !shim.stats().connected)`) → client records the call → waits for it to be in the buffer
(`bufferedLines === 1`) → start B, wait for B to notify listening → `openGate()`.

## Two accompanying things, equally important

1. **Wait for the system to see the event, don't wait for the event to happen.** Writing to stdin immediately after `kill()` is writing
   into a socket that may not have issued `close`; the message is lost in the true sense of "the call is flying", and ca
   will be red randomly. The wait condition must be an observable state of the component
   (`stats().connected`), not the status of the prey.
2. **Attach the pid tag to each daemon process's response.** The difference between the two `result.pid` is
   mechanical evidence that another process actually responded — much stronger than just
   claim "to have the answer".

Measured: mutant dropping `reconnect()` and mutant throwing message instead of buffer both kill this case correctly and not
kill someone else.