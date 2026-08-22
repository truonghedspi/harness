# Progress Log — JDT MCP Server

External state for cross-session continuity (Lesson 5). The agent's memory is wiped between
sessions; this file is not. Update it at the end of every session (Lesson 12).

## Current State

- **Cập nhật lần cuối:** 2026-08-22
- **Tính năng đang mở:** không có. `feat-workspace-pool` đã được checker phê duyệt ở lần thử 1/3; tính năng đủ điều kiện kế tiếp là `feat-prove-pool-lifecycle`.
- **Latest commit:** phê duyệt feat-workspace-pool (xem git log)
- **Baseline (`./harness/init.sh`):** xanh — sáu trường hợp baseline integration, bốn trường hợp unit của lsp-client và sáu trường hợp unit mới của workspace-pool đều đạt

## Done

- [x] feat-001 — Baseline green
  - Checker replayed the six-case integration oracle and `./harness/init.sh`; injected install, fixture, and test failures each made the gate red and stopped later steps.
- [x] feat-project-router — path to workspace id
  - Checker approved (attempt 2/3): 5/5 (TCON-ROUTE-0001..0005) pass, mutant probe killed every cited defect. Checker's own mutant probe on the just-approved code then found the `<modules>` reactor check is deletable without any of the 5 conditions failing — recorded as a FOLLOW-UP, not reopened here (see feat-prove-routing).
- [x] feat-lsp-client — Content-Length framing + id correlation
  - Checker phê duyệt ở lần thử 2/4. Cả hai lệnh verification đều tái lập được (4/4 unit, 1/1 integration). Oracle Level 3 spawn tiến trình con thật (pid riêng, `ps` nhìn thấy, bị thu hồi sau SIGKILL). Ba mutant do chính checker dựng trong `harness/trace/scratch/` đều bị oracle bắt: bỏ vòng lặp reject `#pending` (đỏ ~0,1 s), chỉ reject entry đầu tiên (đỏ), và ghi sai `Content-Length` thành `byteLength + 1` (đỏ tại đúng mốc timeout 10,004 s). Chạy lặp 15/15 lần đều xanh. `src/lsp/lsp-client.ts` không đổi so với commit a9306fb.
- [x] feat-prove-routing — routing never drifts and never silently misroutes
  - Checker approved on the final attempt (3/3): independent replay 7/7 green (TCON-ROUTE-0001..0007) in 179.6 ms, source unchanged since commit 2503299, oracle diff purely additive (+64 lines, no deletions). A scratch mutant probe (deleted after use, `src/` untouched) showed the control copy green 7/7, mutant M3 (`find` instead of `findLast` — innermost instead of outermost reactor) killed by TCON-ROUTE-0007 alone, M1 killed by TCON-ROUTE-0006 alone, and M2/M13/M14/M17/M19 killed by several conditions each. FOLLOW-UP recorded for the still-surviving mutant M12.

- [x] feat-workspace-pool — vòng đời JDT LS theo từng workspace
  - Checker phê duyệt ở lần thử 1/3. Cả hai lệnh verification tái lập được (10 unit + 2 integration), `src/workspace/workspace-pool.ts` giữ nguyên byte sau khi thử mutant (sha256 `a72b2ed5…`). Bốn mutant do chính checker dựng đều bị bắt: M1 (ghi entry vào map chỉ sau khi spawn xong) làm đỏ 2 unit + 2 integration với sáu pid thật khác nhau; M2 (bỏ phần xoá entry trong nhánh catch khi spawn hỏng) làm đỏ điều kiện "a failed first spawn is never cached"; M3b (`terminate()` rỗng hoàn toàn) làm đỏ cả hai integration sau ~10,8 s; M4 (băm `path.resolve` thay vì `realpathSync`) làm đỏ điều kiện symlink ở cả hai tầng.
  - INV-POOL-5 được chứng minh thật: cả hai oracle bắn 8 và 6 lời gọi `acquire()` song song qua `Promise.all`, oracle integration chờ thêm 400 ms trước khi đếm nên "đúng một tiến trình" không phải kết quả của một cuộc đua may rủi. Oracle integration chạy spawner mặc định, không tiêm seam: `child_process.spawn` thật, tiến trình con thật ghi `$$` và argv của chính nó, pid do pool báo được đối chiếu với pid hệ điều hành và `process.kill(pid, 0)`.
  - Hai FOLLOW-UP ghi trong `checkerNotes`, không cản trở: (1) TCON-POOL-0003 của oracle `pool-lifecycle` đang đỏ vì lỗi của chính oracle, thuộc phạm vi `feat-prove-pool-lifecycle`; (2) chưa có điều kiện nào cố định việc `project-router` và `workspace-pool` sinh cùng một `workspaceId`.

