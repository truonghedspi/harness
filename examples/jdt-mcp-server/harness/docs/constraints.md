# Constraints — JDT MCP Server

Hard rules the agent must not violate (Lesson 3/4). Keep these few, absolute, and — where
possible — mechanically enforceable (a lint rule or a check in `init.sh` beats a sentence here).

## MUST

- MUST run `./harness/init.sh` to green before claiming any feature done.
- MUST keep one feature `active` at a time (WIP = 1).
- MUST record verification evidence in `harness/feature_list.json` before a feature becomes `passing`.
- MUST stop and set `status: blocked` (with a reason in `checkerNotes`) once a feature's
  `attempts` reaches its `maxAttempts` — a timebox, not a suggestion. A hard problem retried
  forever with no budget is how a loop silently burns unbounded time/compute on one feature.
- MUST give every long-running or integration-level test a bounded, stack-appropriate per-test
  timeout mechanism (e.g. JUnit `@Timeout`/`@InterruptAfter`, pytest-timeout, `go test -timeout`,
  a `[Timeout]` attribute in .NET) — a single hung test must not be able to consume the whole
  `./harness/init.sh` baseline timeout budget, and must fail loud and fast instead of hanging silently.
- MUST route every tool call to a workspace by re-deriving it from that call's own path argument via
  `project-router` — never from a cached, sticky or "last used" workspace (`INV-ROUTE-1`).
- MUST give every live JDT LS workspace its own absolute `-data` directory; never point two live
  workspaces at the same one (`INV-POOL-1`) — `-data` is where the index lives, and sharing it
  corrupts both.
- MUST make every tool call either reflect the on-disk change or fail explicitly as `resyncing`
  within its deadline — never silently answer from an LSP view known to be older than the last
  on-disk change in that workspace (`INV-SYNC-1`) — this is the correctness centre of the system
  (spike C, `harness/docs/design/evidence.md`), not a refinement.
- MUST convert every LSP position (0-based, UTF-16) to the documented 1-based coordinate system at
  exactly one boundary inside `mcp-tool-layer`; no other component may perform that conversion
  (`INV-TOOL-1`, `X-007`).
- MUST return a mutating tool's proposed edit as data by default; write to disk only when that call
  carries an explicit `apply: true` (`INV-TOOL-2`, `A-002`) — the daemon never writes unasked.
- MUST hold a code-action `actionId` resolvable only against the same workspace sync generation that
  minted it; any file change in that workspace since minting always fails the resolve (`INV-CA-1`).

### Spending human attention (the one scarce resource)

- MUST climb the exhaustion ladder before anything costs a human: registry → memory → environment
  → **spike** → prototype (`harness/docs/reference/human-attention.md`). A fact you cannot read you can
  often prove; two minutes of spike has already beaten a week of reasoning in a real project.
- MUST ask when a question survives the ladder. Over-asking costs annoyance; under-asking produces
  a wrong system that passes every test. When unsure, spend two more minutes exploring, then ask.

### Working with files and documents (applies to every agent, every session)

- MUST keep every knowledge document **≤300 lines**. Past that an agent skims it and acts on a
  partial reading while believing it read the whole thing — a failure that raises no error.
- MUST split an over-budget document the way it grew: a **topic doc** into sections, keeping the
  original filename as a map so existing links still resolve; an **append-only log** by rotating
  closed periods into a frozen, dated archive. Method: `harness/docs/reference/knowledge-layout.md`.
- MUST add every new document to `harness/docs/INDEX.md` with a *"read it when"* line. An indexed archive
  directory is exempt from the size budget — you follow its index to one entry instead of reading
  it through.

## MUST NOT

- MUST NOT use `blocked` as a way to avoid asking (enforced: `verify-harness` `escalation-without-evidence`). A blocked feature nobody is asked about is a
  question with the human removed from it — escalate it as a question instead.
- MUST NOT guess an answer that belongs to a human. Once written down, a guess is indistinguishable
  from a verified fact, and every feature built on it inherits the error while passing its tests.
- MUST NOT split a document without adding it to `harness/docs/INDEX.md` (enforced: `verify-harness` gate `docs`) — scattered files with no map
  are harder to use than the one long file they replaced.
- MUST NOT let the worker set `status: done` (enforced: `verify-harness --promote` refuses past any
  blocker; the checker agent is write-restricted) — only the checker or a verification script does.
