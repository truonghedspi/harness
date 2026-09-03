# Decisions Log — JDT MCP Server

The *why* behind choices (Lesson 5). Rationale is the most expensive thing to rebuild across
sessions — record it here so a future session (human or agent) doesn't involve settled calls
or repeat a rejected approach. One entry per decision. Newest first.

---

## 2026-08-26 — Human override: project WIP is 4; verification may follow implementation

- **Decision:** the human explicitly set the project work-in-progress limit to four concurrent
  features and authorized implementation to proceed before the deferred verification pass.
- **Boundary:** this changes scheduling, not truth. Each feature keeps independent state, attempt
  history, scope, and evidence; no unverified feature may become `passing` or `done`, and only the
  checker may approve `done` after the recorded command runs.
- **Planner effect:** decomposition may leave up to four independent eligible claims available. It
  does not merge them, erase their DAG edges, or manufacture evidence to make deferred tests look
  complete. complete.
- **Ownership note:** generated runtime instructions still describe the default WIP=1 policy. This
  receipt records the project-specific human override without hand-editing generated workflow files
  from the feature-planner role.

---

## 2026-08-26 — Cache-side URI canonicalization stays as unmeasured defensive redundancy

- **Source:** the approved `feat-prove-diagnostics-identity` checker follow-up. Mutant m3b removed
  only `canonicalFileUri(report.uri)` and survived the feature's 3 integration cases plus the 19
  diagnostics unit cases.
- **Decision:** choose option (a). The load-bearing canonicalization is the `projectFiles()` side of
  `projectUris()`. Canonicalizing `DiagnosticsReader.list()` output is defensive normalization at a
  structural port: the current `DiagnosticsCache` already canonicalizes on `absorb()`, so no
  present oracle measures that second call.
- **Why no feature:** this is neither a product defect nor an independent demonstrable behavior.
  Cutting a test-only feature for an intentional defensive branch would overstate the current
  contract and violate the lower size bound in `cutting-rules.md`.
- **Rejected alternative:** inject a fake reader returning a noncanonical URI. That would promote a
  permissive structural-port possibility into required behavior without a design invariant or a
  real second reader implementation demanding it.
- **Effect:** preserve the approved feature, evidence, attempts, and status. The implementation
  comment should describe the second call as unmeasured defensive redundancy, not claiming both sides
  are required to prevent duplicate physical-file results.

---

## 2026-08-25 — Unblocking `feat-prove-navigation-tools`: exit condition in block note itself satisfied

- **Source:** router stopped at `human` with four features open but none of them routable.
- **Decision:** `blocked` → `not-started`, `attempts` remains 0/3, `behavior` remains unchanged,
  `falsifier`, `verification`, `conditions` or `dependencies`. Old blocking notes remain below
  line `UNBLOCKED 2026-08-25` to save the trace.
- **Cause:** blocking note stating exit condition verbatim — "implement and specify the four
  dependencies first". All four (`feat-tool-hover`, `feat-tool-definition`, `feat-tool-references`,
  `feat-tool-layer-core`) is now `done` and has passed the checker, so `java_hover`/`java_definition`/
  `java_references` along with mcp-tool-layer and per-workspace pool are already real callable interfaces.
- **Precedent:** same form as `feat-prove-pool-crash-handling` (2026-08-22) and
  `feat-prove-daemon-lifecycle` — a block note that states an exit condition, then testing for that
  That event is the job of the planner, not of a turn maker.
- **Affects:** test-implementer return-to-queue feature; No product code changes, no changes
  tested, no other features changed.

---

## 2026-08-25 — INV-DIAG-3 loses discrimination: cut `feat-prove-diagnostics-identity`, keep `feat-prove-diagnostics` `blocked`

- **Source:** verdict REJECT of `feat-prove-diagnostics` (checker, 2026-08-25) with two findingsindependence. That feature keeps `blocked`, `attempts` 3/3, evidence and checkerNotes intact
  — this entry is the recorded block reason, so `verify-harness` is not considered `blocked-unjustified`.
- **Decision:** cut ONE new `prove` feature `feat-prove-diagnostics-identity`, oracle located in file
  NEW `test/integration/diagnostics-identity.integration.spec.ts`, with limited edit permissions for
  URI canonicalization section in `projectUris()`.
- **Cause 1 — distinguish axis of `TCON-DIAG-0003` is wrong from fixture.** Fixture second level path
  ABSOLUTELY different, while the cache key is (workspaceId, canonical URI); URI alone is enough
  In particular, `workspaceId` is an extra key element. Two mutants survived 3/3 green: m1 (Map flat lock
  only by URI) and m2 (`get()` cross-scans all workspaces on slide). Checker measured and rejected the fake
  equivalence theory: the same two mutants make 3 shifts and 2 shifts of `test/lsp/diagnostics-cache.spec.ts`
  red. The correct axis is two `workspaceId` hitting the SAME key.
