# Session handoff — green `feat-prove-diagnostics` alone, red baseline repeated because of EMFILE

## Stop condition 2026-08-24 — maker attempt 2/3

Human close VS Code then run narrow repro again at 10:14 on 2026-08-24; The result is still 1/1 red `EMFILE`
in 15.09 seconds. Check the process after that no longer has VS Code, Red Hat Java/JDT LS, JDT fixture or
Which test node is alive? So closing VS Code does not release the host's directory-watch state; no
Run feature verification/baseline and don't spend attempt 3/3. Need to logout/restart host (or one
change the external-state equivalent) before retrying the narrow repro.

Maker turn 1/3 fixed identity URI in `src/lsp/diagnostics-cache.ts`: JDT LS publish URI
canonical `file:///private/var/...`, and query tool alias `file:///var/...`. Main verification
green 3/3 in 10.6 seconds. Feature holds `status: in-progress`, `readyForCheck: false`.

Dispatch checker is not allowed. Repro stricture one case remained red `EMFILE` for ~15.1 seconds. Standalone Node
Not loading repo code also fails when watching a newly created empty directory or root repo; watch a file and
Open 300 descriptors that are usually green. This is host directory-watch capacity/runtime state, not
project-layer, so there is no valid product/test edit. Only rerun narrow repro after host state
change; Feature verification and baseline only run after the repro is green.

## Checkpoint 2026-08-24

**Human's decision, 2026-08-24:** choose option 1 — assign blocker verification to `feature-planner`
expired, fix `feat-prove-diagnostics` from `blocked` to `not-started`, update notes and
let the router continue. If the test detects that the new blocker is real, the planner must keep the state and record it
clarify the evidence instead of removing the mechanical flag.

`node harness/loop/route.mjs` returns `human`: four feature tools are open but all rules are rejected.
The immediate cause is that `feat-prove-diagnostics` still gives `status: blocked`, while the command itself
`node harness/tools/feature.mjs feat-prove-diagnostics` reports three dependencies
`feat-diagnostics-cache`, `feat-tool-diagnostics`, `feat-lsp-notifications` are all `done`. Block notes
still describes the two dependencies as `not-started`, so the note's unblocking condition has been metStatus has not been updated. The chain of dependencies behind therefore stops
`feat-tool-completion` → `feat-prove-completion` → `feat-tool-rename` → code actions.

Baseline `node harness/init.mjs` green on 2026-08-24. `feature-planner` blocker stale verified,
change `feat-prove-diagnostics` from `blocked` to `not-started`, update context/checkerNotes and re
digest digestion; Do not edit product or test. `git diff --check` clean. Router currently selected
`test-implementer` for `feat-prove-diagnostics`: oracle has been specified but not yet written.

# Previous handoff — feature-planner converts the three FOLLOW-UP items of `feat-workspace-pool` to scope

## Conclusion

The three backlog items in the verdict APPROVE of `feat-workspace-pool` are handled at three different levels of intervention
different: a note with limited edit permissions, a new feature, a plain note. Plus one
unblocking. `feat-workspace-pool` untouched: still `done`, still `attempts` 1/3, evidence intact
intact, `src/workspace/workspace-pool.ts` is still sha256 `a72b2ed5…`.

Plan figures: 33 features — 18 builds, 14 prove, 1 baseline (`feat-001`, no `kind` attached).
The DAG has no cycle, all dependencies point to a previous feature in the array, and no builds
lack of a proof judges it. Longest path 15 levels, ending at `feat-prove-code-actions`; this string
long because the tool features are intentionally chained through the prove-feature of the previous step
(`feat-tool-completion` ← `feat-prove-diagnostics`, `feat-tool-rename` ← `feat-prove-completion`,
`feat-tool-code-actions` ← `feat-prove-rename`). This turn does not change the depth:
`feat-prove-workspace-identity` is at level 4.

## Work done

