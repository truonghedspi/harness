# A stage-gate edge pointing to a `prove` feature will block the entire thread when that feature runs out of budget

**Context.** 2026-08-25, router stopped at `human` with message "4 feature(s) open but none routable".
Four features `feat-tool-completion`, `feat-tool-rename`, `feat-tool-code-actions`,
`feat-tool-apply-code-action` are both `not-started`, full dependencies, no blocking notes. Cause
located three links away: `feat-tool-completion` depends on `feat-prove-diagnostics`, which
Just had checker REJECT on turn three and switched to `blocked`. From there the whole series of four features — and every
the `prove` feature hangs behind them — never to route again.

**Why does that edge exist?** The first cut (`DECISIONS/2026-08-20.md`) encodes the build order of
`docs/design/tool-surface.md` into a real DAG edge: each later stage tool feature depends on the
`prove` function of a previous phase, so that no phase starts before the previous phase has already done so
prove. That decision is still correct. What it didn't foresee: a budget `prove` feature
`maxAttempts` is finite, so it can permanently stop at `blocked` and still retain its gate role.
A `build` feature only blocks when no one has done it yet; a `prove` feature blocks even when all work is done.

**Workaround used.** Do not remove `blocked` of `feat-prove-diagnostics` (its blocking reason is real),
nor delete the gate edge. Instead cut the successor `prove` feature that actually proves the stage
(`feat-prove-diagnostics-identity`) and then move the edge to the successor feature. Stage gate okay
keep the same meaning, just change the guard.

**Signs to recognize next time.** When the router reports "none routable" and the features listed are all
clean, don't read them themselves — go back `dependencies` to the first `blocked` link. And every time
set an edge from a `build` feature to a `prove` feature as the order gate, remember that edge
turns the `maxAttempts` limit of the `prove` feature into the limit of the entire downstream branch.