- **Cause 2 — a real bug that no one has encountered yet.** `projectUris()` in `src/tools/diagnostics.ts`
  Combine `facade.projectFiles()` (caller spelling) with `reader.list()` (canonicalized) with
  `Set`; Two different character strings pointing to the same file are not sanitized, so one physical file appears two
  identical items within the project scope.
- **Why ONE feature and not two:** same root cause (identity of cache key), same
  an oracle file, and the same fixture exposes both — a real Java file under `<root>/real/...` plus
  symlink directory `<root>/link -> <root>/real` gives two ways of writing URI, same real JDT LS for
  notification line. Splitting is paying two dispatches for a single, correct seam
  `cutting-rules.md` is called splitting an integral behavior. The oracle-before order is still kept:
  test-implementer writes the shift first, the maker can only edit `src/` after a red turn.
- **Rejected option — fix `TCON-DIAG-0003` in place in the old file.** That file belongs to
  `feat-prove-diagnostics` has evidence, but the router does not return a `prove` feature with evidence
  oracle layer (memory `pre-authored-oracle-cannot-return-to-oracle-layer`). Keep the old file intact
  It's cheaper to keep track than to fix through a feature that's already out of budget.
- **Rejected option — expensive fixture with two real JDT LS pointing to the same source file.** It depends
  a premise that no one has yet stated: two workspaces living concurrently should ever keep the same URI
  canonical does not. Recorded as Human checkpoints in `loop/goal.md` according to checker section 7;
  Cheap axis does not depend on that answer because it judges the cache lock, not the two processes.
- **DAG fix:** `feat-tool-completion` changes `feat-prove-diagnostics` dependency →
  `feat-prove-diagnostics-identity`. This side is the build order port of the diagnostics phase
  (`DECISIONS/2026-08-20.md`); Hanging it on a feature that's out of budget is a whole series of four features
  `feat-tool-*` never runs again.
- **Effect:** 35 → 36 features (19 build, 16 prove, 1 baseline); new context pack
  `loop/context-packets/feat-prove-diagnostics-identity.json`; period 2026-08-23 of this file moved in
  `harness/DECISIONS/2026-08-23.md` to keep the budget 300 lines. `check-plan.mjs` has exactly one finding
  exception was thrown (`context-touches` on `feat-workspace-pool`).

---

## 2026-08-25 — `TCON-DIAG-0004`: `stateful` + `deterministic_replay`, not `integration`

- **Source:** FOLLOW-UP entry in verdict APPROVE of `feat-prove-evict-succession`. Hold feature
  original `done`; status, evidence and oracle files are not affected.
- **Decision:** atom override `TCON-DIAG-0004.json`: `behavior_shape` `integration` →
  `stateful`, `technique` `e2e_scenario` → `deterministic_replay`, `rationale` rewrite to match.
  The Planner fixes itself because the router fails to push a `prove` feature that has evidence back to the oracle layer
  (memory `pre-authored-oracle-cannot-return-to-oracle-layer`).
- **Cause:** oracle runs on the fake spawner in the unit set, not the two real components.
  `strategy-matrix.md` prohibits assigning `integration` to unit-level testable behavior with contractssimulator; Section D2 of `designer-checklist.md` prohibits `concurrent` for single-threaded event loop.
- **Edit:** `behavior` is 505 characters long, exceeding the schema limit of 500 from the previous round; reduced to 491
  by changing `the predecessor's eviction cleanup` to `its eviction cleanup`, without changing the meaning.
- **D3 exception accepted:** TP-DIAG-0001 now has a `stateful` condition without a condition
  `property_kind: invariant` included. Do not cut additional conditions: this window can only be built in two
  The acquire calls overlap, and an automatically generated command sequence can never be built.
- **Do not touch `plan.json`:** schema set `additionalProperties: false`, no notes field;
  `spec_gaps` is for vague spec, which it is not. The reason lies in the `rationale` of the condition itself.
- **Effect:** does not change `feature_list.json`, does not change product codes, does not change tests.

---

## 2026-08-25 — Mutant N1 of `#evict` is NOT equivalent: cut `feat-prove-evict-succession`

- **Source:** FOLLOW-UP entry in verdict APPROVE of `feat-tool-layer-core`, request
  `follow-up:feat-tool-layer-core:bcf69f4971bf`. Feature keeps `done`; evidence and
  checkerNotes is not touched.
- **Decision:** cut new `prove` feature `feat-prove-evict-success`, with limited edit rights
  gives exactly one comment block in `src/workspace/workspace-pool.ts`.
