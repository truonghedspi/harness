---
name: flow-spec
description: Produce a rigorous, evidence-traced Flow Specification from existing code, docs, DB schema/migrations, and config/infra — for one flow or a process spanning multiple services. Captures business context, every decision branch, business/validation rules, error handling, state transitions, and external integrations/side effects, with EVERY claim traced to a source location so nothing is fabricated and no branch is missed. Use whenever the user wants to document, reverse-engineer, or understand an existing flow by reading code; needs a basis to write migration tasks for a new system that must replicate the old logic exactly; or needs a basis to generate test plans/cases covering all branches. Trigger on "đọc code viết tài liệu luồng", "reverse engineer this flow", "document the business logic", "spec for migrating X", "test coverage from code", "map how this process works across services" — even if they never say "flow spec".
---

# Flow Spec

Turn an existing flow — possibly spanning several services — into one Markdown document that is simultaneously: (1) a migration contract for an AI agent rebuilding the system, (2) a coverage source for an AI agent generating test plans/cases, and (3) a readable business + technical explanation for a human.

The single hardest requirement is **truth**: the document must describe only what is actually in the sources, and it must surface *all* logic branches. Both goals come from the same discipline — **traceability**. If a statement cannot be traced to a source location, it does not belong in the body of the document; it belongs in the "Assumptions & Open Questions" section, clearly labelled.

## Non-negotiable principles (read first)

1. **Inventory mechanically before you narrate.** Do not write prose about "what the flow does" until you have first walked the code and logged every decision point, external call, error path, and state change with its location. Narrative written from memory or intuition is how branches get missed and behavior gets invented.

2. **Every claim carries evidence.** Use the evidence notation below on rules, branches, side effects, and steps. A claim with no evidence is either moved to Open Questions or deleted.

3. **Unknown is a valid answer; invented is not.** When the sources don't tell you something, write `Chưa xác định` / `Not determined` and log it as an open question. Never fill a gap with a plausible guess presented as fact. Distinguish three confidence levels explicitly:
   - ✅ **Confirmed** — directly read from a source.
   - 🟡 **Inferred** — reasoned from evidence; state the basis.
   - ❓ **Unknown** — needs a human/owner to confirm.

4. **Reconcile before you finish.** After drafting, count the conditionals you found in code against the branches you documented. They must match or the difference must be explained. This is what guarantees "đủ nhánh".

5. **Sources can conflict.** Code, docs, DB constraints, and config may disagree. When they do, treat **code as the source of runtime truth**, note the conflict explicitly, and flag docs that are stale.

6. **Logic is pseudocode, never a rule-list.** Represent control flow in the pseudocode dialect (`references/pseudocode-dialect.md`), not as a table of independent rows. A table cannot distinguish "run both in sequence" from "choose one", so an agent reading it will re-invent conditionals (`a(); b();` → `if a return; if b return;`). Every relationship between steps must be explicitly SEQUENCE / SELECTION / PARALLEL / ITERATION. The pseudocode is the canonical artifact the new system must match 1:1; tables are demoted to a derived branch *registry* for test/migration mapping. A mandatory lint blocks output if the pseudocode is structurally incomplete.

### Evidence notation

Attach a tag to claims. Keep paths repo-relative.

- Code: `[src: order-svc/src/CheckoutService.java:L120-138]`
- Doc: `[doc: confluence/Checkout-design.md#refund-rules]`
- DB: `[db: migrations/0042_add_status.sql → orders.status enum]`
- Config/infra: `[cfg: order-svc/application.yml → retry.maxAttempts=3]`
- Event/MQ: `[mq: topic "order.paid" published in PaymentService.java:L88]`

If you only suspect a location, mark it `🟡 [src: …?]` and add an open question.

## Workflow

Work through these phases in order. Phases 1–4 produce a raw inventory; only phase 5 writes the document.

### Phase 0 — Scope and source gathering

Pin down the boundary before reading anything. Confirm with the user (or state your assumption explicitly if they're unavailable):

- **Entry point(s)**: what starts the flow — an API endpoint, a scheduled job, a consumed event, a user action.
- **Exit / boundary**: where this flow ends. For cross-service flows, list every service believed to be in scope and what's explicitly out of scope.
- **Sources available**: source code repos, existing docs, DB schema/migrations, config/infra/message-queue definitions. List the concrete locations.

Build a **Source Inventory** — a literal list of every repo path, doc, schema file, and config file you will read. Nothing may be documented later unless it traces back to something on this list. If a source you'd expect is missing (e.g., no access to a downstream service's code), record that as a known gap now — it will become an open question, not a guess.

If the entry point or boundary is genuinely ambiguous and the user is reachable, ask. Don't guess the boundary — a wrong boundary silently drops whole branches.

### Phase 1 — Mechanical extraction (per service, starting at the entry point)

Trace execution from the entry point. As you read, log **every** occurrence of the following into a running inventory, each with a location. Do not summarize yet — capture raw.

Use `references/coverage-checklist.md` as the exhaustive catalogue of what counts as a branch — read it now so you don't miss categories. The four families the user cares about (all in scope by default):

- **Business rules / validation**: every `if/else`, `switch/case`, ternary, guard clause, early `return`, pattern match, loop condition, null/empty check, boundary comparison, feature-flag check, permission/authz check.
- **Error & exception paths**: every `throw`, `catch`, error return code, fallback, default branch, timeout handler, validation-failure response.
- **External integration**: every outbound HTTP/gRPC/DB/cache/queue call, with what triggers it and what happens on success vs failure.
- **State transitions**: every write to a status/state field, every lifecycle change, every published/consumed event.

For each item record: location, the exact condition or trigger, and the divergent outcomes. A conditional you log here is a branch you must account for later.