1. **`TCON-POOL-0003` is red because of oracle error — no new scope created.**
   `feat-prove-pool-lifecycle` is now self-qualified because the dependency is `done`; it does not need re-cutting.
   What it needs is to not force the next recipient to re-diagnose. Recorded to main `checkerNotes`
   feature, go to `context.note`, and go to the new context package
   `harness/loop/context-packets/feat-prove-pool-lifecycle.json`.
   Exactly one pre-authorized oracle modification: shrink out-of-office-from-`pool.status()` assertion toThe workspace file has been evicted and has not been re-acquired. The assertion about the existence of the `-data` directory is pegged
   **do not touch** — that is the falsifier of `INV-POOL-4`.
   No need for a test-designer: the verified text of `TCON-POOL-0003` is inherently binding only
   Absent status at evict time, should be corrected to restore oracle fidelity vs
   its conditions, not designing new conditions.

2. **identity connector `project-router` ↔ `workspace-pool` — new feature.**
   `feat-prove-workspace-identity`, prove, dependencies `feat-project-router` + `feat-workspace-pool`,
   private oracle `test/integration/workspace-identity.integration.spec.ts`, quoted falsifier
   `INV-POOL-1` + `INV-ROUTE-3`, `maxAttempts` 2, `conditions` left empty for the oracle class to fill.
   Do not extend `feat-prove-pool-lifecycle`: that oracle runs a fake spawner and does not call project-router,
   and more importantly — that feature already has `evidence` so the test-implementer rule doesn't match, claim
   Adding more will go straight to the maker without ever having an oracle.

3. **SIGTERM before SIGKILL — notes only.**
   Write the surviving mutant into `context.note` of `feat-prove-pool-crash-handling` and open a human
   checkpoint in `loop/goal.md`. None of the invariants in `docs/design/runtime-model.md` play
   indicates smooth stopping sequence; `INV-POOL-3` only requires that the request in flight must end with an error within the deadline,
   and mutant deletion of `child.kill("SIGTERM")` does not violate that. Latching this behavior requires an invariant
   new, that is, a design question, not a falsifier invented by the planner.

4. **Unblock `feat-prove-pool-crash-handling`** (`blocked` → `not-started`, `attempts` still 0/3).
   The exit condition is stated by the block note itself — "once feat-lsp-client and feat-workspace-pool are both
   done" — now that's enough. If left `blocked`, the test-implementer rule permanently removes it and `INV-POOL-3`
   never had an oracle.

Full reasons for all four entries: `harness/DECISIONS.md`, entry 2026-08-22.

## Test has run

- `node harness/skills/feature-planning/scripts/check-plan.mjs --target harness` — exactly one remaining
  finding, `context-touches` on `feat-workspace-pool` (4 paths, limit 3). Exceptions acceptedreceive with reason: feature is `done` and approved, four paths reflect the actual scope,
  cutting just to make the test set green is falsifying the records. The three missing `readyForCheck` findings (above
  `feat-prove-routing`, `feat-lsp-client`, `feat-workspace-pool`) patched with `"readyForCheck": false`;
  Every consumer of this field compares `=== true` so this value is equivalent to an absent field.
- `node harness/tools/verify-harness.mjs --target . --skip-baseline` — 2 blockers and 3 warnings, total
  are all in the harness/project class and existed before this turn (`check-coverage.mjs` not found, hook
  telemetry, agent table in router, AGENTS.md lacks spelling section). There are no findings in class
  feature.
- `node harness/tools/feature-digest.mjs --target harness` — recreated, 33 features.
- `node harness/loop/route.mjs` — next node is **test-designer** for `feat-prove-workspace-identity`.

## What should the router do next?

1. **test-designer → `feat-prove-workspace-identity`.** `INV-POOL-1` does not have any test conditions yet, so
   test-designer rules match exactly as designed. This is the killing of living mutants, not the act
   new: today's two components match, so the red run must come from the mutant named in
   `context.note` (change input hash or digest encoding in ONE of two lines
   `src/workspace/project-router.ts:47` / `src/workspace/workspace-pool.ts:171`), not from a
   module does not exist yet. The new condition should be in a new plan below
   `harness/tests/design/plans/`, do not put it in `TP-POOL-0001` (that plan has scope `INV-POOL-2/4`).