- **Do not choose option (b) of checker** (downgrade comment then remove shift): measurement shows order in
  `#evict` really bears the brunt, so quitting the shift is burying a real void.
- **Cause 1 — the equivalence hypothesis has been rejected by measurements.** Planner reconstructed mutant N1 on the plate
  stars `src/` outside the source tree (repo is untouched): cap 3, fake spawner, refers to the first process of
  root A has slow `stop()`. The original holds the successor's diagnostics (`reported: true`); mutant N1 does
  it becomes `false`.
- **Cause 2 — `stop()` has a real yield point.** `terminate()` sends SIGTERM then `await exited`,
  escalate SIGKILL after `STOP_GRACE_MS` = 5 000 ms. That window is wider than cold start ~2 300 ms, which is enough for
  Once re-acquired with the root project is complete.
- **Cause 3 — the current comment states the WRONG hazard.** The sentence in lines 328-329 says a notification
  late must not fall into the cache of the disappearing workspace. That thing is the innermost `forget()` itself
  The detach function deletes immediately afterwards, so it cannot falsify — exactly the reason N1 survives 28/28. Danger
  It's actually the other way around: the predecessor's late `cache.forget(workspaceId)` clears the successor's cache
  The task just took over the same identity.
- **Why is identity shared between two process generations:** `#identify` hash
  `sha256(canonicalRoot)`, pid independent. `#evict` removes entries from `#entries` before cleaning,
  so a parallel `acquire` does not see the old entry and spawns a new process under that same `workspaceId`.
- **Why do we need two parallel acquire calls:** `#ensureCapacityFor` await COMPLETELY `#evict`, so one
  A single acquire sequence could never create this situation. Same reason `INV-POOL-5` exists.
- **Rejected option — write `context.note` to `feat-tool-layer-core`.** Feature is `done`, so
  The router never gives it back to the maker. This is the correct lesson from FOLLOW-UP `lsof` dated 2026-08-23.
- **Rejected option — merged into `feat-prove-diagnostics`.** That feature is the built-in oracle running
  The real JDT LS, is `in-progress` and is blocked by an environment condition (`EMFILE` of `fs.watch`).
  Inserting a unit shift in evict order into it makes the verification command have two levels and causes the new shift to fail
  blocked by an unrelated issue.
- **Rejected option — merged into `feat-prove-cross-process-integration`.** That feature is `blocked`
  because the two dependencies have not yet started, and this racing window is only deterministic when `stop()` is injected.
- **Rejected option — feature-planner automatically corrects annotations.** Correct annotation depends on
  The second case proves it, so I should fix it first and confirm something that no one has ever measured.
- **Constraints satisfied:** `INV-DIAG-1` — readback always returns the closest payload; a file that JDT LS
  reported is not read out as "not reported". The oracle file is NEW
  `test/workspace/workspace-succession.spec.ts`, so `test/workspace/workspace-attachments.spec.ts`of a completed feature remains inviolable.
- **Impact:** 34 → 35 features (19 builds, 15 prove; DAG is still 15 levels deep at
  `feat-prove-code-actions`, new feature at level 7). `check-plan.mjs` still has an existing finding
  exception is accepted (`context-touches` on `feat-workspace-pool`).
- **Still open, out of scope for this pass:** no files in `src/` call `createWorkspacePool` or pass
  `attachments`, meaning the root composition connecting the pool + cache + tool layer, does not yet have any features.

---

## Archive

Closed periods are in `harness/DECISIONS/` — starting at `harness/DECISIONS/INDEX.md`. Ky
2026-08-19 (architecture choice, Gradle postponed) moved to `harness/DECISIONS/2026-08-19.md`
2026-08-22. Period 2026-08-20 (first feature cut, build order, two empty spaces
cut) moved to `harness/DECISIONS/2026-08-20.md` on 2026-08-23. Term 2026-08-21 (five times extension
existing `prove` feature instead of cutting new feature) moved to `harness/DECISIONS/2026-08-21.md`
same date 2026-08-23. Period 2026-08-22 (timeout missing in two integration specs; three backlogs from
`feat-workspace-pool`) moved to `harness/DECISIONS/2026-08-22.md` on the same date 2026-08-23. Ky
2026-08-23 (four FOLLOW-UP decisions: `lsof`, `probeDaemon` `error` listener, unregister function
of `attach()`, and cut `feat-lsp-notifications`) to `harness/DECISIONS/2026-08-23.md`
2026-08-25.

<!-- Template for new entry: ## YYYY-MM-DD — Title, then bullet points Decision / Cause /
     Alternative rejected / Constraint satisfied / Impact. -->