# Design docs

One file per design topic, produced by the `designer` agent and falsified by `design-reviewer`
(`docs/reference/design-engineering.md`). Each must carry: named components and their boundaries, a
**claims table** where every library/system fact cites a real `path:line` or a runnable spike,
options with the rejected alternatives recorded in `DECISIONS.md`, and a blast radius.

Load-bearing assumptions do not live here — they go in `docs/assumptions.md`, one row each, so they
can be checked mechanically and reviewed in one place.
