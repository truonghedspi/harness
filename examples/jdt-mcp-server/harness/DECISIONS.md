# Decisions Log — JDT MCP Server

The *why* behind choices (Lesson 5). Rationale is the most expensive thing to rebuild across
sessions — record it here so a future session (human or agent) doesn't relitigate settled calls
or repeat a rejected approach.

One entry per decision. Newest first.

---

## 2026-08-21 — Provisioner build reuses its authored behavioral oracle

- **Decision:** `feat-jdtls-provisioner` now verifies with
  `test/integration/jdtls-provisioner.integration.spec.ts`, the runnable oracle already owned by
  `feat-prove-provisioner`; the build/prove feature boundary and all existing state remain intact.
- **Reason:** the prior build verification named a nonexistent unit test and an undefined `npm test`
  script, so the maker could not obtain a behavioral red or green run. The integration suite already
  exercises all four `INV-PROV-*` invariants and has recorded red-first and mutant evidence.
- **Rejected alternative:** adding a duplicate unit oracle solely to preserve a distinct command.
  That would duplicate the same provisioner contract and add a paid test-authoring dispatch without
  an independently demonstrable claim.
- **Constraint it satisfies:** every feature has one runnable, discriminating verification while the
  independent prove feature continues to own and preserve the oracle evidence.
- **Affected:** `feat-jdtls-provisioner` verification and checker-marker resolution only.

## 2026-08-20 — Feature cut from the approved design (32 features, 10 components)

- **Decision:** Cut `feature_list.json` from `loop/design-approval.json` digest `c0a83df4b8d6c5b2`.
  `feat-001` kept and expanded (Node deps + a pinned JDT LS fixture download step); `feat-002`/
  `feat-003` placeholders retired entirely — replaced by 18 build + 13 prove features covering the
  10 named components and all 30 `INV-` ids in `docs/design/runtime-model.md` and
  `docs/design/tool-surface.md`.
- **Reason:** the design's own `## Feature impact` table names exactly these components as new and
  the two placeholders as never-real; `skills/feature-planning/scripts/check-plan.mjs` requires
  every non-baseline falsifier to cite a real invariant and every invariant to be cited — the cut is
  sized so both hold with zero findings.
- **Rejected alternative:** cutting one feature per component (10 total). Several components' own
  invariants span more than one falsifiable claim (e.g. `workspace-pool` has 5), and cramming them
  into one verification command would violate the "one verifiable claim" rule — so most components
  got a build/prove pair, several tool components got one thin build feature each sharing a
  multi-tool prove feature (`feat-prove-navigation-tools` covers hover/definition/references).
- **Constraint it satisfies:** `feature-decomposition.md` Step 3 sizing, the invariant-contract's
  forward/backward traceability, and the human-accepted build order.
- **Affected:** `feature_list.json` in full.

## 2026-08-20 — Build order encoded as real DAG edges, not just documentation

- **Decision:** `docs/design/tool-surface.md#Build order` says file-sync-watcher + readiness-gate
  land before any capability tool, and code actions land last. Rather than relying on the maker to
  read and honor that prose, the sequencing is a real dependency chain: each capability-tool stage's
  build feature depends on the *previous* stage's *prove* feature finishing
  (`feat-tool-completion` → `feat-prove-diagnostics`; `feat-tool-rename` → `feat-prove-completion`;
  `feat-tool-code-actions` → `feat-prove-rename`), and every navigation/diagnostics/completion/
  rename/code-action build depends transitively on `feat-file-sync-watcher` and
  `feat-readiness-gate` already being built.
- **Reason:** the maker picks "the first not-started feature whose dependencies are all done" — an
  unenforced ordering is only ever as reliable as the next session remembering to read the prose.
  This was an explicit ask from the requester routing this planning pass, not a default of the
  planning skill.
- **Rejected alternative:** leaving the tools as sibling features under `feat-tool-layer-core` with
  no cross-tool edges, trusting `feature_list.digest.md`'s array order. Rejected because nothing
  stops the loop from building `java_code_actions` before `java_rename` if both happen to be
  eligible at once, which is exactly the risk ordering the human accepted was meant to prevent.
- **Constraint it satisfies:** the accepted sequencing decision in `loop/design-approval.json`.
- **Affected:** every capability-tool build feature's `dependencies` array.

## 2026-08-20 — `lsp-client`'s falsifier derived from `INV-POOL-3`, not a new invariant

- **Decision:** `feat-lsp-client`'s falsifier cites `INV-POOL-3` (filed under `workspace-pool` in
  `docs/design/runtime-model.md`), not a new `INV-LSP-*` id.
- **Reason:** no design document states a dedicated invariant for `lsp-client`'s own framing/
  correlation correctness — its "Observable seam" column exists in the component table but never
  got an invariant row. `INV-POOL-3` ("every in-flight request completes with an error when its
  process exits") is the one invariant a broken id-correlation table would actually violate, and the
  mechanism that makes it true lives entirely inside `lsp-client` even though the table files the
  invariant under `workspace-pool`. This is a real, existing invariant honestly derived from, not an
  invented one — see `docs/reference/invariant-contract.md`'s "cite the id you actually derived
  from."
- **Rejected alternative:** writing `NEEDS DESIGN:` to ask for a dedicated `INV-LSP-*` id. Rejected
  because a citable, apt invariant already exists and the gap (basic Content-Length round-trip
  correctness on its own, independent of process-exit behavior) is noted in
  `loop/context-packets/feat-lsp-client.json` instead, where it can inform the test without blocking
  a foundation feature everything else in Stage 1 depends on.
- **Constraint it satisfies:** the invariant-contract's backward-traceability rule (no fabricated
  citation).
