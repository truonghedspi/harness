# Progress Log — JDT MCP Server

External state for cross-session continuity (Lesson 5). The agent's memory is wiped between
sessions; this file is not. Update it at the end of every session (Lesson 12).

## Current State

- **Cập nhật lần cuối:** 2026-08-22
- **Tính năng đang mở:** không có. Checker đã phê duyệt `feat-lsp-client` ở lần thử 2/4; không còn mục nào ở trạng thái `readyForCheck`.
- **Latest commit:** phê duyệt feat-lsp-client (xem git log)
- **Baseline (`./harness/init.sh`):** xanh — sáu trường hợp baseline integration và bốn trường hợp unit của lsp-client đều đạt

## Done

- [x] feat-001 — Baseline green
  - Checker replayed the six-case integration oracle and `./harness/init.sh`; injected install, fixture, and test failures each made the gate red and stopped later steps.
- [x] feat-project-router — path to workspace id
  - Checker approved (attempt 2/3): 5/5 (TCON-ROUTE-0001..0005) pass, mutant probe killed every cited defect. Checker's own mutant probe on the just-approved code then found the `<modules>` reactor check is deletable without any of the 5 conditions failing — recorded as a FOLLOW-UP, not reopened here (see feat-prove-routing).
- [x] feat-lsp-client — Content-Length framing + id correlation
  - Checker phê duyệt ở lần thử 2/4. Cả hai lệnh verification đều tái lập được (4/4 unit, 1/1 integration). Oracle Level 3 spawn tiến trình con thật (pid riêng, `ps` nhìn thấy, bị thu hồi sau SIGKILL). Ba mutant do chính checker dựng trong `harness/trace/scratch/` đều bị oracle bắt: bỏ vòng lặp reject `#pending` (đỏ ~0,1 s), chỉ reject entry đầu tiên (đỏ), và ghi sai `Content-Length` thành `byteLength + 1` (đỏ tại đúng mốc timeout 10,004 s). Chạy lặp 15/15 lần đều xanh. `src/lsp/lsp-client.ts` không đổi so với commit a9306fb.
- [x] feat-prove-routing — routing never drifts and never silently misroutes
  - Checker approved on the final attempt (3/3): independent replay 7/7 green (TCON-ROUTE-0001..0007) in 179.6 ms, source unchanged since commit 2503299, oracle diff purely additive (+64 lines, no deletions). A scratch mutant probe (deleted after use, `src/` untouched) showed the control copy green 7/7, mutant M3 (`find` instead of `findLast` — innermost instead of outermost reactor) killed by TCON-ROUTE-0007 alone, M1 killed by TCON-ROUTE-0006 alone, and M2/M13/M14/M17/M19 killed by several conditions each. FOLLOW-UP recorded for the still-surviving mutant M12.

## Blocked

- [ ] feat-prove-provisioner — timebox-blocked after attempt 3/3
  - Checker replayed all 13 cases green in 562.2 s, including the real clean-cache download/install path. But TCON-PROV-0008 only compares the installed files to the same archive it handed to the implementation; it never requires checksum-mismatch rejection for corrupted downloaded bytes. A removed checksum guard would stay green, so the prove claim cannot close until the oracle adds that condition.

## In Progress

- Không còn mục nào chờ checker.

## Next

1. Add and run a committed corrupt-download/checksum-rejection integration condition for `feat-prove-provisioner`, then return it to checker review.
2. `feat-workspace-pool` đã đủ điều kiện (`feat-jdtls-provisioner`, `feat-project-router`, `feat-lsp-client` đều `done`) — đây là mục kế tiếp cho maker.
3. Feature-planner to route the `feat-prove-routing` FOLLOW-UP (surviving mutant M12) as a *new* small oracle feature or as an accepted-risk row under A-006 — never as a fourth in-place widening, because that feature is closed at 3/3 and the maker has no attempts left. The recommended single condition (TCON-ROUTE-0008) closes the whole selection predicate at once: a five-level mixed ancestor chain (non-reactor top, reactor A, non-reactor middle, reactor B, leaf module), where a path under the leaf module must resolve to reactor A.

## Known Issues / Risks

- [ ] Eclipse snapshot downloads are slow on this network; the fetcher uses bounded parallel ranges and caches the checksum-verified archive contents.

## Notes for Next Session

The prove-provisioner feature is rejected: its 13-case green replay lacks corrupt-download/checksum-rejection coverage. `feat-lsp-client` là **done** — checker đã phê duyệt ở lần thử 2/4 sau khi tự dựng ba mutant và xác nhận oracle Level 3 bắt được cả ba; không được sửa `src/lsp/lsp-client.ts` hay file oracle nếu không có lần từ chối mới. `feat-project-router` is done and must stay untouched. `feat-prove-routing` is now **done**, approved by the checker on its final attempt (3/3). The recorded verification reproduced exactly (7/7 green, 179.6 ms), and a scratch mutant probe settled the question the previous verdict left open: the `outermost` clause of `INV-ROUTE-1` is genuinely proven, because `TCON-ROUTE-0007` is the only condition that kills the innermost-reactor mutant. One real gap remains and is recorded as a FOLLOW-UP in the feature's `checkerNotes`: mutant M12 — *if any ancestor is a reactor, take the outermost ancestor `pom.xml` even when that pom declares no `<modules>`* — survives all 7 conditions. It is proven non-equivalent: for `parent-pom-only/` (packaging=pom, no `<modules>`) containing `reactor/` (`<modules>`) containing `mod-a`, the real implementation resolves `mod-a` to `parent-pom-only/reactor` while M12 resolves it to `parent-pom-only`. No fixture places a non-reactor `pom.xml` *above* a reactor root, so `INV-ROUTE-1`'s qualifier clause is still discriminated by nothing. This must be routed as new scope, not as a fourth widening of the closed feature. Two other surviving mutants are already documented rather than new: the loosened `<modules>` regex (the accepted no-real-Maven-parser risk in design approval 3d68e0857fbfac45) and the dropped `realpathSync` (out of scope while X-005 stays open, as the spec file's own header states).
