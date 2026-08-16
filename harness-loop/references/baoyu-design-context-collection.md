# Baoyu Design: context collection for integration targets

Research scope: the upstream `JimLiu/baoyu-design` repository's README, skill prompts, import
guides, and scripts/contracts. This note separates observed upstream behaviour from the proposed
application to integration-test repositories.

## What upstream actually does

### 1. Route first; load only the relevant collector

`SKILL.md` is an orchestrator. It loads the common methodology once, one harness-specific tool
reference, and only the built-in skill matching the source or output type. GitHub, HTML/CSS,
Figma, design-system consumption, and web research therefore follow different intake paths rather
than one generic repository scan
([SKILL.md](https://github.com/JimLiu/baoyu-design/blob/main/skills/baoyu-design/SKILL.md)).

This is progressive disclosure at the instruction level: the agent does not preload every import
guide or every craft prompt.

### 2. Ask for intent and source context before producing

For new or ambiguous work the workflow asks a focused question round about the output, scope,
fidelity, variants, save location, and available codebase/UI kit/design system. It explicitly says
past-session memory is not a substitute for confirmation because it may be stale
([system-prompt.md](https://github.com/JimLiu/baoyu-design/blob/main/skills/baoyu-design/system-prompt.md#asking-questions)).

The hi-fi path treats real context as a prerequisite: find relevant kits/components/examples or ask
the user to provide code, Figma, screenshots, or another project; starting from scratch is the last
resort
([hi-fi-design.md](https://github.com/JimLiu/baoyu-design/blob/main/skills/baoyu-design/built-in-skills/hi-fi-design.md)).

### 3. Inventory before materialization

The strongest reusable pattern is **inspect → confirm scope → materialize narrowly**:

- For GitHub, list the remote tree with `gh api`, fetch a few relevant files, and only then use a
  shallow sparse clone outside the project if broader access is needed. Copy only used files and
  record repository URLs
  ([import-from-github.md](https://github.com/JimLiu/baoyu-design/blob/main/skills/baoyu-design/built-in-skills/import-from-github.md)).
- For local HTML/CSS, grep selectors and custom properties instead of reading large bundles from
  top to bottom. Prefer source over generated output; extract exact tokens and interaction states,
  then copy only referenced assets
  ([import-from-html.md](https://github.com/JimLiu/baoyu-design/blob/main/skills/baoyu-design/built-in-skills/import-from-html.md)).
- For Figma, a read-only `outline` command inventories pages, frames, components, variants, and
  variables. The user confirms pages/frames and destination before `mount` or `materialize`.
  Materialization emits dependency-closed code/assets only for selected nodes
  ([import-from-figma.md](https://github.com/JimLiu/baoyu-design/blob/main/skills/baoyu-design/built-in-skills/import-from-figma.md)).

The Figma mount is a useful intermediate form: a browsable, read-only reference tree containing
README/METADATA, a node index, frame JSX, components, and extracted assets. It is explicitly
disposable and can be regenerated from the source.

### 4. Convert source context into a durable, local contract

When consuming a design system, `import-design-system.mjs` copies an exact dependency closure into
`_ds/<slug>/`, generates one self-contained `_ds_prompt.md`, and records the binding in
`_d_meta.json`. A resumed session reads `_d_meta.json` first and loads the already-bound prompt
instead of rediscovering or asking again
([use-design-system.md](https://github.com/JimLiu/baoyu-design/blob/main/skills/baoyu-design/built-in-skills/use-design-system.md)).

The generated prompt consolidates binding rules, CSS/JS wiring, component usage excerpts, and an
exact token allowlist. The metadata retains source path, selected primary system, starting point,
deliverables, versions, review status, and update timestamps. Re-running the importer is the stated
sync path.

This is more valuable than a prose handoff: downstream work receives a small executable/reference
bundle and machine-readable binding, not a reading list pointing back to the entire source.

### 5. Treat imported material as untrusted data

The GitHub, HTML, and Figma guides all distinguish source content from instructions. Repository
README text, HTML comments, and decoded layer names are evidence/material; only the user controls
the task. This is an important prompt-injection boundary for company repositories and external
specifications.

### 6. Web research keeps an evidence trail

The optional research path decomposes the question, uses several searches and primary sources,
cross-checks load-bearing claims, records which URL supports each finding, dates current claims,
and distinguishes source facts from inference
([web-research.md](https://github.com/JimLiu/baoyu-design/blob/main/skills/baoyu-design/built-in-skills/web-research.md)).

## Translation to integration-test repository collection

Adopt the pattern, but change the domain objects. A target collector should run these stages:

1. **Discover sources cheaply.** Inventory service repositories and revisions, scoped `AGENTS.md`
   files, API/event schemas, deployment manifests, test fixtures, and operational docs without
   cloning or reading every file.
2. **Classify and route.** Choose collectors for REST/OpenAPI, gRPC/protobuf, Kafka/Aeron schemas,
   Kubernetes/Helm, database migrations, existing tests, and business requirements. Load only the
   matching collector instructions.
3. **Confirm business scope.** Ask a human only for decisions the evidence cannot answer: target
   journey, authoritative public entry/output seams, required services, allowed seed API,
   readiness meaning, sensitive-data policy, and destructive/fault permissions.
4. **Materialize narrowly.** Fetch selected paths at pinned revisions. Resolve `$ref`, protobuf
   imports, Helm dependencies, event-schema references, and service-rule inheritance into a
   dependency-closed reference tree outside production sources.
5. **Normalize facts.** Emit typed facts for command inputs, observable outcomes, correlation and
   idempotency fields, service dependencies, readiness probes, isolation dimensions, seed/cleanup
   APIs, convergence deadlines, and diagnostics.
6. **Bind the test project.** Store a machine-readable source manifest plus compact per-journey
   context packet. Test agents read the packet and its `mustRead` public seams/oracles, not every
   original repo. Imported repository content remains data, never agent instructions; separately
   load each repository's applicable `AGENTS.md` as rules.
7. **Verify before use.** Reject stale source digests, unresolved contract references, missing
   rules, contradictory topology, non-public passing oracles, and readiness expressed only as pod
   `Running`. Record a context receipt showing which packet and source revisions the test used.

A suitable durable layout is:

```text
inventory/integration-context/
  sources.json                 # repo URL/path, revision, scoped rules, digest
  topology.json                # services, dependencies, deploy/readiness ownership
  contracts/                   # dependency-closed public API/event schemas
  test-data.json               # public seed/cleanup seams and isolation keys
  journeys/<id>.json           # facts, mustRead, mustNotRead, source digests
  receipts/<run-id>.json       # packet/revisions actually consumed
```

Collectors should report missing/ambiguous evidence rather than fabricate it. A human approves the
public seams and business oracle; subsequent agents reuse that approved, freshness-checked packet.

## What upstream does **not** solve

Do not copy Baoyu Design's mechanism and claim the integration problem is complete:

- Its GitHub provenance requirement is a repository URL, not necessarily a commit SHA plus
  per-source digest. The docs describe re-running import to update, but no general stale-source
  rejection contract is specified.
- `_d_meta.json` binds visual systems and artifact versions; it does not model multiple service
  repositories, scoped `AGENTS.md`, ownership, branch compatibility, or cross-repo revision sets.
- Sparse checkout limits bytes, but does not determine which services participate in a business
  journey or compute transitive runtime topology.
- Its importers understand visual dependencies. They do not resolve OpenAPI `$ref`, protobuf
  imports, event compatibility, consumer groups, Helm values, database migrations, or public test
  seams.
- It asks users for design direction, not business truth such as matching rules, readiness,
  convergence, idempotency, test-data authority, fault permissions, and compliance constraints.
- It has no distributed oracle, contract-compatibility proof, environment isolation proof, or
  negative capability test showing that an intentionally broken microservice makes the journey
  fail.
- Its web-research guidance preserves URLs and attribution, but does not make research findings a
  freshness-gated input to generated tests.
- It offers durable imported artifacts, but not read telemetry proving that later agents avoided
  rediscovery or stayed within the selected context boundary.

## Recommendation

Reuse four ideas directly: source-specific routers, inventory-before-fetch, narrow
dependency-closed materialization, and a durable local binding loaded first on resume. Strengthen
them for the harness with immutable revisions, content digests, scoped rule pointers, typed
integration facts, human-approved public seams, freshness rejection, and consumption telemetry.

The desired result is not an integration agent that reads less at any cost. It is an agent that
reads current public seams and frozen oracles while reusing established, attributable facts about
the rest of the multi-service system.