- **Affected:** `feat-lsp-client`.

## 2026-08-20 — Streamable HTTP front door (A-003) deferred out of this cut

- **Decision:** no feature was cut for the flagged-off Streamable HTTP transport in this pass.
  `feat-daemon-supervisor` and `feat-mcp-shim` are scoped to the Unix-socket path only.
- **Reason:** `A-003` confirms v1 ships the HTTP front door behind a flag, but its `Origin`-
  validation/localhost-binding/auth MUSTs (`docs/cross-cutting.md` X-010) are still an *open*
  cross-cutting row — no owner, no date, no `INV-` id anywhere in `docs/design/runtime-model.md` or
  `docs/design/tool-surface.md` covers it. `check-plan.mjs` requires every non-baseline feature to
  cite a real invariant; manufacturing one for X-010 would be exactly the "invented traceability"
  the invariant contract exists to prevent.
- **Rejected alternative:** cutting the feature anyway with no citation, or citing an unrelated
  `INV-SHIM-*`/`INV-TOOL-*` id for cover. Both rejected as dishonest coverage.
- **What would unblock this:** a design-facilitator pass that promotes X-010's recommendation into a
  real `INV-` row (or an explicit decision that the HTTP front door ships without the `Origin`/auth
  MUSTs it inherits from the MCP spec, which would itself need a human sign-off given those are spec
  `MUST`s). Reported to the human/orchestrator directly rather than encoded as a blocked feature,
  since there is no well-specified feature to attach the marker to yet.
- **Constraint it satisfies:** invariant-contract backward traceability; does not touch A-003 itself,
  which stays confirmed for whenever this is unblocked.
- **Affected:** `feat-daemon-supervisor`, `feat-mcp-shim`; no feature yet exists for the HTTP
  transport.

## 2026-08-20 — Disk-retention GC (X-006) and crash-retry (X-009) left uncut

- **Decision:** no feature covers automatic `-data` garbage collection after 30 days or a
  transparent one-time retry after a workspace crash.
- **Reason:** both are cross-cutting recommendations in `docs/cross-cutting.md`, still open, with no
  backing `INV-` id. The invariant that **is** stated for eviction (`INV-POOL-4`: eviction never
  deletes `-data`) is already covered by `feat-prove-pool-lifecycle`. Retry-after-crash is explicitly
  the agent's decision per `INV-TOOL-4`'s `workspace-crashed` error case (already covered by
  `feat-prove-navigation-tools`), not a daemon-side behavior the design commits to.
- **Rejected alternative:** cutting speculative features for both. Rejected — no invariant, no
  acceptance scenario, and `requirement.md` doesn't ask for either; these are genuine v1.1-shaped
  follow-ups, not guessed-past gaps.
- **Constraint it satisfies:** "don't invent a feature not backed by an invariant or scenario."
- **Affected:** none in this cut; flagged for whoever later promotes X-006/X-009 to closed
  decisions.

---

## 2026-08-19 — Architecture options considered and rejected (design session, approved 2026-08-19)

Recorded so a future session does not relitigate them. The full argument maps are in
`harness/docs/design/architecture.md`; the self-critique is in `harness/docs/design/critique.md`.
Human approval is on record in `harness/loop/design-approval.json` (digest `c0a83df4b8d6c5b2`).

- **Decision:** Node/TypeScript daemon, reached through a thin
  stdio shim over a Unix domain socket, with one JDT LS subprocess per Maven reactor root — plus a
  Streamable HTTP front door in v1 behind a flag.
- **Reason:** MCP stdio is per-client-launch (*"the client launches the MCP server as a
  subprocess"*), which contradicts the one-daemon-many-projects constraint. The shim resolves it at
  the edge, and the MCP spec explicitly sanctions reusing stdio framing over a Unix socket. The
  language axis matters far less than expected: JDT LS runs as a subprocess in every implementation
  found, including the Java ones.
- **Rejected — Option B, Java/LSP4J + MCP Java SDK over Streamable HTTP:** its strongest argument
  (LSP4J vs a hand-rolled Node LSP client) did not survive verification —
  `vscode-languageserver-protocol@3.18.2` covers every method needed with none missing. It also
  keeps the highest first-run friction, against an explicit OSS-audience objective, and adds a third
  JVM to a process tree already holding one per workspace.
- **Rejected — Option C, Node + Streamable HTTP only, no shim:** least code and most standard, but
  it makes the user start a daemon before their agent works. Its one surviving advantage — the
  daemon can run on a bigger machine — was absorbed as the flagged HTTP front door instead of
  rejected.
- **Constraint it satisfies:** one long-running daemon serving multiple Maven projects concurrently;
  general-purpose OSS distribution; full seven-capability v1 scope.
- **Affected:** every component in `harness/docs/design/architecture.md`; changing the transport axis
  rewrites `mcp-shim` and `daemon-supervisor` only, which is why the decision sits at the edge.

---

## 2026-08-19 — Gradle deferred, not dropped

- **Decision:** v1 supports Maven only. Workspace identity is the nearest ancestor `pom.xml`.
- **Reason:** stated constraint from the elicitation session.
- **Rejected alternative:** build-system-agnostic project detection in v1 — it would make
  `project-router` and `INV-ROUTE-1` speculative before a single Maven case works.
- **Constraint it satisfies:** v1 scope.
- **Affected:** `project-router`, `INV-ROUTE-1..3`, A-006.

---

<!-- Template for new entries:

## YYYY-MM-DD — Title

- **Decision:**
- **Reason:**
- **Rejected alternative:**
- **Constraint it satisfies:**
- **Affected:**
-->