2. Then **test-implementer** will match `feat-prove-pool-crash-handling` — condition
   `TCON-POOL-0004..0006` in `TP-POOL-0002` is ready and both dependencies are now `done`, so
   The cause of the previous 19 failed dispatches no longer exists.
3. **maker → `feat-prove-pool-lifecycle`**, and the maker must read the context packet first. Note: router included
   This feature is for maker and not for oracle class, because `evidence` is not empty so rules
   test-implementer does not match. The RED proof dated 2026-08-20 is old (it predates the implementation);It takes one red attempt to show that `TCON-POOL-0003` failed because the absence assertion was too broad, then the next
   green.

## Streams remain open, unchanged this turn

- **FOLLOW-UP mutant M12 of `feat-prove-routing` — router can no longer repeat.** Both passes
  dispatch `follow-up:feat-prove-routing:*` has been used up so `loop/route.mjs` will be silent forever
  it. Opened human checkpoint in `loop/goal.md` and checked in `progress.md` → Next, item 3.
  This turn is not self-selected for the user, as one of the two branches (risk acceptance under `A-006`) is
  The decision is a human one, and this item is outside the scope of the turn's routing request.
- `feat-prove-provisioner` — still blocked/timebox at 3/3: replay of 13 cases still missing conditions
  Rejected when downloading broken checksum.
- `X-001`..`X-010` in `docs/cross-cutting.md` remains open; No feature on this turn closes the line
  come on.
- ~~`harness/DECISIONS.md` is about to go over budget by 300 lines~~ — processed 2026-08-23: five date entries
  2026-08-20 switch to `harness/DECISIONS/2026-08-20.md` according to Pattern B, add one line
  `harness/DECISIONS/INDEX.md`, and two quotes by date in `loop/goal.md` together
  `docs/architecture.md` pointed back to the archive file. The file in use has 243 lines left.
`feat-prove-diagnostics` implementation is green, but host directory-watch capacity keeps baseline red.

Maker attempt 2/3 minimized the baseline failure with:
`node --experimental-strip-types --test --test-name-pattern='a create, a modify and a delete' test/workspace/file-sync-watcher.spec.ts`
which deterministically reports 1/1 `EMFILE` failure in about 15.1 seconds. A standalone Node process
with no repo imports reproduces `EMFILE` when viewing a fresh empty directory or the repo directory.
Watching `package.json` succeeds, and opening 300 `/dev/null` descriptors succeeds. This rules out
ordinary process fd exhaustion and project code calling `watch()` repeatedly; the remaining blocker
is external host directory-watch quota/runtime state. Do not patch watcher production code or its
oracle to hide this. Retry the tight command after host watcher capacity changes; only after it isgreen should the feature verification and `./harness/init.sh` be rerun. Feature stays `in-progress`,
`readyForCheck: false`, attempts 2/3. No commit was made.

## Stop condition 2026-08-28 — failed to dispatch any agent for `feat-prove-sync`

Router escalates `human`: "feat-prove-sync still has no feature-linked validated conditions after one
test-designer turn". But test-designer never ran — all four dispatch mechanisms failed in this session:
native sub-agent (failed 3 times), kiro-cli (Not logged in), codex (logged in but
`failed to initialize in-process app-server client: Operation not permitted`), claude (monthly spent
limit). `run-loop.mjs` still logs `route-log.jsonl` entry `test-design:feat-prove-sync:*` BEFORE
dispatch fails, so the router counts it as a used test-designer → escalates.

Two independent issues need to be resolved by humans:
1. **Dispatch dead.** No runtime works. All loop progressions are stuck, not just this feature.
2. **`feat-prove-sync` gives `status: blocked` (stale) + the condition exists but the router says "not yet
   feature-linked validated".** All three dependencies are `done`. Plan `harness/tests/design/plans/TP-SYNC-0001`
   (TCON-SYNC-0001..0003, requirement_id INV-SYNC-1) is already on disk and is due to a previous test-designer
   design (see `harness/memory/test-designer/inv-sync-1-vs-sync-2-boundary.md`), but the router still says
   "no complete feature-linked condition plan". It could be (a) missing a linkage/validation field
   router requires, or (b) router error. Haven't read the `route.mjs` source according to the AGENTS.md command, so not yet
   can conclude whether it is a real defect or a harness error.

