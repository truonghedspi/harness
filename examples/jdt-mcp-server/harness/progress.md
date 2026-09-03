# Progress Log — JDT MCP Server

External state for cross-session continuity (Lesson 5). The agent's memory is wiped between
sessions; this file is not available. Update it at the end of every session (Lesson 12).

## Current State

- **2026-08-29 — feat-gradle-routing (DONE, checker approved):** project-router now recognizes Gradle (settings.gradle/.kts = multi-project root, build.gradle/.kts = project) alongside Maven — INV-ROUTE-4 (additive). Router now routes to aeron repo (Gradle 9.6.1): smoke-test real file aeron-client/.../ClientConductor.java → root aeron. 5 new oracle cases (TCON-ROUTE-GRADLE-0001..0005), mutant delete Gradle branch → red. Full suite 255/255.

- **2026-08-29 — feat-diag-open-on-query (DONE, checker approved):** INV-DIAG-4 after a REJECT was rewritten to pin the "bounded wait for publishDiagnostics" as the load-bearing part, and textDocument/didOpen as the trigger/optimization. Checker mutant: clear wait (keep didOpen) → red "not-reported"; delete didOpen (keep wait) → still green (accept as optimal, record acceptedRisks). The router now "exits" again — 37/37 done.

- **2026-08-29 — feat-diag-open-on-query (build, readyForCheck):** close gap INV-DIAG-4 — daemon (src/cli.ts) now sends textDocument/didOpen to the questioned document before java_diagnostics responds and waits for a limited publish (DIAG_OPEN_WAIT_MS=10s), so the file on the imported workspace (.project/.classpath is available) returns "reported" instead of "not-reported" forever. New test test/integration/diagnostics-open.integration.spec.ts (2 phase daemon, red→green); npm test 159/159, npm run test:integration 250/250. Design: Option A (didOpen on-query), approvedBy "gommi", INV-DIAG-4 + updated design-approval.json.

- **2026-08-28 — COMPLETED: 36/36 done (100%).** All 12 remaining features have passed checker review (APPROVE,
  `status: done`, `checkerVerdict: approved`). The router now returns `exit` — every feature done. `npm test`
  159/159; `npm run test:integration` (danger-full-access) 249/249. Four build tools
  (`java_completion`, `java_rename`, `java_code_actions`, `java_apply_code_action`) + oracle prove
respectively, the two features blocked-3/3 are removed by the new oracle condition, and end-to-end `feat-prove-cross-process-integration`. Details: `src/tools/{completion,rename,code-actions,apply-code-action,code-action-store,workspace-edit}.ts`,
  `src/workspace/sync-guard.ts`, oracle `{completion,rename,code-actions,cross-process}.integration.spec.ts`
  + `TCON-PROV-0009` + `TCON-DIAG-0004` + `A-021`. Sandbox DSH blocking `ps` (EPERM): `TCON-SHIM-0003`
  fake fail, confirm with `danger-full-access`.

- **2026-08-28 — `feat-prove-sync` (oracle + sync-guard, wait for checker):** implement `src/workspace/sync-guard.ts`
  (`withSyncQuiescence`: wait for watcher to settle then POLL until the reply is no longer stale, otherwise
  `ResyncingError` code `resyncing`) — missing INV-SYNC-1 component that runtime-model describes but
  No build feature owns it. Write oracle `test/integration/file-sync.integration.spec.ts` again
  show spike C via `textDocument/definition` (workspace/symbol only resolves TYPE, measured by spike) above
  real pool + real JDT LS + real watcher. Control 2/2 green; mutant M1 (guard returns the first result
  no poll) makes TCON-SYNC-0001 red and true falsifier. `npm test` 124/124 green. Feature transfer
  `blocked` → `in-progress`, write evidence + checkerNotes; not yet `readyForCheck` (checker not dispatched
  be in session). Scope note: sync-guard is the new production component, if the build feature is separated
  Personally, the planner cuts it back.

- **2026-08-28 — `feat-prove-readiness` (oracle deadline path, waiting for checker):** wrote
  `test/integration/readiness.integration.spec.ts` — Is it true that 3 callers at the same time against one workspace
  ever ready (no Java source so `probeSemanticIndex` is always `ok:false`) via real pool + JDT LS
  real + readiness-gate real; All three reject `WorkspaceNotReadyError` in the deadline parameter (X-001 opens).
  Control 1/1 green; mutant M1 (awaitReady resolve empty success instead of reject) makes the oracle red 1/1.
  Feature `blocked` → `in-progress`, `readyForCheck: true` + reviewPacket ADMITTED. Both features
  (`feat-prove-sync`, `feat-prove-readiness`) timer waiting for checker.- **2026-08-24 — `feat-prove-diagnostics` maker attempt 1/3:** implementation green; baseline blocks checker. Live JDT LS
  notifications arrived under canonical `file:///private/var/...` URIs while the tool queried the
  same files through `file:///var/...`; `DiagnosticsCache` now keys existing file URIs by canonical
  filesystem identity. Exact verification: 3/3 green in 10.6 s, replacing the prior repeat
  timeout behavior with a bounded run.
  `./harness/init.sh` is nevertheless red: all 14 recursive watcher cases fail with `EMFILE`, even
  after raising this shell's soft fd limit from 256 to 10240. The feature remains not ready for
  checker because that baseline failure is outside its scoped correction.
  Attempt 2 minimized this to one deterministic case and then outside the repo entirely: standalone
  Node `fs.watch()` fails `EMFILE` for a fresh empty directory and for the repo directory, but a
  single-file watch and 300 ordinary open descriptors succeed. Classification: host directory-watch
  capacity/runtime state, not `DiskFileSyncWatcher`; no out-of-scope source or oracle edit made.

- **Last updated:** 2026-08-22 (maker hit, `feat-file-sync-watcher`)
- **Opening feature:** `feat-file-sync-watcher` (`in-progress`, `readyForCheck: true`, 1/3) wait for checker.
- **Latest commit:** detach Codex contract hook (see git log)
- **Baseline (`./harness/init.sh`):** green — 18 unit instances (4 lsp-client, 6 workspace-pool, 8 file-sync-watcher) and all 56 instances when running full discovery passed

## Done

- [x] feat-001 — Baseline green
  - Checker replayed the six-case integration oracle and `./harness/init.sh`; injected install, fixture, and test failures each made the gate red and stopped later steps.
- [x] feat-project-router — path to workspace id
  - Checker approved (attempt 2/3): 5/5 (TCON-ROUTE-0001..0005) pass, mutant probe killed every cited defect. Checker's own mutant probe on the just-approved code then found the `<modules>` reactor check is deletable without any of the 5 conditions failing — recorded as a FOLLOW-UP, not reopened here (see feat-prove-routing).
- [x] feat-lsp-client — Content-Length framing + id correlation- Checker approved at attempt 2/4. Both verification commands are reproducible (4/4 units, 1/1 integration). Oracle Level 3 spawns a real child process (private pid, visible `ps`, revoked after SIGKILL). Three mutants built by the checker itself in `harness/trace/scratch/` were all caught by oracle: skipping the reject loop `#pending` (red ~0.1 s), only rejecting the first entry (red), and incorrectly writing `Content-Length` to `byteLength + 1` (red at the correct timeout mark of 10.004 s). Repeat 15/15 times until green. `src/lsp/lsp-client.ts` is unchanged from commit a9306fb.
- [x] feat-prove-routing — routing never drifts and never silent misroutes
  - Checker approved on the final attempt (3/3): independent replay 7/7 green (TCON-ROUTE-0001..0007) in 179.6 ms, source unchanged since commit 2503299, oracle diff purely additive (+64 lines, no deletions). A scratch mutant probe (deleted after use, `src/` untouched) showed the control copy green 7/7, mutant M3 (`find` instead of `findLast` — innermost instead of outermost reactor) killed by TCON-ROUTE-0007 alone, M1 killed by TCON-ROUTE-0006 alone, and M2/M13/M14/M17/M19 killed by several conditions each. FOLLOW-UP recorded for the still-surviving mutant M12.

