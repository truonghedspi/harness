# Progress Log — JDT MCP Server

External state for cross-session continuity (Lesson 5). The agent's memory is wiped between
sessions; this file is not. Update it at the end of every session (Lesson 12).

## Current State

- **Last updated:** 2026-08-21
- **Active feature:** none — feat-prove-routing approved and closed by the checker on its final attempt (3/3). Independent replay reproduced 7/7 green in 179.6 ms, and a checker mutant probe confirmed TCON-ROUTE-0007 is the single condition that kills the `find` vs `findLast` (innermost vs outermost reactor) mutant that survived the previous 6-condition suite. A FOLLOW-UP remains: mutant M12 (take the outermost ancestor `pom.xml` whenever any ancestor is a reactor, ignoring INV-ROUTE-1's `that declares <modules>` qualifier) still survives all 7 conditions and is proven non-equivalent. It must not reopen this exhausted feature
- **Latest commit:** pending — checker APPROVE verdict on feat-prove-routing (final attempt, 3/3)
- **Baseline (`./harness/init.sh`):** green — six baseline integration cases and four lsp-client unit cases passed

## Done

- [x] feat-001 — Baseline green
  - Checker replayed the six-case integration oracle and `./harness/init.sh`; injected install, fixture, and test failures each made the gate red and stopped later steps.
- [x] feat-project-router — path to workspace id
  - Checker approved (attempt 2/3): 5/5 (TCON-ROUTE-0001..0005) pass, mutant probe killed every cited defect. Checker's own mutant probe on the just-approved code then found the `<modules>` reactor check is deletable without any of the 5 conditions failing — recorded as a FOLLOW-UP, not reopened here (see feat-prove-routing).
- [x] feat-prove-routing — routing never drifts and never silently misroutes
  - Checker approved on the final attempt (3/3): independent replay 7/7 green (TCON-ROUTE-0001..0007) in 179.6 ms, source unchanged since commit 2503299, oracle diff purely additive (+64 lines, no deletions). A scratch mutant probe (deleted after use, `src/` untouched) showed the control copy green 7/7, mutant M3 (`find` instead of `findLast` — innermost instead of outermost reactor) killed by TCON-ROUTE-0007 alone, M1 killed by TCON-ROUTE-0006 alone, and M2/M13/M14/M17/M19 killed by several conditions each. FOLLOW-UP recorded for the still-surviving mutant M12.

## Blocked

- [ ] feat-prove-provisioner — timebox-blocked after attempt 3/3
  - Checker replayed all 13 cases green in 562.2 s, including the real clean-cache download/install path. But TCON-PROV-0008 only compares the installed files to the same archive it handed to the implementation; it never requires checksum-mismatch rejection for corrupted downloaded bytes. A removed checksum guard would stay green, so the prove claim cannot close until the oracle adds that condition.

## In Progress
- [ ] feat-jdtls-provisioner — ready for checker after attempt 2/3
  - The unchanged implementation passed all 13 independent integration cases before implementation again (479.5 s), including clean-cache checksum verification, download, extraction, and pinned installation; no redundant source change was made.
- [ ] feat-lsp-client — rejected after attempt 1/4
  - Checker replayed the four green unit cases, but they manually emit `exit` over PassThrough streams. This process-boundary feature needs a bounded cross-process integration oracle that kills a spawned scripted child with requests in flight.

## Next

1. Add and run a committed corrupt-download/checksum-rejection integration condition for `feat-prove-provisioner`, then return it to checker review.
2. Add and run the required bounded cross-process oracle for `feat-lsp-client`, then return it to checker review.
3. Feature-planner to route the `feat-prove-routing` FOLLOW-UP (surviving mutant M12) as a *new* small oracle feature or as an accepted-risk row under A-006 — never as a fourth in-place widening, because that feature is closed at 3/3 and the maker has no attempts left. The recommended single condition (TCON-ROUTE-0008) closes the whole selection predicate at once: a five-level mixed ancestor chain (non-reactor top, reactor A, non-reactor middle, reactor B, leaf module), where a path under the leaf module must resolve to reactor A.

## Known Issues / Risks

- [ ] Eclipse snapshot downloads are slow on this network; the fetcher uses bounded parallel ranges and caches the checksum-verified archive contents.

## Notes for Next Session

The prove-provisioner feature is rejected: its 13-case green replay lacks corrupt-download/checksum-rejection coverage. The lsp-client still needs a cross-process oracle. `feat-project-router` is done and must stay untouched. `feat-prove-routing` is now **done**, approved by the checker on its final attempt (3/3). The recorded verification reproduced exactly (7/7 green, 179.6 ms), and a scratch mutant probe settled the question the previous verdict left open: the `outermost` clause of `INV-ROUTE-1` is genuinely proven, because `TCON-ROUTE-0007` is the only condition that kills the innermost-reactor mutant. One real gap remains and is recorded as a FOLLOW-UP in the feature's `checkerNotes`: mutant M12 — *if any ancestor is a reactor, take the outermost ancestor `pom.xml` even when that pom declares no `<modules>`* — survives all 7 conditions. It is proven non-equivalent: for `parent-pom-only/` (packaging=pom, no `<modules>`) containing `reactor/` (`<modules>`) containing `mod-a`, the real implementation resolves `mod-a` to `parent-pom-only/reactor` while M12 resolves it to `parent-pom-only`. No fixture places a non-reactor `pom.xml` *above* a reactor root, so `INV-ROUTE-1`'s qualifier clause is still discriminated by nothing. This must be routed as new scope, not as a fourth widening of the closed feature. Two other surviving mutants are already documented rather than new: the loosened `<modules>` regex (the accepted no-real-Maven-parser risk in design approval 3d68e0857fbfac45) and the dropped `realpathSync` (out of scope while X-005 stays open, as the spec file's own header states).