## Blocked

- [ ] feat-prove-provisioner — timebox-blocked after attempt 3/3
  - Checker replayed all 13 cases green in 562.2 s, including the real clean-cache download/install path. But TCON-PROV-0008 only compares the installed files to the same archive it handed to the implementation; it never requires checksum-mismatch rejection for corrupted downloaded bytes. A removed checksum guard would stay green, so the prove claim cannot close until the oracle adds that condition.

## In Progress

- Không có tính năng nào đang mở.

## Next

1. `feat-prove-pool-lifecycle` (đủ điều kiện, `not-started`). Oracle `test/integration/pool-lifecycle.integration.spec.ts` đã tồn tại và đạt 2/3 với triển khai hiện tại. TCON-POOL-0003 đỏ vì lỗi của chính oracle: vòng lặp khẳng định mọi dự án từng nằm trong `recorder.stopOrder` phải vắng mặt trong `pool.status()`, nhưng chuỗi fixture `[p0,p1,p0,p2,p0]` acquire lại `p0` sau khi evict, nên `p0` sống lại hợp lệ. Cần thu hẹp assertion về đúng các workspace đã evict và chưa được acquire lại. Phần còn lại của oracle đã được checker kiểm chứng là đúng: với mutant thêm hậu tố tick vào `dataDir`, TCON-POOL-0003 đỏ ở đúng assertion "a re-requested workspace must reuse its warm -data directory", tức INV-POOL-4 được phủ thật.
2. Add and run a committed corrupt-download/checksum-rejection integration condition for `feat-prove-provisioner`, then return it to checker review.
3. Feature-planner to route the `feat-prove-routing` FOLLOW-UP (surviving mutant M12) as a *new* small oracle feature or as an accepted-risk row under A-006 — never as a fourth in-place widening, because that feature is closed at 3/3 and the maker has no attempts left. The recommended single condition (TCON-ROUTE-0008) closes the whole selection predicate at once: a five-level mixed ancestor chain (non-reactor top, reactor A, non-reactor middle, reactor B, leaf module), where a path under the leaf module must resolve to reactor A.
4. Feature-planner cân nhắc một điều kiện nhỏ cho đường nối `project-router` ↔ `workspace-pool`: hiện không có test nào khẳng định `pool.acquire(resolution.projectRoot).workspaceId === resolution.workspaceId`. Hai module cùng tính sha256 của thư mục gốc đã realpath nên hôm nay khớp nhau, nhưng nếu một bên đổi công thức băm thì một dự án sẽ tách làm hai thư mục `-data` mà không test nào đỏ.

## Known Issues / Risks

- [ ] Eclipse snapshot downloads are slow on this network; the fetcher uses bounded parallel ranges and caches the checksum-verified archive contents.

## Notes for Next Session

The prove-provisioner feature is rejected: its 13-case green replay lacks corrupt-download/checksum-rejection coverage. `feat-lsp-client` là **done** — checker đã phê duyệt ở lần thử 2/4 sau khi tự dựng ba mutant và xác nhận oracle Level 3 bắt được cả ba; không được sửa `src/lsp/lsp-client.ts` hay file oracle nếu không có lần từ chối mới. `feat-project-router` is done and must stay untouched. `feat-prove-routing` is now **done**, approved by the checker on its final attempt (3/3). The recorded verification reproduced exactly (7/7 green, 179.6 ms), and a scratch mutant probe settled the question the previous verdict left open: the `outermost` clause of `INV-ROUTE-1` is genuinely proven, because `TCON-ROUTE-0007` is the only condition that kills the innermost-reactor mutant. One real gap remains and is recorded as a FOLLOW-UP in the feature's `checkerNotes`: mutant M12 — *if any ancestor is a reactor, take the outermost ancestor `pom.xml` even when that pom declares no `<modules>`* — survives all 7 conditions. It is proven non-equivalent: for `parent-pom-only/` (packaging=pom, no `<modules>`) containing `reactor/` (`<modules>`) containing `mod-a`, the real implementation resolves `mod-a` to `parent-pom-only/reactor` while M12 resolves it to `parent-pom-only`. No fixture places a non-reactor `pom.xml` *above* a reactor root, so `INV-ROUTE-1`'s qualifier clause is still discriminated by nothing. This must be routed as new scope, not as a fourth widening of the closed feature. Two other surviving mutants are already documented rather than new: the loosened `<modules>` regex (the accepted no-real-Maven-parser risk in design approval 3d68e0857fbfac45) and the dropped `realpathSync` (out of scope while X-005 stays open, as the spec file's own header states).
