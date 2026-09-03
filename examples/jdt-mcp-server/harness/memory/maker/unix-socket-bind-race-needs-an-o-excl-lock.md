# On Unix sockets, "N processes with bind" does not automatically report EADDRINUSE

**When applicable:** any attempt to take ownership of a Unix domain socket path —
`feat-daemon-supervisor` (INV-SHIM-2), and soon `feat-mcp-shim` when shim starts the daemon itself.

## Wrong assumption I almost brought into the design

Initial reflex: "try `connect()` first; if that fails, `unlink` then `listen`. The loser will be
receives `EADDRINUSE`, so only one daemon exists." That assumption is wrong in the last part.

Measured with mutant M4 (keep the probe step the same, remove the `O_EXCL` lock): five simultaneous runs on
The same path returns **five** daemons, none of which say `EADDRINUSE`. Root cause: each
launcher `unlink` the launcher's socket file first and then `bind` a new file. `bind` only fails when
The path **existed** at the time of the call, but each latecomer manually deleted it. Results:
five live servers, only the last server can receive connections, the remaining four servers are kept by orphan daemons
Child JVM — exactly the shape that INV-SHIM-2 prohibits.

## Measures

Place the entire `probe → unlink stale → listen` segment under a lock created with `openSync(path, "wx")`
(`O_CREAT|O_EXCL`, filesystem level atomicity). Only the lock holder is allowed to delete the socket file. The one who doesn't take it
locked, return to the probe step, wait and authorize the winner. Keep the lock throughout the daemon and write lifecycle
pid in there, so that the authorized launcher can read the pid of the correct daemon it converges on — that is, observing
which falsifier requires ("assert one daemon pid"). Old locks of dead processes are identified by
`process.kill(pid, 0)`; `EPERM` means the process is alive but has a different owner, not considered dead.

## Two environmental details have been measured, do not measure again

- A real "stale" socket can only be created by `SIGKILL` a listening process; `server.close()`
  Node automatically deletes the file so it cannot be recreated. `connect()` to stale socket returns `ECONNREFUSED`,
  also to a file that usually returns `ENOTSOCK` — both should refer to "no live daemons".
- `sun_path` is only 104 bytes on macOS, where `os.tmpdir()` already takes up ~52 bytes. Prefix `mkdtempSync`
  must be short (`jdt-d-` outputs 78 bytes total); A long prefix like `jdt-daemon-supervisor-` is enough to cause the error.