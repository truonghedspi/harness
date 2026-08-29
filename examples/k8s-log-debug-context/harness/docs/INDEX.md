# Document index — Kubernetes Log Debug Context

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
| `harness/docs/design/opensearch-retention.md` | Before changing feat-004's OpenSearch policy, daily index, bootstrap, or permissions |
| `harness/docs/design/` | Before changing a subsystem someone has already designed |
| `harness/docs/design/log-debug-context.md` | Before planning or changing collection, ingestion, indexing, or MCP query behavior |
| `harness/docs/design/collector-contract-launch.md` | Before implementing or proving the real collector pipeline outside a cluster; it is pending owner approval |
| `harness/docs/design/collector-ingress-mechanism.md` | Before implementing or proving feat-009's collector→ingest wire — why OTLP is the wire and where the v1 object is decoded |
| `harness/docs/design/cluster-access-policy.md` | Before writing feat-010's rbac.yaml/networkpolicy.yaml — the concrete RBAC verbs, ServiceAccounts, JWT mechanism, OpenSearch knob, and NetworkPolicy edges |
| `harness/DECISIONS.md` | "Why is it like this?" — decisions with their rejected alternatives |
| `harness/progress.md` | "Where were we?" — cross-session state |
