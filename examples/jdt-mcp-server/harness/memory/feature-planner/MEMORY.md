# Feature-planner memory — JDT MCP Server

Index of what the feature-planner has learned planning across passes for this project
(`harness/docs/reference/agent-memory.md` documents the schema and why). One line
per entry, always loaded — keep it short.

Write a new entry when a feature you sized turned out wrong mid-project (too big, wrongly cut, a
dependency you missed) and the reason wasn't obvious from `harness/docs/reference/feature-decomposition.md`
alone — something specific to how *this* project's requirements are shaped. Don't write one for a
routine re-plan; that's expected, not a lesson.

Write entries and hooks **in English**, whatever language the rest of the project uses: memory is
addressed to whichever agent reads it next, not to this project's readers. Entries already written
in another language stay as they are — this governs what gets written from now on.

<!-- - [Title](slug.md) — one-line hook -->

- [A declared port does not mean the connector is owned](port-declared-but-connector-unowned.md) — the component declaring the `interface` port in its own file is the correct boundary, but if no feature owns the port implementation class then it is an unowned scope; grep portname on `src/`, only one file mentions the hanging port.
- [An sequential mutant is only equivalent if the successor is not observable](equivalent-mutant-claims-need-the-successor-check.md) — the resource clears keys according to identity (root's hash) rather than by process generation, while the second observer is the successor workspace; Copy `src/` to draft folder, patch mutant, run probe instead of concluding by reading.
- [Stage-gate-edge pointing to a `prove` feature will block the whole chain when that feature runs out of budget](stage-gate-edge-into-a-prove-feature-dams-the-chain.md) — router reporting "none routable" and the named features are clean then goes back `dependencies` to the first `blocked` link; The build→prove edge is the ordering gate that turns the `maxAttempts` of the `prove` feature into the limit of the entire downstream branch.
- [A pre-written oracle cannot return to the oracle layer after having evidence](pre-authored-oracle-cannot-return-to-oracle-layer.md) — if the `prove` feature has an empty `evidence`, the router can only give it to the maker, and the maker is prohibited from editing the test: he must write limited edit permissions into the entry, or cut off the new oracle feature.