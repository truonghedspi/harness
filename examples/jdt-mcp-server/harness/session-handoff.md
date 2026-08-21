# Session handoff — design approval required after routing clarification

Downstream work is correctly stopped until a human approves the current design revision.

- `node harness/loop/route.mjs --json` selects `human` at the `design` layer: digest `3d68e0857fbfac45` has no matching approval.
- The current approval records old digest `cc42ac15e4bfd912`, so it cannot authorize the revised design.
- The design revision resolves both `NEEDS DESIGN:` markers: `harness/docs/design/architecture.md` recommends one workspace per enclosing Maven reactor, otherwise the nearest POM; `INV-ROUTE-1`, A-006, the feature behavior, and the five-case integration oracle now agree.
- `feat-project-router` and `feat-prove-routing` retain their markers until the feature-planner clears them after a human lock. The design-facilitator must not clear them or edit `feature_list.json`.
- Do not manufacture `status: approved`. A human must write `harness/loop/design-approval.json` with digest `3d68e0857fbfac45`, their name/date, decisions, and any accepted risks. Then route the feature-planner.
