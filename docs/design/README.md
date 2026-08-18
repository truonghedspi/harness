# Design docs

One file per design topic, produced by the `design-facilitator` agent in a session with a human, who
is the only one who can approve it (`docs/reference/design-engineering.md`). Each must carry: named
components and their boundaries, a **claims table** where every library/system fact cites a real
`path:line` or a runnable spike, at least two real options with the rejected alternatives recorded in
`DECISIONS.md`, and a blast radius.

`loop/route.mjs` blocks feature-planner, test-designer, test-implementer, maker, and checker until
`loop/design-approval.json` names the exact digest of the design revision here — a design edited
after approval, even by one line, needs a fresh approval before anything downstream can proceed.

Load-bearing assumptions do not live here — they go in `docs/assumptions.md`, one row each, so they
can be checked mechanically and reviewed in one place.
