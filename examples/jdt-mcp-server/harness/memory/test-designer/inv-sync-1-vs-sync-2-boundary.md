# INV-SYNC-1's scope vs A-014's watcher-blind-spot content

`docs/assumptions.md#A-014` ("a recursive filesystem watcher observes every relevant change,
including temp-write-then-rename and edits under large source trees") is filed against
`INV-SYNC-1` in its own row, but its actual content — watcher coverage across edit classes and
tree sizes — is `INV-SYNC-2`'s stated territory ("every observed create, modify, delete and
rename ... no event class is silently dropped"), owned by `feat-file-sync-watcher`, not
`feat-prove-sync`.

Same shape as `pool-2-vs-idle-timer.md`: an assumptions-table row's *citation* column names one
INV, but its *content* overlaps a sibling INV's stated scope. Don't let the citation column
expand a plan's scope — check what the INV's own table text actually promises
(`docs/design/runtime-model.md`) before deciding a condition belongs.

For `feat-prove-sync` (TP-SYNC-0001): scoped strictly to INV-SYNC-1's own text and the feature's
context note (probe immediately after a silent edit, and again after the watcher's notification
lands, on a single plain-modify edit) — did not vary edit class or tree size, left that to
`feat-file-sync-watcher`'s own INV-SYNC-2 conditions per `docs/assumptions.md#A-008`.

Also worth carrying forward: `docs/cross-cutting.md#X-001` (the deadline/timeout budget) is
explicitly marked *open*, only a recommended default — INV-SYNC-1's "within its deadline" clause
has no settled numeric value to trace a condition to. Logged as a `spec_gaps` entry rather than
picking 30s and moving on; a concrete wait bound is the test-implementer's fixture choice, not a
spec fact, until X-001 resolves.
