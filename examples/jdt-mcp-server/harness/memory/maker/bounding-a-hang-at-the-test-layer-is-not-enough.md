# Allocating budget in the testing class can only prevent half of the suspension

**When to apply:** Checker reports a mutant that appears to run HANG instead of red, and asks you to turn it
into a controlled red shift. Encountered in `feat-daemon-supervisor` turn 2, mutant DM10 (shutdown no
`destroy()` accepted connections, so `server.close()` never calls the callback).

## 1. The budget in the `t.after` hook treats the symptom, not the cause

`node --test` applies `{ timeout }` to the **body** of the test function, not the `t.after` hook. Should be the first step
The first thing that comes to mind is to wrap `shutdown()` in `Promise.race` with a timer. That worked
application: all 9 cases reported red with a message named, within a few seconds.

But the process **still never exits**. Measuring: all cases have printed results, then the machine runs still
until I SIGKILL at 120 seconds. The reason is that the leaked resource is not a promise — it is one
`net.Server` is still listening with the connection open, and it keeps the event loop alive after the test ends.
The test side releases the promise but cannot close the server, because the connection file is private
deployment version.

Takeaway rule: **ask which resource is holding the event loop, don't just ask which `await` statement is hanging.**
If the resource is in `src`, the deadline must be in `src`.

Here the fix is to give `closeServer` a forced limit: when `FORCE_CLOSE_AFTER_MS` expires, `destroy()`
any remaining connections, force `close()` to complete. This is not laxity at all — it is just illegal
variable in question: signal handler calls `shutdown()`, so a stuck `server.close()` causes daemon
never exit and leave all child processes behind, which is exactly what INV-SHIM-4 prohibits.

API Note: `net.Server` **does** not have `closeAllConnections()`; which is the API of `http.Server`. Vol
connection recorded by the component itself is the only way of accounting.

## 2. The forced limit will kill the song you just created, if you don't separate the two numbers

Adding forced sugar to `src` stopped the mutant from crashing — but also nearly stopped it from turning red. Below DM10, code
falls on the slow line, the connection is still closed, all assertions about the result are still true. Mutant becomes
**equivalent**, and the case just written loses all power of distinction.

How to keep: let the shutdown request complete within a budget that is **well below** the forcing limit (1000 ms
compared to 2000 ms). The fast path must complete in a few ms; touching the forced line is itself a withdrawal
chemistry. The forced path is a safety net, not a normal path, and you have to say that correctly.

In general: every time you add a fallback to prevent crashes, immediately find the number that distinguishes the fallback from the path
usually, then confirm that number. If you can't find it, the fallback has just hidden a mutant.

## 3. Mutant exhausts the event loop and destroys the entire file, not a single shift

The first version of the orphan lock case did not cover the budget. Under mutant DM5, `startDaemon` loops waiting for a lock, and
The `sleep()` in that loop uses the timer already `unref()`. There are no more refs left, the event loop is exhausted, and
`node --test` cancels **four cases** with `Promise resolution is still pending but the event loop has
already resolved` — 4 canceled, 0 failed, none of the cases named their assertions.

This looks like an infrastructure error but is a direct consequence of the source code: every waiting loop builds on the timer
unref turns "long wait" into "early exit process". The timer **has ref** of `withBudget` kept
The event loop lives long enough for its limit to explode, and the result becomes exactly one named case.

Tell-tale signs: `# canceled` is non-zero while `# failed` is zero. Don't read it as "flaky"; read it
is "someone just let the event loop dry".

## 4. The comment "this gate exists because of X" is worth repeating

The comment of `MAX_SOCKET_PATH_LENGTH` says the path is too long "fails deep inside libuv with an opaque
error". Measured on Node 22.23.2 / macOS: completely wrong. `listen()` on 234 byte path **returns to
public**, `server.listening` is true, `address()` returns the full long path — but libuv truncate
name into `sun_path` so there is no socket file in the requested path. Because `probeDaemon` opens
with `existsSync(socketPath)`, the door is forever wrong and no subsequent launcher can see the daemon.

The consequences are much more dangerous than the caption describes, and it only becomes apparent when the mutant leaves the door
stopped and asked "what really happened". When a case must prove that the door can withstand pressure, measure iten when you cross the previous threshold, don't believe the legend written next to it.