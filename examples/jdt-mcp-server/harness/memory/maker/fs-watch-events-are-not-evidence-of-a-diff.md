# The `fs.watch` event is not proof that the file has changed — only the diff is

**When applicable:** Any component that monitors the filesystem with `node:fs.watch` and then interprets
event into an observable action (notify LSP, clear cache, trigger refresh). First meeting
in `feat-file-sync-watcher`.

## What looks like a code error is actually an environment error

On macOS, `fs.watch(..., { recursive: true })` replays events for writes that occur **immediately
before** when `watch()` is set. The cause is FSEvents' clustering delay, not my fault
Node. Specific consequences measured: fixture writes `pom.xml` and `Greeter.java`, then calls `start()`; two
The events for those two files still arrive a few milliseconds later.

The first implementation trusts the path named by the event — "present on both sides ⇒ Changed" —
should emit a fake `pom.xml` message after an edit that only touches the source code. In this system, each message
`pom.xml` entails a refresh of the JDT LS project-model, i.e. a redundant re-import at each
workspace startup.

## Correct way

1. Treat the event as just a "something moving" signal, enough to schedule a flush. Doesn't read type
   change from `eventType`: `fs.watch` reports `rename` for both creation, deletion and **two halves** of a change
   name, and optionally include events (a directory deletion may indicate the correct directory).
2. Decide the type of change by comparing a new scan with the previous settlement image: absent → present
   is Created, yes → absent is Deleted, else `(mtimeMs, size, ino)` is Changed.
3. Comparison with `ino` is the point that causes the write-temporary-then-rename pattern (the way most editors and agents write
   file) appears: the destination file keeps the path but receives the inode of the temporary file, so the diff catches it
   even if the size remains the same.
4. Don't make up for it by sending out extra notices just to be sure. Here the redundant message is not harmless — it is one
   times re-import project-model.

## How to detect

The case of catching this error is not "did the watcher report the change", but two assertions
negative: **an edit that only touches the source code must not generate any `pom.xml` refreshes**, and
**named file list must be exactly one element**. Confirmed positive cases are still green
with the wrong implementation.