- [x] feat-workspace-pool — JDT LS lifecycle per workspace
  - Checker approved at 1/3 attempt. Both verification commands are reproducible (10 units + 2 integration), `src/workspace/workspace-pool.ts` keeps the bytes intact after trying to mutate (sha256 `a72b2ed5…`). The four mutants created by the checker were all captured: M1 (recorded entry to the map only after spawning) reddened 2 units + 2 integrations with six different real pids; M2 (remove entry deletion in catch branch when spawn fails) redens the condition "a failed first spawn is never cached"; M3b (`terminate()` completely empty) reddens both integrations after ~10.8 s; M4 (hashing `path.resolve` instead of `realpathSync`) redens the symlink condition at both levels.- INV-POOL-5 is proven true: both oracles fire 8 and 6 `acquire()` calls in parallel via `Promise.all`, the integration oracle waits another 400 ms before counting so "exactly one process" is not the result of a race of luck. Oracle integration runs the default spawner, no seam injection: real `child_process.spawn`, real child process records its own `$$` and argv, pid reported by pool is checked against operating system pid, and `process.kill(pid, 0)`.
  - Two FOLLOW-UPs recorded in `checkerNotes`, do not interfere: (1) TCON-POOL-0003 of oracle `pool-lifecycle` is red because of oracle's own error, within `feat-prove-pool-lifecycle`; (2) there is no fixed condition for `project-router` and `workspace-pool` to generate the same `workspaceId`.

## Decomposition — round 2026-08-22 (feature-planner)

Input: three FOLLOW-UP entries in verdict APPROVE of `feat-workspace-pool`. No features touched
(hold `done`, keep evidence, keep attempts 1/3). Reason details in `DECISIONS.md` 2026-08-22.

- oracle error `TCON-POOL-0003`: **no new scope created.** `feat-prove-pool-lifecycle` is now qualified
  because the dependency is `done`. Diagnostics and a limited pre-authorized oracle modification, written in
  `checkerNotes` of the feature itself and in the new context package
  `harness/loop/context-packets/feat-prove-pool-lifecycle.json` (with sha256 of oracle file, control file
  package and `src/workspace/workspace-pool.ts`, so the recipient immediately knows whether the package is fresh or old).
- Identity connection `project-router` ↔ `workspace-pool`: **new prove feature**
  `feat-prove-workspace-identity`, private oracle `test/integration/workspace-identity.integration.spec.ts`,
  falsifier quotes `INV-POOL-1` + `INV-ROUTE-3`, `maxAttempts` 2, `conditions` to empty for class
  oracle fill. This is about killing the living mutant: today's two components match, so the red run is correct
  comes from the named mutant, not from an undeployed feature.
- Soft stop SIGTERM before SIGKILL: **note only.** None of the invariants state stop order, so note
  Go to `context.note` of `feat-prove-pool-crash-handling` and open a human checkpoint in
  `loop/goal.md`.- `feat-prove-pool-crash-handling`: **unblocking** `blocked` → `not-started`. Exit condition due to main
  The block note mentioned ("once feat-lsp-client and feat-workspace-pool are both done") is now enough.

## Blocked

- [ ] feat-prove-provisioner — timebox-blocked after attempt 3/3
  - Checker replayed all 13 green cases in 562.2 s, including the real clean-cache download/install path. But TCON-PROV-0008 only compares the installed files to the same archive it handed to the implementation; it never requires checksum-mismatch rejection for corrupted downloaded bytes. A removed checksum guard would stay green, so the prove claim cannot close until the oracle adds that condition.

## In Progress

- [ ] feat-file-sync-watcher — wait checker (`readyForCheck: true`, attempts 2/3)
  - **Round 2 (2026-08-22) — add oracle only, don't touch `src/`.** Checker rejects round 1 because of year
    mutant survival; The deployment is confirmed correct so `src/workspace/file-sync-watcher.ts` holds
    byte-by-byte (compare with copy before mutant, `diff` is empty).
  - Four new cases, each red under the mutant it targets:
    1. Pin code on line using literal LSP 3.17 (1/2/3), without passing `FileChangeType` imported from
       The module itself is judged → kill M3 (change the constant number), red with `expected [1] actual [3]`.
    2. Overwrite preserves byte length AND preserves mtime: both versions force mtime to one second
       rounded by `utimesSync`, the byte lengths are asserted to be equal, so `ino` is the only field
       distinguish → kill M7 (delete the clause `previous.ino !== stamp.ino`).
    3. Fixture reactor two modules (`moduleA/pom.xml` + `moduleA/src/main/java`) → kill M5 (follow only
       watch original pom) on refresh wait, and M8 (remove infix rule in `#isWatchedPath`) on notify wait
       Report the source code of the module. Two mutants died in two different confirmations.
    4. A case of hitting `src/test/java` → killing M6 (removing half of the constant `DEFAULT_SOURCE_ROOT_PATTERNS`).
  - Four mutants A/B/C/D of round 1 were rebuilt and still died (3, 7, 2, 1 red case). Correction
    Shared infrastructure does not blunt either assertion.- **A built-in flaky bug was exposed when adding shifts, completely fixed in the fixture layer.** On macOS, libuv
    start the FSEvents stream AFTER `fs.watch()` returns; Recordings fall into that window never
    is transferred. Since the watcher only flushes when an event occurs, the consequence is absolute silence and case
    hang for 15 seconds. Measured before fixing: 2 out of 4 runs of `npm run test:integration` red, victim
    which case is written first - once the new case, twice the OLD cases numbered 3/5/7. How to fix it completely
    in spec file: `awaitWatchStreamLive()` for new shifts, plus a kick in `waitUntil` write
    bait file `.fs-watch-probe` (not `*.java`, not `pom.xml`, so cannot appear
    in any notification) and runs ONLY when `watcher.lastChangeAt` is `undefined`, i.e. only inside
    in the startup window. After correction: 6 out of 6 green runs 60/60. No confirmation of 8 cases
    the old one is changed or removed; `makeFixture` only adds the `autoStart` option and only the overwrite-same-size shift
    use it, because that case needs the background image to be latched by a scan at `start()` instead of by a racing flush.
  - If you want the deployment itself to close the FSEvents window (a short rescan after `start()`) then that
    is a change to `src/` and must be a separate feature, not included in this oracle edit.

  Round 1 (keep for reference):
  - Wrote `src/workspace/file-sync-watcher.ts` and its own Level 1 oracle
    `test/workspace/file-sync-watcher.spec.ts` (feature `kind: build`, maker owns both).
    Eight cases run on real temp directory and real `fs.watch`; only the LSP layer is fake, because of the assertion
    here is "what message is broadcast", not the Content-Length frame (demonstrated in lsp-client).
  - Important design decision: **don't read type changes from the OS event chain.**
    `fs.watch` reports `rename` for both creation, deletion, and the two halves of a rename, optional event aggregation, and
    on macOS also replays the events of recordings immediately BEFORE `watch()` is set. Every event
    schedule only one flush; flush compares a new scan with a previous settle snapshot:
    absent → present is Created, present → absent is Deleted, otherwise `(mtime, size, inode)` is Changed. Patternwrite-temp-then-rename falls in the last branch because the target file keeps the path but gets the inode of the temporary file.
  - The first version believes in the path named by the operating system (present on both sides ⇒ Changed) and is
    oracle itself caught red: `pom.xml` reported Changed after an edit that only touched the source code, due to an event
    again. This is the most valuable red of this turn — it indicates a watcher causing a project-model refresh
    redundant every time the workspace is started.
  - `settledAt` and "notification sent" are two separate events: `lastChangeAt` sets as soon as an event occurs.
    raw bale, `settledAt` only moves after the debounced batch is sent, with `generation` incremented by one
    times for each lot. `INV-SYNC-1` will be based on this milestone, not wired at the current build stage.
  - Four self-built mutants were all killed by the oracle, the source was restored to its original bytes afterwards: remove the Deleted branch
    (2 red cases), change record to Created (3 red), `pom.xml` only emits notifications
    watched-file (true case `INV-SYNC-3` is red), and set `settledAt` right at the raw event (true
    red debounce case).
  - Known limitation, covered by another feature: `LspClient` does not yet have a `notify()` method, so
    watcher receives an `LspNotificationSink` port provided by the caller. Do not edit `src/lsp/` in
    this turn because of the "don't touch files out of feature scope" constraint; wiring belongs
    `feat-tool-layer-core` or daemon.

