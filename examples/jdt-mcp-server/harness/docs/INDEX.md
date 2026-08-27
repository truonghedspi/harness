# Document index — JDT MCP Server

The map an agent reads to decide **what else to read**. One line per knowledge document; the
"Read it when" column is the load-bearing part — a bare list of filenames makes an agent open
everything, which is exactly what this file exists to prevent.

Every knowledge document stays under **300 lines** (`harness/docs/reference/knowledge-layout.md`); when one
grows past that, split it by section (topic docs) or rotate it by period (append-only logs) and add
the new files here.

| Document | Read it when |
|---|---|
| `AGENTS.md` | Start of every session — the router, DoD, work rules |
| `harness/docs/architecture.md` | You need the five Fresh-Session-Test answers about this project |
| `harness/docs/constraints.md` | Before writing code — the MUST / MUST NOT rules |
| `harness/docs/testing-standards.md` | Choosing which test tier a change needs |
| `harness/docs/definition-of-done.md` | Deciding whether something is actually finished |
| `harness/docs/assumptions.md` | Before trusting a design conclusion; a `needs-human` row stops the loop |
| `harness/docs/cross-cutting.md` | Before picking a mechanism for retry / identity / timeouts — it may already be owned |
| `harness/docs/design/` | Before changing a subsystem someone has already designed |
| `harness/docs/design/architecture.md` | You need the option space, the PrOACT frame, the component map and the feature impact |
| `harness/docs/design/evidence.md` | Before trusting *any* fact about JDT LS, MCP or the prior art — every claim's citation lives here |
| `harness/docs/design/runtime-model.md` | Working on routing, the JDT LS pool, file sync, readiness or the daemon/shim lifecycle — and for the `INV-ROUTE/POOL/SYNC/READY/SHIM/PROV` invariants |
| `harness/docs/design/tool-surface.md` | Adding or changing an MCP tool, or cutting features — the tool catalogue, result rules, `INV-TOOL/CA/DIAG` invariants, and the build order |
| `harness/docs/design/critique.md` | Before accepting or overriding the recommendation — the assumptions check, premortem, devil's advocacy, and what would change the recommendation |
| `harness/DECISIONS.md` | "Why is it like this?" — decisions with their rejected alternatives |
| `harness/DECISIONS/INDEX.md` | The live log doesn't answer it — closed periods rotated out of `DECISIONS.md`; open one entry from the index, never the whole archive |
| `harness/progress.md` | "Where were we?" — cross-session state |
