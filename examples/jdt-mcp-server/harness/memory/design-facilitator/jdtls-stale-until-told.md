---
name: jdtls-stale-until-told
description: JDT LS answers from a stale model after on-disk edits until sent didChangeWatchedFiles — a 3-minute spike overturned this session's whole risk model
metadata:
  type: lesson
  date: 2026-08-19
---

The session went in believing the dominant risk was **cold-start latency** (the widely-cited
25-minute startup report). A short spike (`spikes/jdtls-disk-sync.mjs`) showed the real one:
rewriting a source file on disk to delete a method, with no LSP notification, left JDT LS still
resolving the deleted method and reporting **zero** diagnostics. One
`workspace/didChangeWatchedFiles` and it corrected itself within 8 s.

**Why this matters more than latency:** a slow answer is visibly slow; a stale answer is
well-formed, confident and wrong. For a product whose client is an AI agent that edits files
directly, the *default* behaviour of a correct-looking implementation is to lie. That promoted a
file watcher from "polish" to a v1-blocking component and reordered the build order so the watcher
and readiness gate precede every capability tool.

**How to apply:** in this project, never accept a design or a feature that queries JDT LS without
naming how the on-disk state got into it. `INV-SYNC-1` exists precisely so that a feature's
falsifier can cite it. Also: the sibling finding from `spikes/jdtls-two-projects.mjs` — a query
routed to the *wrong* instance returns `[]`, not an error — means both of this system's silent
failure modes present as an empty result. Any tool result that is empty is suspect by default.

**On technique:** three spikes totalling well under an hour beat every secondhand claim in the
research brief, and the Key Assumptions Check is what forced them — writing the unstated premises
out ("concurrent workspaces share no mutable global state", "a file watcher sees every change")
produced two new registered assumptions that no amount of reading upstream docs would have surfaced.
Run the KAC before deciding what to spike, not after.
