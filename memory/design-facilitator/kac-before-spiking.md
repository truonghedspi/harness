---
name: kac-before-spiking
description: Run the Key Assumptions Check before choosing what to spike — writing out the unstated premises is what tells you which two-minute spike is worth an hour of reading
metadata:
  type: lesson
  date: 2026-08-19
---

Observed in the `examples/jdt-mcp-server` design session. The session was handed a research brief
full of secondhand claims and the instruction to verify them. Verifying the *stated* claims was
cheap and mostly confirmatory. The findings that actually changed the design all came from premises
nobody had written down, and they only became visible when the Key Assumptions Check forced the
leading conclusion's unstated premises onto paper:

- "a file watcher can see every change" → led to the spike that proved the server ignores on-disk
  edits entirely, which promoted a component from polish to v1-blocking
- "concurrent workspaces share no mutable global state" → surfaced a shared `~/.m2` contention risk
  nobody had mentioned
- "results fit an agent's context" → forced a truncation invariant

**Why:** a research brief enumerates what someone already thought to ask. The KAC enumerates what
the *conclusion* needs in order to be true, which is a different and larger set. Spiking the first
list confirms; spiking the second list falsifies.

**How to apply:** in Phase 4, do step 1 (KAC) far enough to list the unstated premises **before**
deciding which spikes to run, even though the prompt's ordering puts spiking in Phase 1/3. Then run
spikes against the premises that failed the challenge, not against the claims that were handed to
you. Also worth reusing: building the Devil's Advocacy case for the rejected option surfaced one
argument (run the daemon on a bigger machine) strong enough to amend the recommendation rather than
be dismissed by it — that is the technique working, and it is worth saying so explicitly in the
write-up so the human can see the critique was not theatre.