### Phase 2 — Cross-service stitching

For each outbound call or published event found in Phase 1, follow it to the next service's entry point and repeat Phase 1 there. Maintain a **hop list** (service A endpoint → calls service B endpoint → publishes event consumed by C…). Continue until you reach the boundary set in Phase 0. Async hops (events/messages) are easy to lose — treat every published event as a hop whose consumer must be located or explicitly marked unknown.

### Phase 3 — Corroborate with DB, config, and docs

For each rule/branch in the inventory, check the non-code sources to confirm or enrich it:

- **DB schema/migrations**: `NOT NULL`, defaults, enums, unique/foreign-key constraints, check constraints — these are *enforced* rules even if the code doesn't restate them. Add them as branches/rules with `[db: …]` evidence.
- **Config/infra/MQ**: retry counts, timeouts, feature flags, topic names, queue settings, environment-conditional behavior.
- **Existing docs**: business intent and terminology. Use docs to explain *why*, but verify *what* against code. If a doc claims behavior the code contradicts, log the conflict.

### Phase 4 — (optional) confirm scope of branch families with the user

The default is to cover all four families exhaustively. If the user said they might drop a family or specific branches, present the count per family and let them confirm before you trim. Never silently drop branches.

### Phase 5 — Draft the document

Write the document using the template in `references/template.md` — read it now and follow its section order exactly. The heart is **§6: the logic as pseudocode** in the dialect defined in `references/pseudocode-dialect.md` (read it before writing §6). Translate the mechanical inventory directly into pseudocode: every conditional becomes an `IF`/`SWITCH` with a `[BR-id]` and explicit `ELSE`/`DEFAULT`; every unconditional multi-step group becomes a `SEQUENCE`/`PARALLEL`; every external call becomes `CALL … -> x` whose result is branched on; every terminal gets an `[OUT-id]`; every line carries its evidence tag. Then fill the rest of the template from the inventory, and build §6b (branch registry) as a derived index — not a second source of logic.

Where a section has nothing, write `Không áp dụng` (Not applicable) or `Chưa xác định — xem §15` rather than padding.

Write the document content in the user's working language (default: Vietnamese if the user writes Vietnamese). Keep section headers and the pseudocode keywords as defined.

### Phase 6 — Reconciliation + mandatory lint (the anti-fabrication / coverage gate)

Do not present the document until you've passed this gate.

**First, run the lint — it blocks output.** Save §6's pseudocode (or the whole spec) to a file and run:

```bash
python scripts/lint_pseudocode.py <spec-file> --expected-branches <N>
```

where `N` is the number of conditionals you counted during mechanical extraction (Phases 1–3). The linter enforces: every `IF` has an `ELSE`, every `SWITCH` a `DEFAULT`, every condition a `[BR-]`, every terminal an `[OUT-]`, every condition/side-effect line an evidence tag, every `CALL` result consumed by a branch (no dropped failure path), no duplicate ids, and `[BR-]` count == `N`. **If it exits non-zero, fix the pseudocode and re-run; do not emit the document while lint fails.** Paste the passing result into §16.

Then the manual sweeps:

1. **Branch reconciliation**: confirm the lint's `--expected-branches` check passed; if you intentionally dropped a branch (dead code, or user-confirmed), record it rather than letting counts silently differ.
2. **Evidence sweep**: any claim in prose sections lacking an evidence tag is given one, moved to §15 with a confidence label, or removed.
3. **Conflict sweep**: every source conflict from Phase 3 is recorded in §15.
4. **Reachability sweep**: every `CALL`/`PUBLISH` traces to a located target/consumer or an explicit unknown.

### Phase 7 — Diagrams (companion to the pseudocode)

Generate diagrams **from the reconciled pseudocode**, not from memory — they are a companion view, never a second source of truth. For a cross-service flow, produce a **BPMN** orchestration view (its gateways must agree with §6: an exclusive gateway = a `SWITCH`/`IF`, a parallel/plain-sequence = a `SEQUENCE`/`PARALLEL` — so "run both" can never collapse into "choose one"). Also produce a Mermaid flowchart (every `[BR-]` in §6 appears as a decision), a cross-service sequence diagram, and a `stateDiagram-v2` if the flow is stateful. If any diagram disagrees with the pseudocode, the pseudocode wins and the diagram is fixed.

### Phase 8 — Downstream readiness

Fill the three checklists at the end of the template (migration / test-generation / human review) and report to the user: the branch counts per family, the list of open questions needing their input, and any source conflicts. These open questions are the highest-value output — present them prominently rather than burying them.

## Quality bar — what a good output looks like

- A reviewer can take any rule or branch and jump straight to the code that implements it.
- A test-generation agent can produce at least one positive and one negative case per branch ID with no further reading.
- A migration agent has, for every side effect, enough to replicate it (target, payload, idempotency, retry, failure behavior).
- The "Assumptions & Open Questions" section is non-empty for any real legacy flow — its emptiness is a red flag that gaps were papered over.

## Reference files

- `references/pseudocode-dialect.md` — the canonical logic representation (Format A) + lint rules. Read before writing §6 (Phase 5).
- `references/template.md` — the exact output structure. Read before drafting (Phase 5).
- `references/coverage-checklist.md` — exhaustive catalogue of branch/side-effect types to hunt for. Read before extraction (Phase 1).
- `references/format-comparison.md` — why pseudocode+lint is the canonical choice over UML/BPMN/AST-XML (scored demo). Read if the user questions the format.
- `references/example.md` — a short worked fragment showing evidence notation and an open-questions entry.
- `scripts/lint_pseudocode.py` — the mandatory linter. Run in Phase 6; errors block output.
