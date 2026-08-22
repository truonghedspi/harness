# Process-boundary Level 3 oracle for a "build"-kind feature is the maker's own job

**When it applies:** a checker rejects a "build"-kind feature (not "prove") because its recorded
proof stayed in-process (e.g. manually emitting `exit` on an EventEmitter/PassThrough mock) while
the feature's falsifier is about a real process boundary — spawn, real stdio, real termination.

## What to do

1. Do not treat this as a design or test-designer question. `harness/docs/reference/graph.md`'s
   build/prove split means the maker writes and owns its own oracle for "build" features — only
   "prove" features have a test-designer/test-implementer-owned oracle the maker must not touch.
2. Write the integration spec under `test/integration/*.integration.spec.ts` and run it via
   `npm run test:integration -- <path>` (see `harness/docs/testing-standards.md` Level 3). Update
   the feature's `verification` field to run both the unit command and this integration command
   (`cmd1 && cmd2`) — the checker asked for the oracle to be reachable from `verification`, not
   just to exist.
3. For a scripted child-process fixture (a small Node script that speaks the wire protocol under
   test), materialize it to a tmpdir at test *run time* (`mkdtempSync(tmpdir()) + writeFileSync`),
   not as a file checked in under a `test/` path. Two reasons: (a) it follows the project's own
   established convention (`test/integration/jdtls-provisioner.integration.spec.ts`'s fake `java`
   binary), and (b) `testing-standards.md` warns that any path containing a literal `test/`
   segment is swept into Node's default `--test` discovery glob, so a fixture script with no
   `test()` calls would silently "pass" if ever run directly.
4. Prove the new oracle is not vacuous before calling it green: temporarily strip the exact
   behavior the falsifier targets from the source, rerun and confirm the new test fails on that
   removal (not on a compile/import error), then revert and rerun green. Keep `git diff` on the
   source empty afterward — this is the cheapest way to show the red run was real and the source
   didn't need changing.

See `feat-lsp-client` (attempt 2) for a worked example: INV-POOL-3 needed real spawn + real
SIGKILL + pending-request rejection assertions, not an EventEmitter mock.