- [ ] feat-prove-pool-lifecycle — wait for checker (`readyForCheck: true`, attempts 1/3)
  - New red on intact oracle (2026-08-22): 3 tests, 2 passed, 1 failed. `TCON-POOL-0003` fired
    `ERR_ASSERTION` at line 205 of
    `test/integration/pool-lifecycle.integration.spec.ts`, message "an evicted workspace must be
    absent from pool.status()", the actual value is workspace `idle` of `project-0`. This is my fault
    oracle, not of `src/workspace/workspace-pool.ts`: fixture string `[p0,p1,p0,p2,p0]`
    re-acquire `p0` after evict so `p0` is valid again.
  - Exactly apply a previously allowed edit in `DECISIONS.md` (2026-08-22): assertion
    absent-from-`status()` now only runs when `!recorder.liveProjects.has(evictedProject)`, i.e.narrow in terms of workspaces that have been evicted and have not been reacquired. Assertion `existsSync(dataDir)` — main
    is the falsifier of `INV-POOL-4` — remains the same, runs unconditionally for all `stopOrder` elements.
    Do not touch `src/`, do not touch `TCON-POOL-0001`/`TCON-POOL-0002`, fixture and cap remain the same.
  - Green after editing: 3/3 oracle; `npm run test:integration` 48/48; `npm test` 10/10.
  - Non-empty check: with temporary counter (removed immediately after measurement), assertion is absent after
    shrink still runs 7 times each pass — 3 times `project-0`, 3 times `project-1`, 1 time `project-2`. Article
    guard condition does not disable assertion.

## Next

0. `node harness/loop/route.mjs` after this planning pass points to **test-designer** for
   `feat-prove-workspace-identity`: falsifier quotes `INV-POOL-1`, which does not yet have a condition for `INV-POOL-1`
   Which test case? Correct order — the oracle class designs the condition first, then the test-implementer
   write `test/integration/workspace-identity.integration.spec.ts`, then maker.
   Then `feat-prove-pool-crash-handling` (just unblocked, `conditions` TCON-POOL-0004..0006 is available
   in `TP-POOL-0002`) will match the test-implementer rule.
1. `feat-prove-pool-lifecycle` (fully qualified, `not-started`). **Read
   `harness/loop/context-packets/feat-prove-pool-lifecycle.json` first.** Router will include this feature
   for maker and not for oracle class, because the `evidence` field is not empty so the test-implementer
   does not match. Oracle `test/integration/pool-lifecycle.integration.spec.ts` already exists and is 2/3 with current implementation. TCON-POOL-0003 is red because of oracle's own error: the loop asserts that every project that was in `recorder.stopOrder` must be absent from `pool.status()`, but the fixture string `[p0,p1,p0,p2,p0]` reacquires `p0` after evict, so `p0` is valid again. Need to narrow the assertion to exactly the workspaces that have been evicted and have not been reacquired. The rest of the oracle has been verified by the checker to be correct: with the mutant adding the tick suffix to `dataDir`, the red TCON-POOL-0003 is in the correct assertion "a re-requested workspace must reuse its warm -data directory", meaning INV-POOL-4 is covered.2. Add and run a committed corrupt-download/checksum-rejection integration condition for `feat-prove-provisioner`, then return it to checker review.
3. **DECIDER NEEDED — this item can no longer be mentioned by the router.** `feat-prove-routing` FOLLOW-UP (surviving mutant M12): both dispatches `follow-up:feat-prove-routing:*` have been used up, so `loop/route.mjs` will never be mentioned again; opened a human checkpoint in `loop/goal.md`. Choose one of two: a new small oracle feature, or a risk-taking line under A-006 — never a fourth in-place expansion, because that feature is already closed at 3/3 and the maker is out of tries. The recommended single condition (TCON-ROUTE-0008) closes the whole selection predicate at once: a five-level mixed ancestor chain (non-reactor top, reactor A, non-reactor middle, reactor B, leaf module), where a path under the leaf module must resolve to reactor A.
4. ~~Feature-planner considers a small condition for the connection `project-router` ↔ `workspace-pool`.~~
   **Processed 2026-08-22:** cut to feature `feat-prove-workspace-identity`. Two hash points
   standalone are `src/workspace/project-router.ts:47` and `src/workspace/workspace-pool.ts:171`.

## Known Issues / Risks

- [ ] Eclipse snapshot downloads are slow on this network; the fetcher uses bounded parallel ranges and caches the checksum-verified archive contents.

## Notes for Next SessionThe prove-provisioner feature is rejected: its 13-case green replay lacks corrupt-download/checksum-rejection coverage. `feat-lsp-client` is **done** — checker approved on attempt 2/4 after constructing three mutants and confirming oracle Level 3 captured all three; Do not edit `src/lsp/lsp-client.ts` or the oracle file without a new deny. `feat-project-router` is done and must stay intact. `feat-prove-routing` is now **done**, approved by the checker on its final attempt (3/3). The recorded verification reproduced exactly (7/7 green, 179.6 ms), and a scratch mutant probe settled the question the previous verdict left open: the `outermost` clause of `INV-ROUTE-1` is truly proven, because `TCON-ROUTE-0007` is the only condition that kills the innermost-reactor mutant. One real gap remains and is recorded as a FOLLOW-UP in the feature's `checkerNotes`: mutant M12 — *if any ancestor is a reactor, take the outermost ancestor `pom.xml` even when that pom declares no `<modules>`* — survives all 7 conditions. It is proven non-equivalent: for `parent-pom-only/` (packaging=pom, no `<modules>`) containing `reactor/` (`<modules>`) containing `mod-a`, the real implementation resolves `mod-a` to `parent-pom-only/reactor` while M12 resolves it to `parent-pom-only`. No fixture places a non-reactor `pom.xml` *above* a reactor root, so `INV-ROUTE-1`'s qualifier clause is still discriminated by nothing. This must be routed as new scope, not as a fourth expansion of the closed feature. Two other surviving mutants are already documented rather than new: the loosened `<modules>` regex (the accepted no-real-Maven-parser risk in design approval 3d68e0857fbfac45) and the dropped `realpathSync` (out of scope while X-005 stays open, as the spec file's own header states).

## 2026-08-22 — `feat-readiness-gate` (maker, turn 1/3, waiting for checker)

`src/workspace/readiness-gate.ts` + `test/workspace/readiness-gate.spec.ts` (6 cases, all present
`{ timeout: 10_000 }`). The port only opens when `probeSemanticIndex` returns a non-empty result AND has at least one result
a result that points back to the correct source file from which the symbol was read (`workspace/symbol`). `noteStatus()`only records `ServiceReady`/`ProjectStatus` and wakes up the probe loop early; it never opens the gate.
`deadline` is a required parameter of type `{ at } | { withinMs }` — X-001 is still open so no default value is set
determined. `probeSemanticIndex` is exported specifically for calling `feat-prove-sync` directly.

Evidence: the falsifier version running first gives red 5/5; The three self-created mutants were all killed in exactly the same case. Mutants 2
(remove `settleBy` around probe) **survives the first time** because the deadline is tightened a second time inside
probe; probe; added case 5 (injected probe intentionally ignored `timeoutMs` and never settled)
rebuild the mutant — case 5 hangs and is canceled by `node --test`, meaning the mutant is captured. Entire suite unit: 41/41.

## 2026-08-22 — `feat-diagnostics-cache` (maker, turn 1/3, waiting for checker)

`src/lsp/diagnostics-cache.ts` + `test/lsp/diagnostics-cache.spec.ts` (13 sync shifts, no set
`{ timeout }` because that option is disabled for synchronous callbacks — DECISIONS.md 2026-08-22). Key cache
by `(workspaceId, uri)` with a nested map, completely independent of the open/close lifecycle: spike B gives
see diagnostics arriving in push mode, even for files that have never been `didOpen`. `absorb()` receives the raw payload,
check the shape, then **overwrite** the old entry of that URI — don't read the old entry again, so the empty payload is deleted
clean old problem (INV-DIAG-2). `get()` distinguishes `reported: false` from reported
empty (INV-DIAG-1). The save is deep frozen `structuredClone`, so no callers accumulate
passed by reference.