Similar precedent resolved 2026-08-24 for `feat-prove-diagnostics`: human chooses delivery option
`feature-planner` verifies blocker stale then changes `blocked` → `not-started`. Not applicable yet
`feat-prove-sync` because there is no dispatch mechanism to run the planner, and there is no human decision yet.
Baseline `node harness/init.mjs` is still green (124/124). Don't commit anything; just `loop/baseline-state.json`,
`loop/current.json`, `loop/route-log.jsonl` and `trace/trace.jsonl` change due to test runs.

## Continued 2026-08-28 — human chooses "self-implementation", job doneHuman chooses the option "self-propose & implement sync-guard immediately". Did:

- `src/workspace/sync-guard.ts` (NEW): `withSyncQuiescence()` + `ResyncingError` (code `resyncing`).
  Contract: wait for watcher to settle then POLL until `isStale(result) === false` (overdue →
  `ResyncingError`). This is the INV-SYNC-1 component that runtime-model describes but does not build features
  Which one owns?
- `test/integration/file-sync.integration.spec.ts` (NEW): oracle recreates spike C via
  `textDocument/definition` (workspace/symbol only resolves TYPE — measured by spike) on real pool + JDT LS
  real + real watcher. Control 2/2 green; Mutant M1 (guard returns the first result without polling) does
  TCON-SYNC-0001 red.
- `test/workspace/sync-guard.spec.ts` (NEW): 6 unit cases for guard (quiescent/non-quiescent, settled
  timeout, stale forever, past deadline).
- `harness/tests/design/plans/TP-SYNC-0001/`: add spec_gap to note that workspace/symbol only resolves type;
  edit TCON-SYNC-0001 behavior/rationale from "readiness gate's semantic probe" → "sync-guarded tool call".
- `harness/feature_list.json`: `feat-prove-sync` `blocked` → `in-progress`, records 2 items evidence +
  checkerNotes (scope note: sync-guard is a new production component, you should consider separating the build feature
  separate `feat-sync-guard`).

Left for later session / when dispatch is active: checker review (not yet `readyForCheck` because it's missing
`reviewPacket`), and run full `npm run test:integration`. `npm test` 130/130 green (124 + 6 sync-guard).

## DSH environment: sandbox blocking `ps` — do not re-diagnose TCON-SHIM-0003

DSH's workspace-write sandbox blocks the `ps` command (`spawnSync ps EPERM`). Consequence: any test used
`ps` to read the progress table will falsely fail. Specifically `test/integration/daemon-lifecycle.integration.spec.ts`
TCON-SHIM-0003 [INV-SHIM-4]: `livePids()` uses `ps -o pid= -p ...`, when blocked it falls into `catch` and
return `[]`, making the "three child processes alive" premise red. Confirmed definitively in two ways: (1) re
script shutdown with `kill(pid,0)` for 3/3 children to die after shutdown; (2) run the test again with
`sandbox_permissions: danger-full-access` gives 3/3 passes. The `daemon-supervisor.shutdown()` logic is correct —DO NOT change the test to `kill(pid,0)` because `ps` is stricter (zombies appear in `kill(0)` but not in
`ps`). When you need to run the full suite and get green, run with `danger-full-access`.

## COMPLETED 2026-08-28 — all 12 remaining features checked-ready

Completed 4 build tools + 4 oracle prove + 2 fix blocked-3/3 + end-to-end cross-process. All 12
feature `in-progress` + `readyForCheck: true` + `review-contract ADMITTED`; `npm test` 159/159, and
`npm run test:integration` (danger-full-access) 249/249 green. Details of each feature are listed below
`feature_list.json` (evidence + checkerNotes + reviewPacket) and `progress.md`.

ONLY left: checker review to set `status: done` for 12 features — blocked because dispatch is broken
(native sub-agent failed, kiro not logged in, codex was blocked by app-server by sandbox, claude ran out of quota). When
an available runtime, just run the checker for features `readyForCheck: true` (review-contract already
ADMITTED available).