- MUST NOT modify files outside the active feature's scope.
- MUST NOT weaken a test or a vector to make it pass.
- MUST NOT set `status: blocked` without a concrete reason (enforced: `verify-harness` `blocked-unjustified`) in `checkerNotes` (or a matching
  `harness/DECISIONS.md` entry) — an unexplained `blocked` is indistinguishable from an agent quietly
  giving up, and the checker/loop cannot judge whether it's legitimate.
- MUST NOT let anything but a single-line, valid MCP message reach the shim's stdout (enforced:
  `feat-prove-daemon-lifecycle` — captured stdout must parse entirely as single-line MCP messages;
  `INV-SHIM-1`) — every log, warning and daemon-side line goes to stderr or a file instead.
- MUST NOT delete an evicted workspace's `-data` directory (enforced: `feat-prove-pool-lifecycle` —
  asserts the directory still exists after `pool.status()` shows the workspace gone; `INV-POOL-4`).
- MUST NOT encode a tool failure (`unroutable`, `not-ready`, `resyncing`, `workspace-crashed`,
  `cap-exceeded`, `invalid-position`) as an empty successful result (enforced:
  `feat-prove-navigation-tools` — the error taxonomy exercised one case per branch; `INV-TOOL-4`,
  `X-003`) — an agent cannot tell "nothing found" from "the tool is broken" if both look the same.
- MUST NOT round-trip JDT LS's internal, opaque code-action `data` blob to an MCP caller (enforced:
  `feat-prove-code-actions` plus code review — no serializer path from JDT LS's raw response to an
  MCP result; `INV-CA-2`) — the daemon holds it server-side behind an opaque `actionId` handle.
- MUST NOT build a capability tool (`java_hover`, `java_definition`, `java_references`,
  `java_diagnostics`, `java_completion`, `java_rename`, `java_code_actions`,
  `java_apply_code_action`) before `file-sync-watcher` and `readiness-gate` both exist and are
  proven (enforced: `feature_list.json` dependency edges — every capability-tool build feature
  depends on both) — the human-accepted build order (`harness/loop/design-approval.json`,
  `harness/docs/design/tool-surface.md#Build order`) exists because a tool built first returns
  confidently wrong, well-formed answers that no tool-level test catches.

## Enforcement

For each rule above, note how it is checked (Lesson 10 — turn rules into executable checks):

| Rule | Enforced by |
|---|---|
| Baseline green | `./harness/init.sh` |
| WIP = 1 | review / `harness/feature_list.json` state |
| Attempts timebox respected | `verify-harness.mjs` (flags `attempts >= maxAttempts` with `status` still not `blocked`) |
| Long-running tests have a bounded timeout | code review / checker spot-check |
| `blocked` has a real reason | `verify-harness.mjs` (flags empty `checkerNotes` with no matching `harness/DECISIONS.md` mention) |
| Routing never drifts / no cached workspace | `feat-prove-routing` — `npm run test:integration -- test/integration/project-router.integration.spec.ts` |
| Every live workspace has its own `-data` dir | `feat-prove-pool-lifecycle` — `npm run test:integration -- test/integration/pool-lifecycle.integration.spec.ts` |
| No tool answers from a stale on-disk view | `feat-prove-sync` + `feat-prove-cross-process-integration` |
| Positions converted at one boundary only | `feat-prove-navigation-tools` — cross-checked against real byte offsets on a non-ASCII/astral-plane fixture |
| Mutating tools never write unasked | `feat-prove-rename` — asserts file mtimes across a full sweep with no `apply` |
| A code-action handle never resolves stale | `feat-prove-code-actions` — mint, edit, resolve must error |
| Nothing but MCP messages on the shim's stdout | `feat-prove-daemon-lifecycle` — captured stdout parses entirely as single-line MCP messages |
| `-data` never deleted on eviction | `feat-prove-pool-lifecycle` |
| Every tool failure is a structured error, never an empty success | `feat-prove-navigation-tools` — error taxonomy exercised one case per branch |
| Code-action `data` blob never leaves the daemon | `feat-prove-code-actions` + code review (no serializer path from JDT LS's raw response to an MCP result) |
| Build order (watcher+readiness before tools, code actions last) | `feature_list.json` dependency edges — `feat-tool-*` features depend on the previous stage's `feat-prove-*`, so the DAG itself refuses the wrong order |
