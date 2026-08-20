# RESOLVED — requirement_id now accepts INV- ids directly

**Original hook (2026-08-20):** this project's spec expresses every falsifiable claim as
`INV-<AREA>-<N>` (`docs/reference/invariant-contract.md`) — there are zero `REQ-` ids anywhere in
the repo. The vendored `skills/test-design/schemas/test-condition.schema.json` required
`requirement_id` to match `^REQ-[A-Z]+-\d{3}$`, which no `INV-` id satisfied.

**First pass (TP-PROV-0001) worked around it** with a synthetic 1:1 bridge
(`INV-PROV-1 -> REQ-PROV-001`). That bridge has since been **reverted** — do not reintroduce it.

**Actual fix, applied by the orchestrator the same day:** widened the schema's pattern to
`^(REQ-[A-Z]+-\d{3}|INV-[A-Z]+-\d+)$` in all three copies (`skills/test-design/`,
`harness-loop/templates/test-design/`, and this project's vendored copy), matching
`invariant-contract.md`'s own stated intent that `REQ-`/`INV-`/`TCON-` are one id family. `TP-PROV-0001`'s
conditions now cite `INV-PROV-1`/`INV-PROV-2` directly.

**For every later test-design pass on this project** (`INV-POOL-*`, `INV-ROUTE-*`, `INV-SYNC-*`,
`INV-READY-*`, `INV-SHIM-*`, `INV-TOOL-*`, `INV-CA-*`): cite the real `INV-<AREA>-<N>` id in
`requirement_id` directly. No bridge, no relabeling — the schema accepts it now.
