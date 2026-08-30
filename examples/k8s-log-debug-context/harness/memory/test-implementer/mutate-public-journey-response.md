---
name: mutate-public-journey-response
description: Prove a live journey oracle discriminates without mistaking a seam mutant for Level-3 evidence
metadata:
  type: lesson
  date: 2026-08-29
---

When the deployment boundary is not implemented yet, extract a public-response assertion into a
function used unchanged by the real journey, then feed it a bounded synthetic response that
satisfies every named condition except one deliberate spec violation. The mutant run must exit red
with the violated invariant's exact assertion, and its evidence may be marked `mutant: true`.

**Why:** A full cluster cannot kill a journey mutant before the deploy surface exists, while a fake
Kubernetes stack could be mistaken for Level-3 evidence. Mutating the observable MCP seam proves
the oracle has force without claiming the journey itself passed.

**How to apply:** Keep the normal verification path live-cluster-only, never let the mutant mode
return a journey pass, and retain environment checkpoints such as A-006 for the later real run.
