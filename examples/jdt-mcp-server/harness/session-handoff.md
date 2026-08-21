# Session handoff — routing FOLLOW-UP turned into explicit scope on feat-prove-routing

- Router routed a `feature-planner` turn off `feat-project-router`'s own checker approval: the
  checker approved that feature (attempt 2/3, 5/5 conditions green) but its mutant probe found the
  `<modules>` reactor check is deletable without failing any of TCON-ROUTE-0001..0005, because no
  fixture nests a pom.xml under a non-reactor ancestor pom.xml. `feat-project-router` stays `done`,
  untouched — its status/evidence were not reopened.
- Decided the gap belongs inside `feat-prove-routing`'s existing scope (same seam, same oracle file,
  same `INV-ROUTE-1` invariant family the feature already partly proves via TCON-ROUTE-0003/0004),
  not a new feature. Precedent: the same in-place-widening pattern was already used to add
  TCON-ROUTE-0005 for INV-ROUTE-2.
- `feature_list.json` changes: `feat-prove-routing`'s `behavior`, `falsifier`, and `conditions`
  (added `TCON-ROUTE-0006`, traces to `INV-ROUTE-1`, decision_table technique) now explicitly
  require a non-reactor parent pom.xml (packaging=pom, no `<modules>`) with an independent child
  project's own pom.xml nested beneath it, asserting the child path resolves to the child directory,
  not the parent. `checkerNotes` got an appended `WIDENED` entry; prior evidence/attempts (1/3) are
  preserved unchanged since they cover the pre-widening 5-condition scope.
- Also fixed a pre-existing, unrelated schema error on `feat-project-router` (missing
  `readyForCheck` field, required by `check-plan.mjs`) by adding `"readyForCheck": false` — no
  status or evidence change.
- Decision recorded in `harness/DECISIONS.md` (newest entry, 2026-08-21).
- `skills/feature-planning/scripts/check-plan.mjs --target . --json`: green, 0 errors/warnings.
- `tools/verify-harness.mjs --target . --skip-baseline --quiet` (run with cwd = `harness/`): exit 0,
  no findings.
- `feature_list.digest.md` regenerated: 32 features — done: 3, blocked: 11, in-progress: 2,
  not-started: 16.
- Next: route to test-designer to author `TCON-ROUTE-0006` (new fixture: non-reactor parent pom.xml
  with a nested child project's own pom.xml), then test-implementer adds it to
  `test/integration/project-router.integration.spec.ts`, then back to checker for
  `feat-prove-routing`. `feat-prove-provisioner` (blocked, needs corrupt-download/checksum-rejection
  condition) and `feat-lsp-client` (rejected, needs a bounded cross-process oracle) remain the other
  two open threads from before this pass.
