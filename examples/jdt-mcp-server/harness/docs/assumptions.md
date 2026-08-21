# Assumption registry — JDT MCP Server

Every **load-bearing** assumption a design rests on. This file exists because an unexamined
assumption is the most expensive defect in the loop: it makes a wrong design look right, and the
checker cannot catch it (the checker verifies implementation against the spec, never the spec
against reality). Contract: `harness/docs/reference/design-engineering.md`.

**Status values**
- `verified` — with *how*: a `path:line` citation, a spike that ran, or a dated human statement.
  The design-facilitator's own confidence is never verification.
- `assumed` — plausible but unverified. The **If false** column is mandatory: without a stated
  blast radius nobody can judge the risk.
- `needs-human` — cannot be known from the repo (deployment fact, business intent, risk appetite).
  **This is the only status that stops the loop.**

Every `needs-human` row **must** carry a **Recommended answer** with its reasoning. Asking bare
("what should the retry policy be?") hands the work back and costs minutes of a person's thinking;
asking with a recommendation ("exponential capped at 30s, because X — agree?") costs seconds and
turns the job from *generating* an answer into *evaluating* one. It also exposes the answer the
agent would otherwise have assumed silently.

| id | Assumption | Status | If false | Recommended answer | Depended on by |
|---|---|---|---|---|---|
| A-001 | A default cap of **3** concurrent JDT LS instances, evicting LRU-idle after 15 min, is the right memory posture for a developer laptop | verified — human confirmed the recommended answer, 2026-08-19 | the daemon either thrashes (cap too low) or takes the machine down (cap too high) — premortem cause 2 | Confirmed: 3, with `--max-workspaces`, evict LRU-idle after 15 min | `workspace-pool`, `INV-POOL-2` |
| A-002 | Mutating tools (`java_rename`, `java_apply_code_action`) **return the proposed edit as data** and only write to disk on an explicit per-call `apply: true` | verified — human confirmed the recommended answer, 2026-08-19 | either the daemon writes behind an agent's back (unrecoverable in an agent loop) or every rename costs the agent an extra round-trip | Confirmed: return as data; `apply: true` is opt-in per call | `mcp-tool-layer`, `INV-TOOL-2` |
| A-003 | v1 ships the Unix-socket shim **and** a Streamable HTTP front door behind a flag | verified — human confirmed the recommended answer, 2026-08-19 | either the memory ceiling has no escape hatch (socket only) or v1 carries security surface it did not need (`Origin` validation, auth) | Confirmed: ship both; HTTP off by default | `daemon-supervisor`, `mcp-shim` |
| A-004 | v1 targets macOS and Linux; Windows lands in v1.1 via a named pipe | verified — human confirmed the recommended answer, 2026-08-19 | Windows users hit a hard wall on day one, on an OSS tool aimed at strangers | Confirmed: defer Windows to v1.1, record it like Gradle | `mcp-shim`, `daemon-supervisor` |
| A-005 | The tool **downloads and pins** a JDT LS distribution on first run rather than bundling it | verified — human confirmed the recommended answer, 2026-08-19 | either the npm package carries 51 MB of EPL-2.0 payload, or a proxied/offline machine cannot install at all — premortem cause 3 | Confirmed: download and pin, with a `JDTLS_HOME` override and a clear offline error | `jdtls-provisioner`, `INV-PROV-2`, `INV-PROV-3`, `INV-PROV-4` |
| A-006 | A call path enclosed by an ancestor POM declaring `<modules>` belongs to that outermost reactor workspace; otherwise its project is the nearest ancestor `pom.xml` | assumed | multi-module repos get either N instances (memory blow-up) or wrong-scoped results | — | `project-router`, `INV-ROUTE-1`, `INV-ROUTE-3` |
| A-007 | JDT LS answers concurrent in-flight LSP requests on one connection without corrupting state | assumed | `workspace-pool` must serialise per workspace, and every tool's latency compounds under a busy agent | — | `lsp-client`, `workspace-pool` |
| A-008 | `workspace/didChangeWatchedFiles` is sufficient for every edit class, including create, delete and rename | assumed | some edit class silently leaves a stale model — the spike-C failure, reintroduced through a gap rather than an omission | — | `file-sync-watcher`, `INV-SYNC-2` |
| A-009 | A `pom.xml` change needs `java/projectConfigurationUpdate`, not just a watched-file notification | assumed | dependency changes produce confidently wrong diagnostics until the daemon restarts | — | `file-sync-watcher`, `INV-SYNC-3` |
| A-010 | Idle RSS scales with project size roughly as the reported 1–16 GB heap configurations suggest | assumed | the A-001 cap default is wrong by an order of magnitude in either direction | — | `workspace-pool`, A-001 |
| A-011 | A semantic probe is a reliable index-readiness test | assumed | the readiness gate opens early and the first answers after warm-up are wrong — a variant of premortem cause 1 | — | `readiness-gate`, `INV-READY-2` |
| A-012 | **Warm restart saves enough on a real repository to justify the daemon at all** | assumed | the entire architecture is over-built; a plain per-session stdio server would do | — | every component; this is premise P4 in `critique.md` §1 and the single measurement most worth buying |
| A-013 | Concurrent JDT LS instances resolving Maven artifacts into the same `~/.m2` do not contend or corrupt | assumed | concurrent first-starts across projects intermittently fail or hang during dependency resolution | — | `workspace-pool`, `INV-POOL-5` |
| A-014 | A recursive filesystem watcher observes every relevant change, including temp-write-then-rename and edits under large source trees | assumed | staleness returns through the watcher's blind spot instead of its absence | — | `file-sync-watcher`, `INV-SYNC-1` |
| A-015 | JDT LS requires a Java 21+ runtime; the machine may not have one | verified — upstream README, quoted in `harness/docs/design/evidence.md`; spike A ran it on Temurin 25.0.3 | — | — | `jdtls-provisioner`, `INV-PROV-1` |
| A-016 | JDT LS does not detect on-disk edits by itself and answers from a stale model until notified | verified — spike C, `spikes/jdtls-disk-sync.mjs` | — | — | `file-sync-watcher`, `INV-SYNC-1` |
| A-017 | A misrouted query returns an empty result rather than an error | verified — spike B, `spikes/jdtls-two-projects.mjs` (`definitionFromB_aboutAsFile: "[]"`) | — | — | `project-router`, `INV-ROUTE-1` |
| A-018 | Code actions come back unresolved and need a `codeAction/resolve` round-trip | verified — spike D, recorded in `harness/docs/design/evidence.md` | — | — | `mcp-tool-layer`, `INV-CA-1` |
| A-019 | JDT LS's `textDocument/hover` reply **never** carries a `range`, so `java_hover`'s position must be minted by the daemon or not exist at all | verified — `HoverHandler.java:50-52` (no `setRange` on the path) and `JDTLanguageServer.java:686-690` (pure delegation), read at `v1.60.0` and identical to `master`; quoted in `harness/docs/design/evidence.md` | — | — | `mcp-tool-layer`, `INV-TOOL-6` |
| A-020 | The token extent the daemon computes from file content **agrees with the element JDT LS actually resolved** at that position | assumed | `java_hover` reports a `range` JDT LS never vouched for — a self-consistent wrong answer, which is this project's signature failure mode rather than a cosmetic one. Bounded by `INV-TOOL-6`'s fixture check, which catches disagreement caused by coordinate conversion but **not** disagreement caused by JDT LS resolving a wider construct than the token under the cursor | — | `mcp-tool-layer`, `INV-TOOL-6` |

`A-006` through `A-014`, and `A-020`, are `assumed`, not `needs-human`: each is a *fact* about JDT LS or the
filesystem that a spike can settle, and the exhaustion ladder
(`harness/docs/reference/human-attention.md`) says a spike beats a question. They are listed so the
blast radius is visible before someone builds on one.
