# Test designer memory — JDT MCP Server

Index of what the test-designer agent has learned across runs (`harness/docs/reference/agent-memory.md`
documents the schema and why). One line per entry, always loaded — keep it short; the reasoning
lives in the linked file, read that only when the line looks relevant.

Write a new entry when a spec turned out to be ambiguous in a non-obvious way, when a behaviour's
logic shape was genuinely hard to classify, or when a condition that looked discriminating turned
out to pass against a wrong implementation. Don't write one for a routine design pass.

Write entries and hooks **in English**, whatever language the rest of the project uses: memory is
addressed to whichever agent reads it next, not to this project's readers. Entries already written
in another language stay as they are — this governs what gets written from now on.

- [INV- ids vs the REQ- id the test-condition schema requires](inv-to-req-id-bridge.md) — this project has zero REQ- ids, only INV-<AREA>-<N>; bridge INV-PROV-1 -> REQ-PROV-001 (zero-pad to 3 digits), cite the real INV- id inline, don't invent a different convention per component.
- [INV-POOL-2's cap-exceeded eviction vs A-001's 15-min idle timer](pool-2-vs-idle-timer.md) — A-001 reads like one idle-eviction policy but is two distinct triggers on the same LRU-idle rule; INV-POOL-2 only covers the cap-exceeded trigger, don't stretch it to cover the timer (no INV- id names that mechanism yet).
- [INV-SYNC-1's scope vs A-014's watcher-blind-spot content](inv-sync-1-vs-sync-2-boundary.md) — A-014 is filed against INV-SYNC-1 but its content (edit-class/tree-size watcher coverage) is INV-SYNC-2's territory, owned by a different feature; check the INV's own table text, not the assumption row's citation column, before expanding a plan's scope. Also: X-001 (deadline budget) is still open — don't trace a condition to a specific timeout number that isn't settled.
- [INV-TOOL-2's write-opt-in half is unowned for java_apply_code_action](inv-tool-2-code-actions-orphan.md) — A-002 names both java_rename and java_apply_code_action, but feat-prove-code-actions' falsifier only ever cites INV-CA-1/INV-CA-2, never INV-TOOL-2; confirmed on two independent passes (TP-TOOL-0002, TP-CA-0001). Record in spec_gaps, don't add INV-TOOL-2 conditions to a plan whose owning feature's falsifier doesn't cite it — falsifier scope is feature-planner's call.
- [checkerNotes can leak a literal implementation-code fragment](checkernotes-code-fragment-leak.md) — feat-prove-routing's checkerNotes quoted an actual code line (`mavenRoots.findLast(...)` vs `.find(...)`) describing a mutant; feature_list.json is an allowed read but that string is checker-authored from implementation access. Derive the condition from the invariant's own prose and the feature's `falsifier`/`behavior` fields instead, flag the fragment as seen-but-unused, don't let it shortcut the design.