Wiring: narrow port declaration cache `LspNotificationSource { onNotification(method, handler) }` in
file itself and `attach(workspaceId, source)` properly registers the string `textDocument/publishDiagnostics`
of LSP 3.17. This is the way `file-sync-watcher` used for `LspNotificationSink` and the checker said
is the correct boundary. **`LspClient` does not currently route notifications** — `#handleMessage` ignores all
The message does not carry an id — so it is only structurally compatible with this port when the lsp-client feature is added
add `onNotification`; recorded in `checkerNotes`.Proof: red first (module doesn't exist yet), then red at assertion level with `absorb` stacking first
first (exact case of INV-DIAG-2). Eight mutants built themselves along three axes of
`harness/memory/checker/maker-authored-mutants-cover-only-branches-he-wrote.md`: protocol constant
(M2), self-declared load-bearing mechanism (M3 copy/freeze, M7 unregister), and fixture shape (M4 two
workspace, M5 empty-vs-uncounted, M6 broken payload, M8 version). All eight died exactly as they were aiming; later
revert, `diff` with pristine empty and `npm test` 41/41 green.

## 2026-08-22 — `feat-file-sync-watcher` (maker, turn 3/3, waiting for checker)

Last oracle fix on budget. Checker rejects the second time because the decision comparison `Changed` is based
on the triple `(mtimeMs, size, ino)` but oracle can only pin one field: leave out `mtimeMs` (M10) or
In the `size` (M13) clause, 12/12 is still green, and no case deleted a `pom.xml`, so the new branch for the pom was broken.
delete (M12) and no one watches. Just touch `test/workspace/file-sync-watcher.spec.ts`; deployment version
keep each byte intact, sha256 after duplicating the pristine copy taken before creating the mutant.

Three new shifts, all written **in place** with `writeFileSync` — on macOS this opens the file with `O_TRUNC` and
no `unlink`, so the destination remains the same inode, completely separate from the temp-write-then-rename of the old case:

1. Only mtime is different. Same number of bytes, frozen background timestamp to 2023 with `utimesSync` **before**
   `start()`, so the new mtime is always noticeably different regardless of filesystem resolution. Affirm in advance
   equals `statSync`: `ino` and `size` are equal, only `mtimeMs` differs. Kill M10.
2. Only the size is different. Longer content then `utimesSync` returns mtime to correct datum — simulate `cp -p`,
   `rsync --times`, `git checkout`. The two commands are in the same synchronization block so there is no timer debounce
   Who can squeeze in between to see the intermediate mtime? Kill M13.
3. Delete `moduleA/pom.xml` in fixture reactor. Request `java/projectConfigurationUpdate` targeting pom
   **root** (uri of deleted pom is no longer readable — correct deployment branch statement), with one entry
   `Deleted` gives the pom deleted, and the original pom is not reported as changed. Kill M12, kill M5 as well.Evidence: each green case on the full version first, then red under its correct mutant and only
red in that case (the remaining 14 cases were still green), then green again after reconstitution. Five mutants of round 2
(M3/M7/M5/M8/M6) rebuilt after three more cases still died in the target case. Stable: verification running 5
consecutive times 44/44 green, `npm run test:integration` 4 times 87/87 green.

An observation about the environment, not the behavior of the test case: the first run under M12 reports the duration
209 s for red shift, far exceeding `{ timeout: 30000 }`. Measure again four times when the machine is idle for exactly 15.14 s.
The reason is that the machine load is due to other agents running in parallel (load average above 5), not the shift itself.

Still in debt, belongs to the design class, not the maker (checker stated in round 2, no one has received it yet): update
A-014 according to measured evidence, and a separate feature that closes the FSEvents startup window right in
`start()` instead of letting the spec file write the primer file.

## Checkers run independently for four features (2026-08-22)

There is no `verify-harness --promote` run first, so it's all mechanical and linguistic
The meaning is all made by the checker himself. Each feature is measured in a separate sandbox under `harness/trace/scratch/`
(copy `src` + copy spec points to copy, reference `m0` runs first), and any sandboxes removed.

| Features | Verdict | Mutation results are created by the checker yourself |
|---|---|---|
| `feat-file-sync-watcher` | APPROVE | M10, M13, M12 all died on their shifts; M3 and M7 are still dead |
| `feat-readiness-gate` | REJECT | RM1/RM2/RM3/RM10 died, but RM4/RM5/RM6/RM7 survived 6/6 green |
| `feat-daemon-supervisor` | REJECT | DM1/DM2/DM4/DM9 die, but DM5/DM6/DM7 survive; DM10 makes `t.after` hook for infinite hanging |
| `feat-diagnostics-cache` | APPROVE | 11 out of 12 mutants died; only CM10 (`receivedAt`) survives |

Two lessons logged in `harness/memory/checker/`: `{ timeout: N }` declared on unmasked test cases
`t.after`, and narrow ports declared in place are accumulating wiring debt that no other feature owns.

Backlog needs planner to create scope: (1) A-014 still records `assumed` with empty evidence box while number
meter has rejected it, and the FSEvents startup window still has no features closed in `start()`;(2) there is no feature to add notification routing (`onNotification`) for `LspClient`,
so the two declared ports — `LspNotificationSink` and `LspNotificationSource` — remain connectorless, and
`feat-prove-diagnostics` is blocking for exactly that reason.

## `feat-readiness-gate` turn 2 — oracle patch after REJECT (2026-08-22)

Just touch `test/workspace/readiness-gate.spec.ts`. The file `src/workspace/readiness-gate.ts` remains intact
By byte: pristine copy captured before first mutant, restored after each mutant, and `diff` last
empty turn. The four mutant checkers mentioned are all dead, exactly one for each mutant:

| Mutants | Ca kill | Red message |
|---|---|---|
| RM7 `reset()` to no-op | case 7 | dead process ticket return port |
| RM6 removes cache ticket branch | case 8 | The second caller probes again and expires at 105 ms |
| RM5 unshare probe in flight | case 4 | Three callers simultaneously count probe | 3 times
| RM4 understands `{ at }` as duration | case 10 | limit 200 ms but release caller at 3 ms |

One more shift in addition to the request for RM8: the internal clamp layer `#probeOnce` is visible through the port itself
`probe` is public. Case 9 injects a probe, records the `timeoutMs` given, and claims all remaining budgets
in `[1, caller limit]` while probe ceiling is 5000 ms. RM8 gives 5000 ms for a 150 ms call
should die. The two deadline classes now each have their own shifts, no class can cover the other.

A change on the old shift, clearly declared: shift 5 no longer `await` without limit but races against a
watchdog 2000 ms then confirms the caller has been released. The old assertions stay the same and are just added
come in. The reason is that below RM2 this shift hangs for 10 seconds and then drags the entire following shift into the `cancelled` state.
Measured again: RM2 still died in case 5, clear message, 0 cases canceled.

Result: `npm test -- test/workspace/readiness-gate.spec.ts` gives 48/48 green, three consecutive runs.
The four mutants of round 1 (RM1, RM10, RM3, RM2) were rebuilt and still died in their respective cases.

## `feat-daemon-supervisor` turn 2 — oracle patch after REJECT (2026-08-23)

Three checker cases are available, each of which kills exactly one mutant and no others:

| Mutants | Ca kill | Red message | Time |
|---|---|---|---|| DM5 removes orphan key revocation | case 6 | `budget exceeded: startDaemon over an orphaned lock file ... 1000 ms` | 1288 ms |
| DM7 shutdown delegated deletes the daemon's socket | case 7 | `a delegated shutdown must leave the daemon's socket file in place` | 246 ms |
| DM6 removes `sun_path` | case 8 | `Missing expected rejection` | 257 ms |
| DM10 shutdown does not destroy connection | case 9 | `budget exceeded: shutdown() with one accepted client connection ... 1000 ms` | 8351 ms |

The infinite hanging cleaning hook was fixed on **both sides**, because measurements shown that one side was not enough. side
test has a `withBudget` budget for each shutdown call, so overdue becomes a named error. But
Only on the test side, DM10 still leaves the problem hanging: all 9 reports are completed and the process never exits.
must SIGKILL at 120 s, because the leak server keeps the event loop alive. So `closeServer` in `src` gets more
Forced limit 2000 ms: when expired, destroy all remaining connections so `server.close()` is forced
complete. complete. This is the real trust error of INV-SHIM-4 — the signal handler calls `shutdown()`, so a
`server.close()` gets stuck, causing the process not to exit and leaving the entire child JVM behind.

Case 9 requires shutdown to complete in 1000 ms, which is completely below the forced limit of 2000 ms, so the forced limit is not valid.
Turn DM10 into the mutant equivalent: below DM10 it falls to the slow lane and dies red.

Secondary discovery, measured on Node 22.23.2 / macOS: old annotation of `MAX_SOCKET_PATH_LENGTH` is wrong.
`listen()` on 234 byte path **returns success**, `server.listening` is true, but libuv
truncate the name to `sun_path` so there is no socket file in the requested path. Door
`existsSync(socketPath)` of `probeDaemon` is therefore forever false and no subsequent launcher will see
get daemon: INV-SHIM-2 fails silently. Notes have been edited according to measurements.

Result: `npm test -- test/daemon/daemon-supervisor.spec.ts` gives 57/57 green; only green 9/9 files,
five consecutive runs all 256-259 ms and exit 0; `npm run test:integration` gives 95/95 green.Open, out of scope: `test/daemon/*.spec.ts` is not in glob of script `npm test` in
`package.json`. The file is shared across the project, for feature-planner to handle.

## 2026-08-23 — maker: feat-lsp-notifications (turn 1/3, waiting for checker)

`LspClient` carries messages without `id` in both directions; suite unit 57/57, integrated 105/105.

Three branches are added to `src/lsp/lsp-client.ts`, leaving `#write` or `#drainFrames` untouched:

| What to add | Why |
|---|---|| `notify(method, params?)` | Write frames without `id`, don't get number from `#nextId`, don't put cell in `#pending`. A notification carrying `id` is considered a request by JDT LS and the cell is never settled. |
| `onNotification(method, handler)` | Registers cumulatively by array, returns the remove function. `DiagnosticsCache.attach()` calls this port every time and there is no debugging at the source, so overriding the method will silently kill the previous subscriber. |
| Notification branch in `#handleMessage` | The line `if (typeof message.id !== "number") return;` previously dropped any frames without an `id`, including `textDocument/publishDiagnostics`. The new branch comes after the request server→client branch, so the correlation behavior by `id` remains the same. |

Three mutants built themselves, each mutant only killed the group they were targeting, the rest remained green:

| Mutants | Ca kill | Red line |
|---|---|---|
| A: `notify()` grants `id` and puts the cell in `#pending` | 2 afternoon shifts sent | `hasOwn id` expected false actual true; The next request receives `id: 3` instead of `2` |
| B: `#handleMessage` leaves behind a frame without `id` | 3 afternoon shifts receiving | `the notification was dropped instead of dispatched` |
| C: `onNotification` overrides method | 2 cumulative cases | `[ 'third' ]` instead of `[ 'first', 'second', 'third' ]` |

After each mutation, the source file is restored from the pristine copy copied out of the source tree; `diff` end of turn
empty. Structural compatibility with two ports is demonstrated with `tsc` on a temporary assignment file
(`LspClient` is assignable to both `LspNotificationSource` and `LspNotificationSink`), that file has been deleted.

Three decisions are recorded in `checkerNotes` for the checker to judge, not hidden in the code: return type of
`onNotification`, swallowing the error thrown from the handler, and `notify()` throwing back the process exit error.

Still open, out of scope: production wiring (pool hands `lease.client` to `cache.attach()` and lets
watcher sink) belongs to `feat-tool-layer-core`/`feat-mcp-shim`. There are no integration tests used yet
The real `LspClient` for notifications — both `diagnostics-cache.spec.ts` and `file-sync-watcher.spec.ts`
Still using separate emulator port.

## 2026-08-23 — `feat-lsp-notifications` turn 2: close the two gaps oracle checker pointed outChecker REJECT turn 1 because the two mutants built by the checker survived with 9/9 green cases. Deployment version
`src/lsp/lsp-client.ts` contains no errors; The defect lies in oracle. This round only adds test cases.

| Mutant lives on turn 1 | Design sentence no one can prove | New case closes the gap |
|---|---|---|
| F: deregister function body changed to `return () => {};` | "The function returned correctly removed this subscriber" — no case ever called `onNotification()` returned value | `the function returned by onNotification really unsubscribes that handler` |
| E: remove snapshot, `for (const handler of handlers)` | Note line 158: a handler can be unregistered during dispatch | `a handler unsubscribing itself mid-dispatch does not make its siblings be skipped` |

The first shift fires a frame **before** calling the remove function and requires `calls === 1`. Without this step, the number is 0
The last statement is also true as the handler has never been connected to dispatch, which means the shift will be green for a reason
wrong. The second case registers three handlers for the same method, the first handler calls its own remove function inside
callback body; The first frame requires all three to run, the second frame requires only `[second, third]`.

Discrimination ability was measured individually for each mutant and not inferred: E only killed the second case (58/59
the remaining cases are green, including the first case), F kills both new cases. Under both mutants, the old nine cases remained green —Correctly reproduces the checker's findings. The source is restored from the pristine copy copied out of the source tree;
`diff` is empty and sha256 `f48e5974…` matches the snapshot before constructing the mutant, so `src/` is left unchanged by one byte.

Suite after this turn: `npm test` 59 passes 0 fails (11 cases of spec notification, four old cases of
`test/lsp/lsp-client.spec.ts` does not break), `npm run test:integration` 107 pass 0 fail, `./harness/init.sh`
green. Feature set `readyForCheck: true`, `attempts` 2/3, `status` keep `in-progress`.

## 2026-08-23 — `feat-mcp-shim` pass 1: front end stdio, port blocking stdout and transparent reconnection

Two new files: `src/shim/mcp-shim.ts` (deployment) and `test/shim/mcp-shim.spec.ts` (7 oracle cases).
Do not edit a line outside the scope of the feature; `src/daemon/daemon-supervisor.ts` remains the same.

**Biggest design decision: shim is NOT a raw byte pipe.** `INV-SHIM-1` is an attribute of
stdout, and shim is the last thing before the client's stdout. A `socket.pipe(process.stdout)`
passes everything the daemon emits — stack traces, warning lines — straight into the client's analyzer,
contrary to the statement in the MCP spec: server "MUST NOT write anything to its stdout that is not a valid MCP
message". So each stream from the socket is deframed and then passed through the `isMcpMessage` port; line no
MCP must output to stderr with content for debugging. Second reason: `INV-SHIM-3` needs a granularity of **even one
message**. A byte pipe that lost its socket midway gave half the message to the daemon that just died, half
The rest will go to daemon instead. Full stream buffering makes a restart a waste of words
call on the fly, never damage the frame.

**What does auto-spawn mean here.** Shim calls `startDaemon` of `daemon-supervisor`, does not rebuild itself
probe/lock protocol. When no one is serving the path, the shim process binds the socket
(`role: "daemon"`); Once there is a daemon, the handle is `delegated` and the connection is available. This is the only mechanism
most that the dependency has `done` given; None of the design documents mention a separate running daemon
detached, so this gets recorded in `checkerNotes` instead of making it up.

**Oracle is divided into two levels, there is a measurable reason.** Two cases of `INV-SHIM-1` run shim as a real child processand read bytes on real stdout, because a `console.log` writes to `process.stdout` which oracle keeps `Writable`
injection never seen. Mutant M1 proves it right: it kills **only** shifts at the process edge,
six cases in progress are still green.

Ca `INV-SHIM-3` uses two real daemon processes, tags the response with its own pid, and
SIGKILL the first one. The `launch` port is **switched, not emulated**: the real `startDaemon` remains
run, test only decides *when* shim is allowed to run it again. Without that blocking rhythm, the kill times
The daemon will race against shim binding the empty socket, and ca will prove nothing about one
real reboot.

| Mutants | Ca was killed | Red line |
|---|---|---|
| M1 `console.log` in `establish()` | process shift only | `real stdout line 1 is not a valid MCP message: "shim linked: role=daemon"` |
| M2 removes `reconnect()` from handler `close` | just ca `INV-SHIM-3` | 10 s overdue wait for second answer after reboot |
| M3 drops port `isMcpMessage` | both cases `INV-SHIM-1` | `stdout line 1 is not a valid MCP message: "Error: java.lang.IllegalStateException..."` |
| M4 dumps message instead of buffering when link is lost | just ca `INV-SHIM-3` | 5 s overdue wait shim holds the call as a complete message |
| M5 `LineFramer` transmits one frame per chunk | frame transplant only | 200 KB message splits 7 write arrivals into 7 lines instead of 1 |

The source is restored from the pristine copy outside the source tree; `diff` is empty, and `grep` confirms in
`src/shim/mcp-shim.ts` no longer has any `console.log`, just a single `process.stdout` reference
default value of injection option.

Result: `npm test -- test/shim/mcp-shim.spec.ts` 66 pass 0 fail; spec shim runs separately 5 times in a row
continue 5/5 green (no flaky in daemon kill case); `npm run test:integration` 114 pass 0 fail;
`./harness/init.sh` green. Feature set `readyForCheck: true`, `attempts` 1/4, `status`
`in-progress`.

Still open, out of scope: default `test` glob in `package.json` remains the same according to the precedent of
`daemon-supervisor` — spec is accessed via the feature's own verification command and passed
`npm run test:integration`. The wiring of the tool layer (the actual `onConnection` of the daemon) belongs`feat-tool-layer-core`; In this feature `onConnection` is just a passed parameter.

## 2026-08-23 — `feat-mcp-shim`, turn 2: close three oracle spaces after REJECT

Checker returns 1 because the implementation is correct but oracle is missing a shift. This pass does not fix `src/`:
`src/shim/mcp-shim.ts` preserves each byte (sha256 `1e9b1128…`, `diff` with empty pristine copy
after the entire mutant build). Only `test/shim/mcp-shim.spec.ts` changed, from 7 to 11 cases.

| Mutants | Ca was killed | Red line |
|---|---|---|
| C7 uses the same `LineFramer` for all links | no cases (blue 11/11) | — |
| C4 removes `framer.flush` from handler `close` | half-message song | `exactly the one truncated tail must have been diverted` |
| C4+C7 at the same time | half-message song | 10 s overdue waiting for answer `id=2`; stdout only has `id=1` — the answer is gone |
| C3 `console.log` in line link-closed | two shift recorder | `INV-SHIM-1 violated: the reconnect/stop path written to the process's own stdout` |
| C3b `console.log` in branch reconnect failed | two shift recorder | as above |
| C8 `console.log` in branch stop-shutdown failed | first recorder shift | as above |
| C11 refuses to shoulder daemon when `links > 0` | correct role change shift, no other shift | 15 s overdue wait `the shim to answer call 2 after adopting the daemon role` |

The half-message case sends the truncated JSON fragment in **same socket write** with response `id=1`, so
order to be deterministic instead of relying on a wait: the answer is present on stdout as proof
The truncated piece is already in the framer.

One-time pitfall: naive recorder on `process.stdout.write` cannot be used, because
`node --test` runs each spec file in child process and reports results via **main**
`process.stdout` using the V8 serializer. Recorder only records string chunks, with confirmation
`NODE_TEST_CONTEXT === "child-v8"` and a positive anchor prove the recorder is alive. Details at
`harness/memory/maker/stdout-recorder-must-ignore-the-runner-channel.md`.

Result: `npm test -- test/shim/mcp-shim.spec.ts` 70 pass 0 fail; spec shim runs separately 5 times in a row
next 11/11; `npm test` 59 passes; `npm run test:integration` 118 pass 0 fail; `./harness/init.sh`green. `attempts` 2/4, `readyForCheck: true`.

Doesn't touch checker's point 4 (the client owning the daemon dies, taking the other client's pool with it) — that is
Design level questions require an assumption that has an owner, not the maker's job.

### Checker — feat-mcp-shim turn 2: REJECT

The three spaces of turn 1 are completely closed. Checker rebuilds all mutants in its own sandbox
(green `m0` reference 11/11 before any conclusion): `C4` alone kills half-message, `C7` alone
I live, `C4+C7` kills exactly with the symptom "the answer `id=2` disappears completely". Five calling positions
`log()` on the reconnect/stop line is all caught by the recorder — three variants of maker die prematurely at the anchor
stderr should checker construct three *plus-plus* variations to demonstrate the recorder itself. `C11` kills correctly
one shift. Sufficient reproducible evidence: 70/70, 59/59, 118/118, 5 consecutive runs without fluctuation,
sha256 of `src/shim/mcp-shim.ts` matches reported.

Still returning it because seven mutants designed by checker survived 11/11, of which four cracked exactly one sentence.
annotation in `src` called bearing:

| Mutants | Break something | Results |
|---|---|---|
| `D1` | `StringDecoder` → `chunk.toString("utf8")` | 11/11 green — ca framing fixture does not cut between characters at all (42 byte prefix, 30,000 byte step, all boundaries fall at the beginning of the character) |
| `CE1` | add `console.log` to `socket.on("error")` | 11/11 green — probe records file to prove handler does not run once |
| `CE1del` | completely remove the `error` | listener 11/11 blue — a version missing a listener kills the shim process but suite doesn't see it |
| `D3` | `while` → `if` in `flushPending` | 11/11 green — all shifts only pad one line |
| `D2` | `pending.push` → `pending.unshift` | 11/11 green — reload order no one judges |
| `D4` | stdout leak of form `Buffer` | 11/11 green — known limits of the recorder, recorded, no editing required this turn |

Two measurements make the request possible instead of empty: `resetAndDestroy()` **throws**
`ERR_INVALID_HANDLE_TYPE` on Unix socket, but breaks the socket on the daemon side and immediately writes a message
large from the client side correctly outputs an `error` event code `EPIPE`; and with the mid-character cutoff,`chunk.toString()` produces different text that **still** can be parsed into JSON — bad scenario
that the `LineFramer` annotation describes.

### Maker — feat-mcp-shim turn 3: play all four mutant survivors

`src/shim/mcp-shim.ts` one-byte constant (sha256 `1e9b1128…ff80`, `diff` with pristine copy
empty). Only `test/shim/mcp-shim.spec.ts` changes: 11 → 13 shifts.

| Mutants | Ca close it | Red line |
|---|---|---|
| `D1` | ca framing rewritten | `differs at character 74 — expected "𝄞-ü\"}}", got "����-ü\"}}"` (still parsed into JSON) |
| `CE1` | new case 12 | `INV-SHIM-1 violated: the daemon link error path written to the process own stdout` |
| `CE1del` | new case 12 | `timed out … waiting for: a real error event on the daemon link` |
| `D3` | new case 13 | `answered: [1,2], still buffered: 2, daemon saw: 2` |
| `D2` | new case 13 | `actual [1,4,3,2]` vs `expected [1,2,3,4]` |

Three points worth noting:

1. **The mid-character cut point must be demonstrated, not declared.** `midCharacterCut()` takes bytes
   second of the 4-byte character `𝄞` and assert `(byte & 0xc0) === 0x80`. The chunking really comes
   into two readings is also proven: an anchor message shares the same chunk as the header, so
   Seeing the anchor message means the framer has finished swallowing the header; the tail is only recorded then added
   a 100 ms delay so it cannot be chunked. Both directions kill `D1` independently.
2. **`CE1del` does not kill the process as the comment in `src` says.** Measured:
   `daemon-supervisor.probeDaemon` leaves a settled `socket.once("error", …)` on main
   connection given to shim; That listener swallows the first `error` event and returns silently. Branch
   still bear the force (without it, the error disappears without a trace) but the reason in the comment is not correct
   on the `delegated` line. Write to `checkerNotes`, do not edit `src` this time.
3. **The order of operations determines whether an `EPIPE` is generated or not.** Destroy the socket on the daemon side *then* write
   even a 1 MB call: 5/5 times there will be `error`. Record first and destroy later with a small message: 0/5.

Suite: 13/13 (5 times in a row), plus 10 separate runs with three timing shifts all green;
`npm test -- test/shim/mcp-shim.spec.ts` 72/72; `npm test` 59/59; `npm run test:integration` 120/120;`./harness/init.sh` green.

## 2026-08-24 — `feat-tool-layer-core` (maker, turn 1/3)

Core `mcp-tool-layer` (`src/tools/tool-layer.ts`, NEW) plus production line wiring
notification in `workspace-pool.ts`, the exact scope that feature-planner gives this feature in
Round 2 on 2026-08-23.

**Coordinate boundary.** The entire file has exactly two functions that touch index addition and subtraction: `fromLspPosition`
(LSP 0-based UTF-16 → 1-based of X-007) and `toLspPosition` for the reverse. `fromLspRange`,
hover, completion, and any subsequent capabilities that pass through them — that's what it's all about
`INV-TOOL-1`. There is no shortcut that adds itself, and mutant `M1` builds a second one for it
completion is immediately killed by asserting that `completionRange` must be equal to `hoverRange`.

**The order of steps in `callPositionalTool` is a matter of two invariants, not preferences:**
ask readiness → read current content → validate line/column → only then issue LSP request.
The fake facade counts the number of calls, so "LSP has not been called yet" is a measured quantity, not an inference
guess; case `INV-TOOL-5` has a positive anchor (a valid position generates exactly 2 calls) before asserting 0.

**The attach lifecycle is spawn ↔ evict, not acquire ↔ release.** `WorkspaceAttachment` runs correctly
once per JDT LS process, in `#startWorkspace` after `spawnWorkspace` returns; function. function
detach runs exactly once in `#evict`, BEFORE `spawned.stop()`. `diagnosticsAttachment(cache)` remove
register first then `cache.forget()` — reverse order so that a late publish rebuilds the correct item
has just been deleted, and it is the mutant `M5`.

| Mutants | Ca close it | Red line |
|---|---|---|
| `M1` INV-TOOL-1 | hover+completion with response | `completionRange` offset `hoverRange` |
| `M2` INV-TOOL-5 | coordinates beyond the limit | `expected true, actual false` (isError) |
| `M3` INV-TOOL-4 | not-ready + taxonomy X-003 | 2 red cases, `expected true, actual false` |
| `M4` attach by lease | attach once per process | `expected 1, actual 6` |
| `M5` forget not detach | publish after evict | `expected false, actual true` |
| `M6` does not detach at evict | forget + close watcher | 2 red cases |**A lesson that comes at the price of a hang.** `M6` the first time did not give any red line: it leaked a
handle `fs.watch` persistent, `node --test` does not exit, and even the spec file hangs instead of red flags. That song
You have to budget yourself — cleanup closes every watcher OUTSIDE the evict line — to get it back
The red line has the name. Write to maker's memory.

Suite: `npm test -- test/tools/tool-layer.spec.ts` red 10 cases with skeleton, green 75/75 after deployment
declare; declare; The 6 mutants are all killed and `diff` with an empty pristine copy after reverting; `npm test` 75/75;
`npm run test:integration` 139/139; `tsc --noEmit --strict` clean; `./harness/init.sh` green.

## 2026-08-24 — `feat-tool-references` (maker, turn 1/3)

`java_references` was the first thin tool to have a list of results, so it is where `INV-TOOL-3` first appeared
body: any overcap list must come out in truncated form INCLUDING `truncated: true` and the REAL total.
Just touch `src/tools/references.ts` (new) and `test/tools/references.spec.ts` (new).

**Red first, and red in the right place.** The first version of `references.ts` intentionally omitted the cutting step — it was
falsifier written into code. Oracle reports red 12/3 with the line `expected 200, actual 250`, which means the red falls on
confirm, not compile error or missing fixture. After adding four cut lines: 12/12 green.

**Cap does not lie firmly on the cut line.** X-008 is still open so the number 200 only appears once, in
The constant is named `DEFAULT_REFERENCE_CAP`, and `ReferencesOptions.cap` is overridable. Test case changes cap
via option (10 and 300 on the same 250-element answer) is mechanical proof: if there is some remaining
200 hard somewhere, these two cases cannot be green together.

**`callPositionalTool` has not received capability `references`**, and the tool-layer is under review by the checker
so it can't be fixed this time. `references.ts` thus reassembles the correct four-step sequence from the functions
tool-layer output — workspace → readFile → validatePosition → request — and for EVERY location to pass through
`fromLspRange`; There are no coordinate additions in this file. The price is that the `fail()` function is duplicated because
tool-layer does not export it; Record it in `checkerNotes` for later merging.

| Mutants | Ca close it | Red line |
|---|---|---|| `M1` completely removes the cutting operation | over cap, cap threshold, cap-from-configuration | 3 red — true falsifier `INV-TOOL-3` |
| `M2` `total` gets the number after cutting | exceed cap + threshold cap | 3 red, `total` says 200 instead of 250 |
| `M3` `total >= cap` (skew-one) | correct threshold cap | 1 red — indicates dead ca border |
| `M4` cap hard-code, skip configuration | under cap, cap threshold, cap-from-configuration | 3 red |

Suite: `node --test test/tools/references.spec.ts` red 3/12 before clipping, green 12/12 after; four mutants
are killed and `diff` with an empty pristine copy after reverting; `test/integration` 41/41 green;
`tsc` with correct clean project configuration for both new files. `npm test` all reports 108/116 — 8 errors
contained in `hover.spec.ts` and `diagnostics.spec.ts` of two makers running in parallel, out of scope
this turn; `references`, `tool-layer` and `definition` are all green.

## 2026-08-24 — maker — `feat-tool-hover`: `java_hover` with range is never absent

The feature's falsifier has two sides: a hover result whose position has not passed through the unique transition boundary
Most of the tool layer should be silently 0-based [INV-TOOL-1], or a SUCCESS result omits the field
`range` [INV-TOOL-6]. Touch only `src/tools/hover.ts` (new) and `test/tools/hover.spec.ts` (new);
`src/tools/tool-layer.ts` is only read because the checker is reviewing it in parallel.

**Red first, and red in the right place.** The first version of `hover.ts` is the falsifier written in code: result
success has no `range`, and `position` subtracts 1 from itself instead of receiving it from the tool layer. Oracle reported red
5/10, all red lines fall into the affirmative (`successful hover never misses range`, `expected
'String demo.Rocket.greet(String name)'`), did not result in module loading error. After actual implementation: November 11
green.

**Thin wrapper means no coordinate addition or subtraction.** `hover.ts` calls `hover()` of
tool-layer then transition intact `answer.position` and `shaped.range`. Case `INV-TOOL-1` called together
one input via two routes — `javaHover` and `callPositionalTool` — then `deepEqual` two results; deviation
a unit anywhere is a failure. Ca astral-plane targets the `dynamic` token AFTER `🚀` on the same line, with
The facade returns hover WITHOUT range (the actual path of the JDT LS), then cuts back the string from the file content using it
The range itself reports back.**Two shaping decisions recorded in `checkerNotes`.** First, "no element solved" is
explicit no-result branch `{ resolved: false, reason }` in a SUCCESSFUL outcome, not
a code X-003 — that taxonomy is closed and no code describes "no symbol here"; style
`JavaHoverResolved` forces `range` to be present so the "success missing range" status is not displayed
okay. Second, the tool table says `java_hover` returns "signature + javadoc" but the tool-layer bundles the content
hover into ONE string, so `hover.ts` only separates the presentation (the head or body of a markdown code block is
signature, the rest is javadoc) and always keep `contents` raw.

| Mutants | Ca close it | Red line |
|---|---|---|
| `M1` completely omits the `range` | field 6 cases, of which `INV-TOOL-6: all successful hovers carry range` | 6 red — correct second part of falsifier |
| `M2` wrapper subtracts 1 from `position` | basic shift + two-way `INV-TOOL-1` | 2 red — correct side one of falsifier |
| `M3` no-result masquerades as a result with `range` | `INV-TOOL-6: no-result explicitly` | 1 red — only ca aiming for death |

Suite: `node --test test/tools/hover.spec.ts` red 5/10 on stub, green 11/11 after deployment;
three mutants are all killed and `diff` with an empty pristine copy after reverting; `npm test` 117/117 green;
`npm run test:integration` 181/181 green.

## Maker 2026-08-24 — `feat-tool-definition` (in-progress, 1/3, waiting for checker)

New files: `src/tools/definition.ts` (implementation) and `test/tools/definition.spec.ts` (13 conditions).
Do not touch any other files — `src/tools/tool-layer.ts` is read-only.

**Reuse rather than copy.** `definition()` calls `callPositionalTool(facade, request, [])`: list
An empty capability list executes the three common steps of the tool layer — ask workspace for availability, read content
Currently, line/column validation — without issuing any requests. Thanks to that `invalid-position`, `unroutable`
and X-003's five workspace branches come straight from feat-tool-layer-core. The private part of the file is just playing
`textDocument/definition` and create location.

**There is no addition or subtraction of coordinates in the file.** Downward direction uses `toLspPosition`, upward direction uses
`fromLspRange`, both of the tool-layer, and applied to EVERY element in the list. A cross comparison condition`java_definition` result with hover result on same range LSP: one unit difference anywhere is
broken.

**Four LSP response shapes normalized to an array:** `Location`, `Location[]`,
`LocationLink[]` and `null`. With `LocationLink`, the result gets `targetSelectionRange` (range of main
identifier) and only fallback to `targetRange` when the server does not send. The empty array or `null` is the branch
`resolved: false` with a readable reason, not an ambiguous empty list (INV-TOOL-4).

| Mutants | Ca close it | Red line |
|---|---|---|
| `M1` only converts the first location | ca array multiple declarations + ca `LocationLink[]` | 2 red — exactly the mutant that falsifier is targeting |
| `M2` replaces `fromLspRange` with the raw mapping | 5 shifts, in which shift is cross-referenced with hover | 5 red |
| `M3` drops the no-result | branch ca empty array + ca `null` | 2 red |
| `M4` prioritizes `targetRange` | ca `LocationLink[]` | 1 red — only ca aiming for death |
| `M5` swallowed request error | ca `workspace-crashed` | 1 red |

Suite: red 6/13 on falsifier stub, green 13/13 after deployment, `diff` with
pristine is empty after reverting the mutant; `node --test test/integration/*.spec.ts` 41/41 green. Run
`npm test` has all 8 items in `test/tools/hover.spec.ts` and `test/tools/diagnostics.spec.ts` of
makers are running in parallel, none of them belong to `definition.spec.ts`.

## feat-tool-diagnostics — java_diagnostics reads push cache (2026-08-24, maker)

`src/tools/diagnostics.ts` (new) + `test/tools/diagnostics.spec.ts` (new). This is item 4 in the build
order and is the first tool to NOT issue any LSP requests: it reads back `diagnostics-cache`, so the port
`DiagnosticsFacade` intentionally does not have `request()`, only `workspace()`, `scopeOf()` and
`projectFiles()`.

**The shape that keeps INV-DIAG-1 alive:** `FileDiagnostics` is a two-branch union —
`{uri, status: "not-reported"}` and `{uri, status: "reported", problems, receivedAt, version?}`.
The "unreported" branch does NOT carry a `problems` field, including an empty array: a caller reads
`problems.length === 0` will read "not indexed yet" as "clean source code", which is a wrong answer.
falsifier description.

**The project-wide scope merges two sets:** the project's file list and the cache key. Tools panelsay `java_diagnostics` responds to "every file in the project"; an unindexed file is absent
from the cache, so if you only list the cache key, the file disappears and the answer reads the same as "that file
clean". The reverse side keeps the problem at URIs that list unnamed files (generators) from being abandoned.

**The step order is the content of the invariant:** readiness precedes every cache hit. A workspace
indexing has an empty cache, and the empty cache reads exactly the same as an error-free project (INV-TOOL-4). Test case
Try measuring that quantity directly with the counter `reads()` which should be 0.

| Mutants | Ca close it | Red line |
|---|---|---|
| `M1` merges "unreported" into "empty reported" | 3 cases of INV-DIAG-1 | 3 red — true falsifier |
| `M2` appends `problems: []` to the "unreported" | unpublished URI ca + entire project ca | 2 red |
| `M3` project scope only takes the cache key | ca entire project | 1 red |
| `M4` project scope omit URIs beyond file list | ca entire project | 1 red |
| `M5` removes readiness check | ca INV-TOOL-4 | 1 red |
| `M6` removes boundary `fromLspRange` | ca coordinates 1-based | 1 red |

Suite: red 3/6 on falsifier initial version, blue 6/6 after editing, `diff` with empty pristine version
after reverting the mutant. `npm test` 117/117 green; `npm run test:integration` 181/181 green — times
previous run 5 shifts `feat-001` red because suite unit is temporarily red due to parallel maker being repaired
`src/tools/hover.ts`, run again after they are green and clean.

---

## 2026-08-24 — `feat-tool-layer-core` round 2 (edited after REJECT), attempts 2/3

The checker's three blocking points are all real errors in the production code, not just missing test cases.

**R1 — handle leak in `#evict` (most serious).** `#evict` runs `#runDetachments(victim)` first
`await victim.started`. The `detachments` array is only full AFTER `#startWorkspace` has finished running, so one
evict falls in the middle of cold start disassembly on an empty array. `close()` evict EVERY entry, including entry
is in the "starting" state, so this is the normal route of a SIGTERM to the internal daemon
~2.3 seconds cold start — not a boundary case. Measured consequence: `attachFileSync` keeps one
handle `fs.watch` never closes, node process does not exit after `pool.close()`.Edit: `#evict` waits for `victim.started` to settle (success or failure) first, then uninstall, then
`stop()`. The old intent remains the same — detach still runs BEFORE killing the process.

**Why don't six mutants M1–M6 of round 1 see this error:** all cases `await pool.acquire()` completed
then closed, so the "starting" status has never had any cases enter. The new shift set up two roadblocks
around the spawn seam to turn that window into a defined event, and use the actual `attachFileSync` to
handle `fs.watch` becomes the observable.

**R2 — third coordinate transformation boundary.** `shapeHover` automatically adds `POSITION_BASE` in the template
string construct `HoverAnswer.reason`. A coordinate that goes out in prose is still a coordinate; old song
only requires `reason.length > 0` so the 0-based mutant survives. Now `reason` goes through `fromLspPosition`.

**R3 — branch cleanup error in `#startWorkspace`.** New case builds three attachments, second one throws error,
and requires all five things: acquire rejects the original message correctly, the third attachment does not run, detach of
The first attachment has run, `stop()` has run, and the failed start cannot be cached.

| Mutants | Ca close it | Red line |
|---|---|---|
| `R1-revert` removed before start finished | ca `close()` between spawn | 1 red, that's right |
| `C1` reason is 0-based | ca coordinates in `reason` | 1 red |
| `C3` `splitLines` only follows `\n` | ca CRLF/CR | 1 red |
| `C4f`/`C4b` casts `width = 1` | The identifier contains the letters astral | 1 red each |
| `C8` drops the cleanup block in `catch` | ca attachment throws error | 1 red |
| `C8b` swallows the attachment error | ca attachment throws error | 1 red |
| `C10` remove `.reverse()` | shift reverse order | 1 red |
| `M5`/`M6` (rebuild) | old song | 1 and 4 red — old shift not dulled |

**A real bug revealed by shift C4:** backscan in `tokenBoundsAt` using `codePointAt(start - 1)`,
But in exactly one surrogate pair, that position is the second half, not the whole pair. The token therefore stopped early
before an astral-plane letter. This width is derived from the trail surrogate band. Old Fixture only had emojis —
not identifier part — so the two `width` branches can never be distinguished.

`C11` was confirmed to be the equivalent mutant; comment in `diagnosticsAttachment`, sentence at the beginning of the specand the third shift name has been downgraded to exactly what has been proven: both jobs must run, the order must not.

`npx tsc --noEmit` according to the project's `tsconfig.json` (with `noUncheckedIndexedAccess`) is now clean
both src files. Suite: `npm test` 123/123, `npm run test:integration` 187/187. Four extra features
Runs each file separately: 42/42 green, no export signature changed.

## 2026-08-25 — `feat-prove-diagnostics`: commits again, environment recovered (maker, attempt 3/3)

The last pass in the budget tried again, and it **didn't fix a single line of code**. Attempt 2 concluded
implementation is green but baseline is red because `EMFILE` from `fs.watch()` is outside the repo; This turn only
Check to see if the host's directory monitoring quota is still exhausted or not.

| Measurement | Command | Results |
|---|---|---|
| EMFILE Diagnostics | standalone Node process, `fs.watch()` empty temp folder + repo folder + 200 new subfolders | no more `EMFILE`, all 202 trace attempts were successful |
| Oracle of features | `npm run test:integration -- test/integration/diagnostics.integration.spec.ts` | 3/3 passes, 0 failed, 0 canceled, 10.64 s |
| Full Baseline | `./harness/init.sh` | 124/124 pass, print `=== Baseline green ===` |

The diagnosis of attempt 2 was confirmed to be correct. The root cause is the folder's tracking quota
macOS runs out temporarily when multiple test processes run in parallel, not an internal defect
`DiskFileSyncWatcher` or in the canonical-URI change of `DiagnosticsCache`. Self-released quota
launch after those processes terminate, so no code changes need to be made.

`attempts` to 3/3, `readyForCheck` to `true`, `status` to keep `in-progress` — permission to set `done`
belongs to checker.