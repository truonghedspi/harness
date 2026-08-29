# Progress Log — JDT MCP Server

External state for cross-session continuity (Lesson 5). The agent's memory is wiped between
sessions; this file is not. Update it at the end of every session (Lesson 12).

## Current State

- **2026-08-29 — feat-gradle-routing (DONE, checker approve):** project-router giờ nhận diện Gradle (settings.gradle/.kts = gốc multi-project, build.gradle/.kts = project) bên cạnh Maven — INV-ROUTE-4 (additive). Router giờ định tuyến được repo aeron (Gradle 9.6.1): smoke-test real file aeron-client/.../ClientConductor.java → root aeron. 5 ca oracle mới (TCON-ROUTE-GRADLE-0001..0005), mutant xóa nhánh Gradle → đỏ. Full suite 255/255.

- **2026-08-29 — feat-diag-open-on-query (DONE, checker approve):** INV-DIAG-4 sau một lượt REJECT được viết lại để ghim cái "chờ có giới hạn" (bounded wait for publishDiagnostics) làm phần chịu lực, còn textDocument/didOpen là trigger/tối ưu. Checker mutant: xóa wait (giữ didOpen) → đỏ "not-reported"; xóa didOpen (giữ wait) → vẫn xanh (chấp nhận là tối ưu, ghi acceptedRisks). Router giờ lại "exit" — 37/37 done.

- **2026-08-29 — feat-diag-open-on-query (build, readyForCheck):** đóng gap INV-DIAG-4 — daemon (src/cli.ts) giờ gửi textDocument/didOpen cho document được hỏi trước khi java_diagnostics trả lời và chờ publish có giới hạn (DIAG_OPEN_WAIT_MS=10s), nên file trên workspace đã import (.project/.classpath có sẵn) trả "reported" thay vì "not-reported" vĩnh viễn. Test mới test/integration/diagnostics-open.integration.spec.ts (2 pha daemon, red→green); npm test 159/159, npm run test:integration 250/250. Design: Option A (didOpen on-query), approvedBy "gommi", INV-DIAG-4 + design-approval.json cập nhật.

- **2026-08-28 — HOÀN TẤT: 36/36 done (100%).** Cả 12 feature còn lại đã qua checker review (APPROVE,
  `status: done`, `checkerVerdict: approve`). Router giờ trả `exit` — mọi feature done. `npm test`
  159/159; `npm run test:integration` (danger-full-access) 249/249. Bốn tool build
  (`java_completion`, `java_rename`, `java_code_actions`, `java_apply_code_action`) + oracle prove
  tương ứng, hai feature blocked-3/3 gỡ bằng điều kiện oracle mới, và end-to-end
  `feat-prove-cross-process-integration`. Chi tiết: `src/tools/{completion,rename,code-actions,apply-code-action,code-action-store,workspace-edit}.ts`,
  `src/workspace/sync-guard.ts`, oracle `{completion,rename,code-actions,cross-process}.integration.spec.ts`
  + `TCON-PROV-0009` + `TCON-DIAG-0004` + `A-021`. Sandbox DSH chặn `ps` (EPERM): `TCON-SHIM-0003`
  fail giả, xác nhận bằng `danger-full-access`.

- **2026-08-28 — `feat-prove-sync` (oracle + sync-guard, chờ checker):** hiện thực `src/workspace/sync-guard.ts`
  (`withSyncQuiescence`: chờ watcher settle rồi POLL cho tới khi câu trả lời hết stale, không thì
  `ResyncingError` code `resyncing`) — thành phần INV-SYNC-1 còn thiếu mà runtime-model mô tả nhưng
  không build feature nào sở hữu. Viết oracle `test/integration/file-sync.integration.spec.ts` tái
  hiện spike C qua `textDocument/definition` (workspace/symbol chỉ giải TYPE, đo được bằng spike) trên
  pool thật + JDT LS thật + watcher thật. Control 2/2 xanh; mutant M1 (guard trả kết quả đầu tiên
  không poll) làm TCON-SYNC-0001 đỏ đúng falsifier. `npm test` 124/124 xanh. Feature chuyển
  `blocked` → `in-progress`, ghi evidence + checkerNotes; chưa `readyForCheck` (checker không dispatch
  được trong phiên). Ghi chú scope: sync-guard là component production mới, nếu tách build feature
  riêng thì planner cắt lại.

- **2026-08-28 — `feat-prove-readiness` (oracle deadline path, chờ checker):** viết
  `test/integration/readiness.integration.spec.ts` — 3 caller đồng thời chống một workspace thật không
  bao giờ ready (không có Java source nên `probeSemanticIndex` luôn `ok:false`) qua pool thật + JDT LS
  thật + readiness-gate thật; cả 3 reject `WorkspaceNotReadyError` trong deadline tham số (X-001 mở).
  Control 1/1 xanh; mutant M1 (awaitReady resolve empty success thay vì reject) làm oracle đỏ 1/1.
  Feature `blocked` → `in-progress`, `readyForCheck: true` + reviewPacket ADMITTED. Cả hai feature
  (`feat-prove-sync`, `feat-prove-readiness`) giờ chờ checker.

- **2026-08-24 — `feat-prove-diagnostics` maker attempt 1/3:** implementation green; baseline blocks checker. Live JDT LS
  notifications arrived under canonical `file:///private/var/...` URIs while the tool queried the
  same files through `file:///var/...`; `DiagnosticsCache` now keys existing file URIs by canonical
  filesystem identity. Exact verification: 3/3 green in 10.6 s, replacing the prior repeated
  timeout behavior with a bounded run.
  `./harness/init.sh` is nevertheless red: all 14 recursive watcher cases fail with `EMFILE`, even
  after raising this shell's soft fd limit from 256 to 10240. The feature remains not ready for
  checker because that baseline failure is outside its scoped correction.
  Attempt 2 minimized this to one deterministic case and then outside the repo entirely: standalone
  Node `fs.watch()` fails `EMFILE` for a fresh empty directory and for the repo directory, but a
  single-file watch and 300 ordinary open descriptors succeed. Classification: host directory-watch
  capacity/runtime state, not `DiskFileSyncWatcher`; no out-of-scope source or oracle edit made.

- **Cập nhật lần cuối:** 2026-08-22 (lượt maker, `feat-file-sync-watcher`)
- **Tính năng đang mở:** `feat-file-sync-watcher` (`in-progress`, `readyForCheck: true`, 1/3) chờ checker.
- **Latest commit:** tách contract hook Codex (xem git log)
- **Baseline (`./harness/init.sh`):** xanh — 18 trường hợp unit (4 lsp-client, 6 workspace-pool, 8 file-sync-watcher) và toàn bộ 56 trường hợp khi chạy discovery đầy đủ đều đạt

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

## Decomposition — lượt 2026-08-22 (feature-planner)

Đầu vào: ba mục FOLLOW-UP trong verdict APPROVE của `feat-workspace-pool`. Không đụng tới tính năng
đó (giữ `done`, giữ evidence, giữ attempts 1/3). Chi tiết lý do trong `DECISIONS.md` 2026-08-22.

- Lỗi oracle `TCON-POOL-0003`: **không tạo scope mới.** `feat-prove-pool-lifecycle` nay đủ điều kiện
  vì phụ thuộc đã `done`. Chẩn đoán và một sửa đổi oracle có giới hạn được cho phép trước, ghi trong
  `checkerNotes` của chính tính năng và trong gói ngữ cảnh mới
  `harness/loop/context-packets/feat-prove-pool-lifecycle.json` (có sha256 của tệp oracle, tệp điều
  kiện và `src/workspace/workspace-pool.ts`, nên người nhận biết ngay gói còn tươi hay đã cũ).
- Đường nối identity `project-router` ↔ `workspace-pool`: **tính năng prove mới**
  `feat-prove-workspace-identity`, oracle riêng `test/integration/workspace-identity.integration.spec.ts`,
  falsifier trích dẫn `INV-POOL-1` + `INV-ROUTE-3`, `maxAttempts` 2, `conditions` để rỗng cho lớp
  oracle điền. Đây là việc giết mutant còn sống: hai component hôm nay khớp nhau nên lần chạy đỏ phải
  đến từ mutant được nêu tên, không phải từ một tính năng chưa triển khai.
- Dừng êm SIGTERM trước SIGKILL: **chỉ ghi chú.** Không invariant nào phát biểu thứ tự dừng, nên ghi
  vào `context.note` của `feat-prove-pool-crash-handling` và mở một human checkpoint trong
  `loop/goal.md`.
- `feat-prove-pool-crash-handling`: **gỡ chặn** `blocked` → `not-started`. Điều kiện thoát do chính
  ghi chú chặn nêu ra ("once feat-lsp-client and feat-workspace-pool are both done") nay đã đủ.

## Blocked

- [ ] feat-prove-provisioner — timebox-blocked after attempt 3/3
  - Checker replayed all 13 cases green in 562.2 s, including the real clean-cache download/install path. But TCON-PROV-0008 only compares the installed files to the same archive it handed to the implementation; it never requires checksum-mismatch rejection for corrupted downloaded bytes. A removed checksum guard would stay green, so the prove claim cannot close until the oracle adds that condition.

## In Progress

- [ ] feat-file-sync-watcher — chờ checker (`readyForCheck: true`, lần thử 2/3)
  - **Lượt 2 (2026-08-22) — chỉ bổ sung oracle, không chạm `src/`.** Checker từ chối lượt 1 vì năm
    mutant sống sót; bản triển khai được xác nhận đúng nên `src/workspace/file-sync-watcher.ts` giữ
    nguyên từng byte (đối chiếu với bản sao trước khi dựng mutant, `diff` rỗng).
  - Bốn trường hợp mới, mỗi trường hợp đỏ đúng dưới mutant nó nhắm tới:
    1. Ghim mã số trên dây bằng literal LSP 3.17 (1/2/3), không đi qua `FileChangeType` nhập từ
       chính module bị phán xét → giết M3 (đổi số hiệu hằng số), đỏ với `expected [1] actual [3]`.
    2. Ghi đè giữ nguyên độ dài byte VÀ giữ nguyên mtime: cả hai bản đều bị ép mtime về một giây
       tròn bằng `utimesSync`, độ dài byte được khẳng định bằng nhau, nên `ino` là trường duy nhất
       phân biệt → giết M7 (xoá vế `previous.ino !== stamp.ino`).
    3. Fixture reactor hai module (`moduleA/pom.xml` + `moduleA/src/main/java`) → giết M5 (chỉ theo
       dõi pom gốc) ở lần chờ refresh, và M8 (bỏ luật infix trong `#isWatchedPath`) ở lần chờ thông
       báo cho mã nguồn của module. Hai mutant chết ở hai khẳng định khác nhau.
    4. Một trường hợp chạm `src/test/java` → giết M6 (bỏ nửa hằng số `DEFAULT_SOURCE_ROOT_PATTERNS`).
  - Bốn mutant A/B/C/D của lượt 1 được dựng lại và vẫn chết (3, 7, 2, 1 trường hợp đỏ). Việc sửa
    hạ tầng dùng chung không làm cùn khẳng định nào.
  - **Một lỗi flaky có sẵn lộ ra khi thêm ca, đã sửa hoàn toàn ở tầng fixture.** Trên macOS, libuv
    khởi động luồng FSEvents SAU khi `fs.watch()` trả về; lần ghi rơi vào cửa sổ đó không bao giờ
    được chuyển tới. Vì watcher chỉ flush khi có sự kiện, hậu quả là im lặng tuyệt đối và trường hợp
    treo hết 15 s. Đo được trước khi sửa: 2 trên 4 lần chạy `npm run test:integration` đỏ, nạn nhân
    là trường hợp nào ghi trước tiên — một lần ca mới, hai lần các ca CŨ số 3/5/7. Cách sửa nằm trọn
    trong tệp spec: `awaitWatchStreamLive()` cho các ca mới, cộng một cú hích trong `waitUntil` ghi
    tệp mồi `.fs-watch-probe` (không phải `*.java`, không phải `pom.xml`, nên không thể xuất hiện
    trong bất kỳ thông báo nào) và CHỈ chạy khi `watcher.lastChangeAt` còn `undefined`, tức chỉ bên
    trong cửa sổ khởi động. Sau khi sửa: 6 trên 6 lần chạy xanh 60/60. Không khẳng định nào của 8 ca
    cũ bị đổi hay gỡ; `makeFixture` chỉ thêm tuỳ chọn `autoStart` và chỉ ca ghi-đè-cùng-kích-thước
    dùng nó, vì ca đó cần ảnh nền được chốt bởi lần quét lúc `start()` thay vì bởi một flush chạy đua.
  - Nếu muốn chính bản triển khai đóng cửa sổ FSEvents (quét lại một lần ngắn sau `start()`) thì đó
    là thay đổi `src/` và phải là một tính năng riêng, không nhét vào lượt sửa oracle này.

  Lượt 1 (giữ lại để tra cứu):
  - Đã viết `src/workspace/file-sync-watcher.ts` và oracle Level 1 của chính nó
    `test/workspace/file-sync-watcher.spec.ts` (tính năng `kind: build`, maker sở hữu cả hai).
    Tám trường hợp chạy trên thư mục tạm thật và `fs.watch` thật; chỉ tầng LSP là giả, vì khẳng định
    ở đây là "thông báo nào được phát", không phải khung Content-Length (đã chứng minh ở lsp-client).
  - Quyết định thiết kế quan trọng: **không đọc loại thay đổi từ chuỗi sự kiện của hệ điều hành.**
    `fs.watch` báo `rename` cho cả tạo, xoá và hai nửa của một lần đổi tên, gộp sự kiện tuỳ ý, và
    trên macOS còn phát lại sự kiện của những lần ghi ngay TRƯỚC khi `watch()` được cài. Mỗi sự kiện
    chỉ lên lịch một lần flush; flush so sánh một lần quét mới với ảnh chụp lần settle trước:
    vắng → có là Created, có → vắng là Deleted, khác `(mtime, size, inode)` là Changed. Pattern
    ghi-tạm-rồi-đổi-tên rơi vào nhánh cuối vì tệp đích giữ đường dẫn nhưng nhận inode của tệp tạm.
  - Bản đầu tiên tin vào đường dẫn mà hệ điều hành nêu tên (có mặt ở cả hai phía ⇒ Changed) và bị
    chính oracle bắt đỏ: `pom.xml` bị báo Changed sau một lần sửa chỉ chạm mã nguồn, do sự kiện phát
    lại. Đây là lần đỏ có giá trị nhất của lượt này — nó chỉ ra một watcher gây làm mới project-model
    thừa ở mỗi lần khởi động workspace.
  - `settledAt` và "đã gửi thông báo" là hai sự kiện tách biệt: `lastChangeAt` đặt ngay khi có sự
    kiện thô, `settledAt` chỉ nhích sau khi lô đã debounce được gửi đi, kèm `generation` tăng một
    lần cho mỗi lô. `INV-SYNC-1` sẽ dựa vào mốc này, chưa nối dây ở giai đoạn build hiện tại.
  - Bốn mutant tự dựng đều bị oracle giết, nguồn khôi phục nguyên byte sau đó: bỏ nhánh Deleted
    (2 trường hợp đỏ), ghi nhận sửa đổi thành Created (3 đỏ), `pom.xml` chỉ phát thông báo
    watched-file (đúng trường hợp `INV-SYNC-3` đỏ), và đặt `settledAt` ngay tại sự kiện thô (đúng
    trường hợp debounce đỏ).
  - Giới hạn đã biết, thuộc phạm vi tính năng khác: `LspClient` chưa có phương thức `notify()`, nên
    watcher nhận một cổng `LspNotificationSink` do người gọi cung cấp. Không sửa `src/lsp/` trong
    lượt này vì ràng buộc "không đụng tệp ngoài phạm vi tính năng"; việc nối dây thuộc
    `feat-tool-layer-core` hoặc daemon.

- [ ] feat-prove-pool-lifecycle — chờ checker (`readyForCheck: true`, lần thử 1/3)
  - Đỏ mới trên oracle nguyên vẹn (2026-08-22): 3 test, 2 đạt, 1 hỏng. `TCON-POOL-0003` bắn
    `ERR_ASSERTION` tại dòng 205 của
    `test/integration/pool-lifecycle.integration.spec.ts`, thông điệp "an evicted workspace must be
    absent from pool.status()", giá trị thực là workspace `idle` của `project-0`. Đây là lỗi của
    oracle, không phải của `src/workspace/workspace-pool.ts`: chuỗi fixture `[p0,p1,p0,p2,p0]`
    acquire lại `p0` sau khi evict nên `p0` sống lại hợp lệ.
  - Áp đúng một sửa đổi đã được cho phép trước trong `DECISIONS.md` (2026-08-22): assertion
    vắng-mặt-khỏi-`status()` nay chỉ chạy khi `!recorder.liveProjects.has(evictedProject)`, tức thu
    hẹp về các workspace đã evict và chưa được acquire lại. Assertion `existsSync(dataDir)` — chính
    là falsifier của `INV-POOL-4` — giữ nguyên, chạy không điều kiện cho mọi phần tử `stopOrder`.
    Không đụng `src/`, không đụng `TCON-POOL-0001`/`TCON-POOL-0002`, fixture và cap giữ nguyên.
  - Xanh sau sửa: 3/3 oracle; `npm run test:integration` 48/48; `npm test` 10/10.
  - Kiểm tra không rỗng nghĩa: với bộ đếm tạm (đã gỡ ngay sau khi đo), assertion vắng mặt sau khi
    thu hẹp vẫn chạy 7 lần mỗi lượt — 3 lần `project-0`, 3 lần `project-1`, 1 lần `project-2`. Điều
    kiện bảo vệ không làm tắt assertion.

## Next

0. `node harness/loop/route.mjs` sau lượt lập kế hoạch này trỏ tới **test-designer** cho
   `feat-prove-workspace-identity`: falsifier trích dẫn `INV-POOL-1`, mà `INV-POOL-1` chưa có điều
   kiện test nào. Đúng thứ tự mong muốn — lớp oracle thiết kế điều kiện trước, rồi test-implementer
   viết `test/integration/workspace-identity.integration.spec.ts`, rồi mới tới maker.
   Sau đó `feat-prove-pool-crash-handling` (vừa gỡ chặn, `conditions` TCON-POOL-0004..0006 đã có sẵn
   trong `TP-POOL-0002`) sẽ khớp quy tắc test-implementer.
1. `feat-prove-pool-lifecycle` (đủ điều kiện, `not-started`). **Đọc
   `harness/loop/context-packets/feat-prove-pool-lifecycle.json` trước.** Router sẽ đưa tính năng này
   cho maker chứ không cho lớp oracle, vì trường `evidence` không rỗng nên quy tắc test-implementer
   không khớp. Oracle `test/integration/pool-lifecycle.integration.spec.ts` đã tồn tại và đạt 2/3 với triển khai hiện tại. TCON-POOL-0003 đỏ vì lỗi của chính oracle: vòng lặp khẳng định mọi dự án từng nằm trong `recorder.stopOrder` phải vắng mặt trong `pool.status()`, nhưng chuỗi fixture `[p0,p1,p0,p2,p0]` acquire lại `p0` sau khi evict, nên `p0` sống lại hợp lệ. Cần thu hẹp assertion về đúng các workspace đã evict và chưa được acquire lại. Phần còn lại của oracle đã được checker kiểm chứng là đúng: với mutant thêm hậu tố tick vào `dataDir`, TCON-POOL-0003 đỏ ở đúng assertion "a re-requested workspace must reuse its warm -data directory", tức INV-POOL-4 được phủ thật.
2. Add and run a committed corrupt-download/checksum-rejection integration condition for `feat-prove-provisioner`, then return it to checker review.
3. **CẦN NGƯỜI QUYẾT ĐỊNH — mục này router không còn nêu lại được.** `feat-prove-routing` FOLLOW-UP (surviving mutant M12): cả hai lượt dispatch `follow-up:feat-prove-routing:*` đã dùng hết, nên `loop/route.mjs` sẽ không bao giờ nhắc lại; đã mở một human checkpoint trong `loop/goal.md`. Chọn một trong hai: một tính năng oracle nhỏ mới, hoặc một dòng chấp nhận rủi ro dưới A-006 — không bao giờ là lần nới rộng tại chỗ thứ tư, vì tính năng đó đã đóng ở 3/3 và maker hết lượt thử. The recommended single condition (TCON-ROUTE-0008) closes the whole selection predicate at once: a five-level mixed ancestor chain (non-reactor top, reactor A, non-reactor middle, reactor B, leaf module), where a path under the leaf module must resolve to reactor A.
4. ~~Feature-planner cân nhắc một điều kiện nhỏ cho đường nối `project-router` ↔ `workspace-pool`.~~
   **Đã xử lý 2026-08-22:** cắt thành tính năng `feat-prove-workspace-identity`. Hai điểm tính hash
   độc lập là `src/workspace/project-router.ts:47` và `src/workspace/workspace-pool.ts:171`.

## Known Issues / Risks

- [ ] Eclipse snapshot downloads are slow on this network; the fetcher uses bounded parallel ranges and caches the checksum-verified archive contents.

## Notes for Next Session

The prove-provisioner feature is rejected: its 13-case green replay lacks corrupt-download/checksum-rejection coverage. `feat-lsp-client` là **done** — checker đã phê duyệt ở lần thử 2/4 sau khi tự dựng ba mutant và xác nhận oracle Level 3 bắt được cả ba; không được sửa `src/lsp/lsp-client.ts` hay file oracle nếu không có lần từ chối mới. `feat-project-router` is done and must stay untouched. `feat-prove-routing` is now **done**, approved by the checker on its final attempt (3/3). The recorded verification reproduced exactly (7/7 green, 179.6 ms), and a scratch mutant probe settled the question the previous verdict left open: the `outermost` clause of `INV-ROUTE-1` is genuinely proven, because `TCON-ROUTE-0007` is the only condition that kills the innermost-reactor mutant. One real gap remains and is recorded as a FOLLOW-UP in the feature's `checkerNotes`: mutant M12 — *if any ancestor is a reactor, take the outermost ancestor `pom.xml` even when that pom declares no `<modules>`* — survives all 7 conditions. It is proven non-equivalent: for `parent-pom-only/` (packaging=pom, no `<modules>`) containing `reactor/` (`<modules>`) containing `mod-a`, the real implementation resolves `mod-a` to `parent-pom-only/reactor` while M12 resolves it to `parent-pom-only`. No fixture places a non-reactor `pom.xml` *above* a reactor root, so `INV-ROUTE-1`'s qualifier clause is still discriminated by nothing. This must be routed as new scope, not as a fourth widening of the closed feature. Two other surviving mutants are already documented rather than new: the loosened `<modules>` regex (the accepted no-real-Maven-parser risk in design approval 3d68e0857fbfac45) and the dropped `realpathSync` (out of scope while X-005 stays open, as the spec file's own header states).

## 2026-08-22 — `feat-readiness-gate` (maker, lượt 1/3, chờ checker)

`src/workspace/readiness-gate.ts` + `test/workspace/readiness-gate.spec.ts` (6 ca, đều có
`{ timeout: 10_000 }`). Cổng chỉ mở khi `probeSemanticIndex` trả về kết quả không rỗng VÀ có ít nhất
một kết quả trỏ ngược về đúng tệp nguồn mà symbol được đọc ra (`workspace/symbol`). `noteStatus()`
chỉ ghi nhận `ServiceReady`/`ProjectStatus` và đánh thức vòng probe sớm; nó không bao giờ mở cổng.
`deadline` là tham số bắt buộc kiểu `{ at } | { withinMs }` — X-001 còn mở nên không đặt giá trị mặc
định. `probeSemanticIndex` được export riêng cho `feat-prove-sync` gọi trực tiếp.

Bằng chứng: bản falsifier chạy trước cho đỏ 5/5; ba mutant tự dựng đều bị giết đúng một ca. Mutant 2
(bỏ `settleBy` quanh probe) **sống sót ở lần đầu** vì thời hạn còn được siết lần thứ hai bên trong
probe; đã bổ sung ca 5 (probe được tiêm vào cố tình bỏ qua `timeoutMs` và không bao giờ settle) rồi
dựng lại mutant — ca 5 treo và bị `node --test` huỷ, tức mutant bị bắt. Toàn bộ suite unit: 41/41.

## 2026-08-22 — `feat-diagnostics-cache` (maker, lượt 1/3, chờ checker)

`src/lsp/diagnostics-cache.ts` + `test/lsp/diagnostics-cache.spec.ts` (13 ca đồng bộ, không đặt
`{ timeout }` vì tuỳ chọn đó vô hiệu với callback đồng bộ — DECISIONS.md 2026-08-22). Cache khoá
theo `(workspaceId, uri)` bằng map lồng nhau, hoàn toàn độc lập với vòng đời open/close: spike B cho
thấy diagnostics tới theo kiểu đẩy, kể cả cho tệp chưa từng `didOpen`. `absorb()` nhận payload thô,
kiểm tra hình dạng, rồi **ghi đè** mục cũ của URI đó — không đọc lại mục cũ, nên payload rỗng xoá
sạch problem cũ (INV-DIAG-2). `get()` phân biệt `reported: false` (chưa báo cáo) với bản báo cáo
rỗng (INV-DIAG-1). Bản lưu là `structuredClone` đã đóng băng sâu, nên không người gọi nào cộng dồn
được qua tham chiếu.

Nối dây: cache khai báo cổng hẹp `LspNotificationSource { onNotification(method, handler) }` trong
tệp của chính nó và `attach(workspaceId, source)` đăng ký đúng chuỗi `textDocument/publishDiagnostics`
của LSP 3.17. Đây là lối mà `file-sync-watcher` đã dùng cho `LspNotificationSink` và checker đã phán
là đúng ranh giới. **`LspClient` hiện chưa định tuyến notification** — `#handleMessage` bỏ qua mọi
thông điệp không mang id — nên nó chỉ tương thích cấu trúc với cổng này khi feature của lsp-client bổ
sung `onNotification`; ghi trong `checkerNotes`.

Bằng chứng: đỏ trước (module chưa tồn tại), rồi đỏ ở mức assertion với bản `absorb` cộng dồn đầu
tiên (đúng ca INV-DIAG-2). Tám mutant tự dựng theo ba trục của
`harness/memory/checker/maker-authored-mutants-cover-only-branches-he-wrote.md`: hằng số giao thức
(M2), cơ chế tự khai là chịu lực (M3 bản sao/đóng băng, M7 gỡ đăng ký), và hình dạng fixture (M4 hai
workspace, M5 rỗng-vs-chưa-tính, M6 payload hỏng, M8 version). Cả tám đều chết đúng ca nhắm tới; sau
hoàn nguyên, `diff` với bản pristine rỗng và `npm test` 41/41 xanh.

## 2026-08-22 — `feat-file-sync-watcher` (maker, lượt 3/3, chờ checker)

Lượt sửa oracle cuối trong ngân sách. Checker từ chối lần 2 vì phép so sánh quyết định `Changed` dựa
trên bộ ba `(mtimeMs, size, ino)` nhưng oracle chỉ ghim được một trường: bỏ vế `mtimeMs` (M10) hoặc
vế `size` (M13) thì 12/12 vẫn xanh, và không ca nào xoá một `pom.xml` nên nhánh làm mới cho pom bị
xoá (M12) cũng không ai canh. Chỉ chạm `test/workspace/file-sync-watcher.spec.ts`; bản triển khai
giữ nguyên từng byte, sha256 sau lượt trùng bản sao pristine lấy trước khi dựng mutant.

Ba ca mới, tất cả ghi **tại chỗ** bằng `writeFileSync` — trên macOS lệnh này mở tệp với `O_TRUNC` và
không `unlink`, nên đích giữ nguyên inode, tách hẳn khỏi lối temp-write-then-rename của ca cũ:

1. Chỉ khác mtime. Cùng số byte, mốc thời gian nền đóng băng về năm 2023 bằng `utimesSync` **trước**
   `start()`, nên mtime mới luôn khác rõ rệt bất kể độ phân giải của filesystem. Khẳng định trước
   bằng `statSync`: `ino` và `size` bằng nhau, chỉ `mtimeMs` khác. Giết M10.
2. Chỉ khác size. Nội dung dài hơn rồi `utimesSync` trả mtime về đúng mốc nền — mô phỏng `cp -p`,
   `rsync --times`, `git checkout`. Hai lệnh nằm trong cùng một khối đồng bộ nên không timer debounce
   nào chen được vào giữa để nhìn thấy mtime trung gian. Giết M13.
3. Xoá `moduleA/pom.xml` trong fixture reactor. Đòi `java/projectConfigurationUpdate` nhắm vào pom
   **gốc** (uri của pom đã xoá không còn đọc được — đúng nhánh bản triển khai tuyên bố), kèm một mục
   `Deleted` cho pom đã xoá, và pom gốc không bị báo là thay đổi. Giết M12, giết thêm cả M5.

Bằng chứng: mỗi ca xanh trên bản triển khai nguyên vẹn trước, rồi đỏ dưới đúng mutant của nó và chỉ
đỏ ở ca đó (14 ca còn lại vẫn xanh), rồi xanh lại sau khi hoàn nguyên. Năm mutant của lượt 2
(M3/M7/M5/M8/M6) dựng lại sau khi thêm ba ca vẫn chết đúng ca nhắm tới. Ổn định: verification chạy 5
lần liên tiếp 44/44 xanh, `npm run test:integration` 4 lần 87/87 xanh.

Một quan sát về môi trường, không phải hành vi của ca kiểm thử: lần chạy đầu dưới M12 báo thời lượng
209 s cho ca đang đỏ, vượt xa `{ timeout: 30000 }`. Đo lại bốn lần khi máy rảnh đều cho đúng 15,14 s.
Nguyên nhân là tải máy do các agent khác chạy song song (load average trên 5), không phải ca tự treo.

Còn nợ, thuộc lớp thiết kế chứ không thuộc maker (checker đã nêu ở lượt 2, chưa ai nhận): cập nhật
A-014 theo bằng chứng đã đo, và một tính năng riêng đóng cửa sổ khởi động FSEvents ngay trong
`start()` thay vì để tệp spec ghi tệp mồi.

## Lượt checker chạy độc lập cho bốn tính năng (2026-08-22)

Không có lượt `verify-harness --promote` nào chạy trước, nên toàn bộ phần mechanical lẫn phần ngữ
nghĩa đều do checker tự làm. Mỗi tính năng được đo trong một sandbox riêng dưới `harness/trace/scratch/`
(bản sao `src` + bản sao spec trỏ vào bản sao, đối chứng `m0` chạy trước), và mọi sandbox đã xoá.

| Tính năng | Phán quyết | Kết quả mutant do checker tự dựng |
|---|---|---|
| `feat-file-sync-watcher` | APPROVE | M10, M13, M12 đều chết đúng ca của chúng; M3 và M7 vẫn chết |
| `feat-readiness-gate` | REJECT | RM1/RM2/RM3/RM10 chết, nhưng RM4/RM5/RM6/RM7 sống sót 6/6 xanh |
| `feat-daemon-supervisor` | REJECT | DM1/DM2/DM4/DM9 chết, nhưng DM5/DM6/DM7 sống sót; DM10 làm móc `t.after` treo vô hạn |
| `feat-diagnostics-cache` | APPROVE | 11 trên 12 mutant chết; chỉ CM10 (`receivedAt`) sống sót |

Hai bài học đã ghi vào `harness/memory/checker/`: `{ timeout: N }` khai trên ca kiểm thử không che móc
`t.after`, và các cổng hẹp khai tại chỗ đang tích luỹ nợ nối dây mà không tính năng nào sở hữu.

Việc tồn đọng cần planner tạo phạm vi: (1) A-014 vẫn ghi `assumed` với ô bằng chứng rỗng trong khi số
đo đã bác bỏ nó, và cửa sổ khởi động FSEvents vẫn chưa có tính năng nào đóng trong `start()`;
(2) chưa tính năng nào sở hữu việc thêm định tuyến notification (`onNotification`) cho `LspClient`,
nên hai cổng đã khai — `LspNotificationSink` và `LspNotificationSource` — vẫn không có đầu nối, và
`feat-prove-diagnostics` đang blocked đúng vì lý do đó.

## `feat-readiness-gate` lượt 2 — vá oracle sau REJECT (2026-08-22)

Chỉ chạm `test/workspace/readiness-gate.spec.ts`. Tệp `src/workspace/readiness-gate.ts` giữ nguyên
từng byte: bản sao pristine được chụp trước mutant đầu tiên, khôi phục sau mỗi mutant, và `diff` cuối
lượt rỗng. Bốn mutant checker nêu đều đã chết, mỗi mutant đúng một ca:

| Mutant | Ca giết | Thông điệp đỏ |
|---|---|---|
| RM7 `reset()` thành no-op | ca 7 | cổng trả lại ticket của tiến trình đã chết |
| RM6 bỏ nhánh cache ticket | ca 8 | caller thứ hai probe lại và hết hạn ở 105 ms |
| RM5 bỏ chia sẻ probe đang bay | ca 4 | ba caller đồng thời đếm được 3 lần probe |
| RM4 hiểu `{ at }` như thời lượng | ca 10 | hạn 200 ms nhưng buông caller ở 3 ms |

Thêm một ca ngoài yêu cầu cho RM8: lớp kẹp bên trong `#probeOnce` quan sát được qua chính cổng
`probe` đã công khai. Ca 9 tiêm một probe, ghi lại `timeoutMs` được trao, và đòi mọi ngân sách nằm
trong `[1, hạn của caller]` trong khi trần probe là 5000 ms. RM8 trao 5000 ms cho một lời gọi 150 ms
nên chết. Hai lớp thời hạn giờ đều có ca riêng, không lớp nào còn che lớp nào.

Một thay đổi trên ca cũ, khai báo rõ: ca 5 không còn `await` không giới hạn mà chạy đua với một
watchdog 2000 ms rồi khẳng định caller đã được buông. Các khẳng định cũ giữ nguyên và chỉ được thêm
vào. Lý do là dưới RM2 ca này treo hết 10 s rồi kéo theo toàn bộ ca sau vào trạng thái `cancelled`.
Đã đo lại: RM2 vẫn chết ở ca 5, thông điệp tường minh, 0 ca bị huỷ.

Kết quả: `npm test -- test/workspace/readiness-gate.spec.ts` cho 48/48 xanh, ba lần chạy liên tiếp.
Bốn mutant của lượt 1 (RM1, RM10, RM3, RM2) được dựng lại và vẫn chết đúng ca của chúng.

## `feat-daemon-supervisor` lượt 2 — vá oracle sau REJECT (2026-08-23)

Ba ca checker đòi đã có, mỗi ca giết đúng một mutant và không giết ca nào khác:

| Mutant | Ca giết | Thông điệp đỏ | Thời gian |
|---|---|---|---|
| DM5 bỏ thu hồi khoá mồ côi | ca 6 | `budget exceeded: startDaemon over an orphaned lock file ... 1000 ms` | 1288 ms |
| DM7 shutdown delegated xoá socket của daemon | ca 7 | `a delegated shutdown must leave the daemon's socket file in place` | 246 ms |
| DM6 bỏ cửa chặn `sun_path` | ca 8 | `Missing expected rejection` | 257 ms |
| DM10 shutdown không destroy connection | ca 9 | `budget exceeded: shutdown() with one accepted client connection ... 1000 ms` | 8351 ms |

Móc dọn dẹp treo vô hạn được sửa ở **cả hai phía**, vì đo đạc cho thấy một phía là không đủ. Phía
test có `withBudget` cấp ngân sách cho từng lời gọi shutdown, nên quá hạn thành lỗi có tên. Nhưng
chỉ với phía test, DM10 vẫn để lại treo thật: cả 9 ca báo xong rồi tiến trình không bao giờ thoát,
phải SIGKILL ở 120 s, vì server rò rỉ giữ event loop sống. Nên `closeServer` trong `src` nhận thêm
hạn cưỡng bức 2000 ms: hết hạn thì destroy mọi connection còn lại để `server.close()` buộc phải
hoàn tất. Đây là lỗi tin cậy thật của INV-SHIM-4 — trình xử lý tín hiệu gọi `shutdown()`, nên một
`server.close()` kẹt khiến tiến trình không thoát và bỏ lại toàn bộ JVM con.

Ca 9 đòi shutdown xong trong 1000 ms, nằm hẳn dưới hạn cưỡng bức 2000 ms, nên hạn cưỡng bức không
biến DM10 thành mutant tương đương: dưới DM10 nó rơi xuống đường chậm và chết đỏ.

Phát hiện phụ, đo trên Node 22.23.2 / macOS: chú thích cũ của `MAX_SOCKET_PATH_LENGTH` sai.
`listen()` trên đường dẫn 234 byte **trả về thành công**, `server.listening` là true, nhưng libuv
cắt cụt tên vào `sun_path` nên không có tệp socket nào ở đường dẫn được yêu cầu. Cửa
`existsSync(socketPath)` của `probeDaemon` vì thế mãi mãi sai và không launcher nào sau đó thấy
được daemon: INV-SHIM-2 hỏng trong im lặng. Chú thích đã sửa theo số đo.

Kết quả: `npm test -- test/daemon/daemon-supervisor.spec.ts` cho 57/57 xanh; riêng tệp 9/9 xanh,
năm lần chạy liên tiếp đều 256-259 ms và exit 0; `npm run test:integration` cho 95/95 xanh.

Còn mở, ngoài phạm vi: `test/daemon/*.spec.ts` không nằm trong glob của script `npm test` trong
`package.json`. Tệp dùng chung toàn dự án, để feature-planner xử lý.

## 2026-08-23 — maker: feat-lsp-notifications (lượt 1/3, chờ checker)

`LspClient` mang được thông điệp không có `id` ở cả hai chiều; suite unit 57/57, tích hợp 105/105.

Ba nhánh được thêm vào `src/lsp/lsp-client.ts`, không đụng tới `#write` hay `#drainFrames`:

| Thêm gì | Vì sao |
|---|---|
| `notify(method, params?)` | Ghi khung không có `id`, không lấy số từ `#nextId`, không đặt ô vào `#pending`. Một notification mang `id` bị JDT LS coi là request và ô đó không bao giờ settle. |
| `onNotification(method, handler)` | Đăng ký cộng dồn theo mảng, trả về hàm gỡ. `DiagnosticsCache.attach()` gọi cổng này mỗi lần và không có đường gỡ ở phía nguồn, nên ghi đè theo method sẽ huỷ subscriber trước trong im lặng. |
| Nhánh notification trong `#handleMessage` | Dòng `if (typeof message.id !== "number") return;` trước đây bỏ rơi mọi khung không có `id`, kể cả `textDocument/publishDiagnostics`. Nhánh mới đứng sau nhánh request server→client, nên hành vi tương quan theo `id` giữ nguyên. |

Ba mutant tự dựng, mỗi mutant chỉ giết đúng nhóm ca nhắm tới, phần còn lại vẫn xanh:

| Mutant | Ca giết | Dòng đỏ |
|---|---|---|
| A: `notify()` cấp `id` và đặt ô vào `#pending` | 2 ca chiều gửi | `hasOwn id` expected false actual true; request kế tiếp nhận `id: 3` thay vì `2` |
| B: `#handleMessage` bỏ rơi lại khung không có `id` | 3 ca chiều nhận | `the notification was dropped instead of dispatched` |
| C: `onNotification` ghi đè theo method | 2 ca cộng dồn | `[ 'third' ]` thay vì `[ 'first', 'second', 'third' ]` |

Sau mỗi mutant, tệp nguồn được khôi phục từ bản pristine chép ra ngoài cây nguồn; `diff` cuối lượt
rỗng. Tương thích cấu trúc với hai cổng được chứng minh bằng `tsc` trên một tệp gán tạm
(`LspClient` gán được vào cả `LspNotificationSource` lẫn `LspNotificationSink`), tệp đó đã xoá.

Ba quyết định đã ghi vào `checkerNotes` để checker phán, không giấu trong mã: kiểu trả về của
`onNotification`, việc nuốt lỗi ném ra từ handler, và việc `notify()` ném lại lỗi thoát tiến trình.

Còn mở, ngoài phạm vi: nối dây production (pool trao `lease.client` cho `cache.attach()` và cho
sink của watcher) thuộc `feat-tool-layer-core`/`feat-mcp-shim`. Chưa có test tích hợp nào dùng
`LspClient` thật cho notification — cả `diagnostics-cache.spec.ts` lẫn `file-sync-watcher.spec.ts`
vẫn dùng cổng giả lập riêng.

## 2026-08-23 — `feat-lsp-notifications` lượt 2: đóng hai khe hở oracle checker chỉ ra

Checker REJECT lượt 1 vì hai mutant do chính checker dựng sống sót với 9/9 ca xanh. Bản triển khai
`src/lsp/lsp-client.ts` không có lỗi nào; khiếm khuyết nằm ở oracle. Lượt này chỉ thêm ca kiểm thử.

| Mutant sống ở lượt 1 | Câu thiết kế không ai chứng minh | Ca mới đóng khe hở |
|---|---|---|
| F: thân hàm gỡ đăng ký đổi thành `return () => {};` | "Hàm trả về gỡ đúng subscriber này" — không ca nào từng gọi giá trị `onNotification()` trả về | `the function returned by onNotification really unsubscribes that handler` |
| E: bỏ ảnh chụp, `for (const handler of handlers)` | Chú thích dòng 158: một handler có thể gỡ đăng ký ngay trong lúc dispatch | `a handler unsubscribing itself mid-dispatch does not make its siblings be skipped` |

Ca thứ nhất bắn một khung **trước** khi gọi hàm gỡ và đòi `calls === 1`. Không có bước này, số 0 ở
khẳng định cuối cũng đúng khi handler chưa bao giờ được nối vào dispatch, tức ca sẽ xanh vì lý do
sai. Ca thứ hai đăng ký ba handler cho cùng method, handler thứ nhất gọi hàm gỡ của chính nó trong
thân callback; khung đầu đòi cả ba chạy, khung sau đòi chỉ còn `[second, third]`.

Khả năng phân biệt được đo riêng cho từng mutant chứ không suy diễn: E chỉ giết ca thứ hai (58/59
ca còn lại xanh, kể cả ca thứ nhất), F giết cả hai ca mới. Dưới cả hai mutant, chín ca cũ vẫn xanh —
tái hiện đúng phát hiện của checker. Nguồn được khôi phục từ bản pristine chép ra ngoài cây nguồn;
`diff` rỗng và sha256 `f48e5974…` khớp bản chụp trước khi dựng mutant, nên `src/` không đổi một byte.

Suite sau lượt này: `npm test` 59 pass 0 fail (11 ca của spec notification, bốn ca cũ của
`test/lsp/lsp-client.spec.ts` không vỡ), `npm run test:integration` 107 pass 0 fail, `./harness/init.sh`
xanh. Tính năng đặt `readyForCheck: true`, `attempts` 2/3, `status` giữ `in-progress`.

## 2026-08-23 — `feat-mcp-shim` lượt 1: front end stdio, cổng chặn stdout và tái kết nối trong suốt

Hai tệp mới: `src/shim/mcp-shim.ts` (triển khai) và `test/shim/mcp-shim.spec.ts` (7 ca oracle).
Không sửa một dòng nào ngoài phạm vi tính năng; `src/daemon/daemon-supervisor.ts` giữ nguyên.

**Quyết định thiết kế lớn nhất: shim KHÔNG phải một pipe byte thô.** `INV-SHIM-1` là thuộc tính của
stdout, và shim là thứ cuối cùng đứng trước stdout của client. Một `socket.pipe(process.stdout)`
chuyển thẳng mọi thứ phía daemon phát ra — stack trace, dòng cảnh báo — vào bộ phân tích của client,
trái với câu trong MCP spec: server "MUST NOT write anything to its stdout that is not a valid MCP
message". Vì vậy mỗi dòng lấy từ socket đều được ghép khung rồi qua cổng `isMcpMessage`; dòng không
phải MCP đi ra stderr kèm nội dung để còn gỡ lỗi. Lý do thứ hai: `INV-SHIM-3` cần độ hạt là **cả một
thông điệp**. Một pipe byte mất socket giữa chừng đã trao nửa thông điệp cho daemon vừa chết, nửa
còn lại sẽ sang daemon thay thế. Đệm theo dòng trọn vẹn khiến một lần khởi động lại chỉ tốn các lời
gọi đang bay, không bao giờ làm hỏng khung.

**Auto-spawn nghĩa là gì ở đây.** Shim gọi `startDaemon` của `daemon-supervisor`, không tự dựng lại
giao thức probe/lock. Khi chưa ai phục vụ đường dẫn, chính tiến trình shim bind socket
(`role: "daemon"`); khi đã có daemon, handle là `delegated` và mang sẵn connection. Đây là cơ chế duy
nhất mà phụ thuộc đã `done` trao ra; không tài liệu thiết kế nào nói tới một daemon tách rời chạy
detached, nên điều này được ghi vào `checkerNotes` thay vì tự bịa ra.

**Oracle chia hai mức, có lý do đo được.** Hai ca `INV-SHIM-1` chạy shim như một tiến trình con thật
và đọc byte trên stdout thật, vì một `console.log` ghi vào `process.stdout` mà oracle giữ `Writable`
tiêm vào không bao giờ thấy. Mutant M1 chứng minh đúng điều đó: nó giết **chỉ** ca ở biên tiến trình,
sáu ca trong tiến trình vẫn xanh.

Ca `INV-SHIM-3` dùng hai tiến trình daemon thật, gắn thẻ câu trả lời bằng pid của chính nó, và
SIGKILL cái thứ nhất. Cổng `launch` được **chặn nhịp chứ không giả lập**: `startDaemon` thật vẫn
chạy, test chỉ quyết định *khi nào* shim được phép chạy lại nó. Không có nhịp chặn đó, lần giết
daemon sẽ chạy đua với việc shim tự bind socket đang trống, và ca sẽ không chứng minh được gì về một
lần khởi động lại thật.

| Mutant | Ca bị giết | Dòng đỏ |
|---|---|---|
| M1 `console.log` trong `establish()` | chỉ ca biên tiến trình | `real stdout line 1 is not a valid MCP message: "shim linked: role=daemon"` |
| M2 bỏ `reconnect()` ở handler `close` | chỉ ca `INV-SHIM-3` | quá hạn 10 s chờ câu trả lời thứ hai sau khởi động lại |
| M3 bỏ cổng `isMcpMessage` | cả hai ca `INV-SHIM-1` | `stdout line 1 is not a valid MCP message: "Error: java.lang.IllegalStateException…"` |
| M4 vứt thông điệp thay vì đệm khi mất link | chỉ ca `INV-SHIM-3` | quá hạn 5 s chờ shim giữ lời gọi như một thông điệp trọn vẹn |
| M5 `LineFramer` phát một khung mỗi chunk | chỉ ca ghép khung | thông điệp 200 KB chia 7 lần ghi tới nơi thành 7 dòng thay vì 1 |

Nguồn được khôi phục từ bản sao pristine để ngoài cây nguồn; `diff` rỗng, và `grep` xác nhận trong
`src/shim/mcp-shim.ts` không còn `console.log` nào, chỉ một tham chiếu `process.stdout` duy nhất là
giá trị mặc định của tuỳ chọn tiêm.

Kết quả: `npm test -- test/shim/mcp-shim.spec.ts` 66 pass 0 fail; spec shim chạy riêng 5 lần liên
tiếp 5/5 xanh (không flaky ở ca giết daemon); `npm run test:integration` 114 pass 0 fail;
`./harness/init.sh` xanh. Tính năng đặt `readyForCheck: true`, `attempts` 1/4, `status`
`in-progress`.

Còn mở, ngoài phạm vi: glob `test` mặc định trong `package.json` giữ nguyên theo tiền lệ của
`daemon-supervisor` — spec được với tới qua lệnh verification của chính tính năng và qua
`npm run test:integration`. Việc nối dây tầng tool (`onConnection` thật của daemon) thuộc
`feat-tool-layer-core`; ở tính năng này `onConnection` chỉ là tham số truyền suốt.

## 2026-08-23 — `feat-mcp-shim`, lượt 2: đóng ba khoảng trống oracle sau REJECT

Checker trả lại lượt 1 vì bản triển khai đúng nhưng oracle thiếu ca. Lượt này không sửa `src/`:
`src/shim/mcp-shim.ts` giữ nguyên từng byte (sha256 `1e9b1128…`, `diff` với bản sao pristine rỗng
sau toàn bộ đợt dựng mutant). Chỉ `test/shim/mcp-shim.spec.ts` thay đổi, từ 7 lên 11 ca.

| Mutant | Ca bị giết | Dòng đỏ |
|---|---|---|
| C7 dùng chung một `LineFramer` cho mọi link | không ca nào (11/11 xanh) | — |
| C4 bỏ `framer.flush` ở handler `close` | ca nửa-thông-điệp | `exactly the one truncated tail must have been diverted` |
| C4+C7 cùng lúc | ca nửa-thông-điệp | quá hạn 10 s chờ câu trả lời `id=2`; stdout chỉ còn `id=1` — câu trả lời biến mất hẳn |
| C3 `console.log` ở dòng link-closed | hai ca recorder | `INV-SHIM-1 violated: the reconnect/stop path wrote to the process's own stdout` |
| C3b `console.log` ở nhánh reconnect thất bại | hai ca recorder | như trên |
| C8 `console.log` ở nhánh stop-shutdown thất bại | ca recorder thứ nhất | như trên |
| C11 từ chối lên vai daemon khi `links > 0` | đúng ca đổi role, không ca nào khác | quá hạn 15 s chờ `the shim to answer call 2 after adopting the daemon role` |

Ca nửa-thông-điệp gửi mảnh JSON cụt trong **cùng một lần ghi socket** với câu trả lời `id=1`, nên
thứ tự thành xác định thay vì dựa vào một khoảng chờ: câu trả lời có mặt trên stdout là bằng chứng
mảnh cụt đã nằm trong framer.

Cạm bẫy phải trả giá một lần: recorder ngây thơ trên `process.stdout.write` không dùng được, vì
`node --test` chạy mỗi tệp spec trong tiến trình con và báo cáo kết quả qua **chính**
`process.stdout` bằng bộ tuần tự V8. Recorder chỉ ghi chunk kiểu chuỗi, kèm khẳng định
`NODE_TEST_CONTEXT === "child-v8"` và một mỏ neo dương tự chứng minh recorder đang sống. Chi tiết ở
`harness/memory/maker/stdout-recorder-must-ignore-the-runner-channel.md`.

Kết quả: `npm test -- test/shim/mcp-shim.spec.ts` 70 pass 0 fail; spec shim chạy riêng 5 lần liên
tiếp 11/11; `npm test` 59 pass; `npm run test:integration` 118 pass 0 fail; `./harness/init.sh`
xanh. `attempts` 2/4, `readyForCheck: true`.

Không đụng tới điểm 4 của checker (client sở hữu daemon chết kéo theo pool của client khác) — đó là
câu hỏi tầng thiết kế, cần một dòng assumption có chủ sở hữu, không phải việc của lượt maker.

### Checker — feat-mcp-shim lượt 2: REJECT

Ba khoảng trống của lượt 1 đã đóng thật. Checker tự dựng lại toàn bộ mutant trong sandbox riêng
(bản đối chứng `m0` xanh 11/11 trước mọi kết luận): `C4` một mình giết ca nửa-thông-điệp, `C7` một
mình sống, `C4+C7` giết đúng với triệu chứng "câu trả lời `id=2` biến mất hẳn". Năm vị trí gọi
`log()` trên đường reconnect/stop đều bị recorder bắt — ba biến thể của maker chết sớm ở mỏ neo
stderr nên checker dựng thêm ba biến thể *cộng-thêm* để chứng minh chính recorder. `C11` giết đúng
một ca. Bằng chứng tái hiện đủ: 70/70, 59/59, 118/118, 5 lần chạy liên tiếp không dao động,
sha256 của `src/shim/mcp-shim.ts` khớp báo cáo.

Vẫn trả lại vì bảy mutant do checker thiết kế sống sót 11/11, trong đó bốn cái phá đúng một câu mà
chú thích trong `src` gọi là chịu lực:

| Mutant | Phá cái gì | Kết quả |
|---|---|---|
| `D1` | `StringDecoder` → `chunk.toString("utf8")` | 11/11 xanh — fixture của ca framing không hề cắt giữa ký tự (tiền tố 42 byte, bước 30.000 byte, mọi ranh giới rơi đúng đầu ký tự) |
| `CE1` | thêm `console.log` vào `socket.on("error")` | 11/11 xanh — probe ghi file chứng minh handler không chạy lần nào |
| `CE1del` | xoá hẳn listener `error` | 11/11 xanh — một bản thiếu listener làm chết tiến trình shim mà suite không thấy |
| `D3` | `while` → `if` trong `flushPending` | 11/11 xanh — mọi ca chỉ đệm đúng một dòng |
| `D2` | `pending.push` → `pending.unshift` | 11/11 xanh — thứ tự nạp lại không ca nào phán xét |
| `D4` | rò rỉ stdout dạng `Buffer` | 11/11 xanh — giới hạn đã biết của recorder, ghi nhận, không bắt buộc sửa lượt này |

Hai phép đo làm cho yêu cầu trở nên khả thi thay vì suông: `resetAndDestroy()` **ném**
`ERR_INVALID_HANDLE_TYPE` trên Unix socket, nhưng phá socket phía daemon rồi ghi ngay một message
lớn từ phía client cho ra đúng một sự kiện `error` mã `EPIPE`; và với điểm cắt giữa ký tự,
`chunk.toString()` sinh ra văn bản khác bản gốc mà **vẫn** parse được thành JSON — đúng kịch bản xấu
nhất mà chú thích của `LineFramer` mô tả.

### Maker — feat-mcp-shim lượt 3: đóng cả bốn mutant sống sót

`src/shim/mcp-shim.ts` không đổi một byte (sha256 `1e9b1128…ff80`, `diff` với bản sao pristine
rỗng). Chỉ `test/shim/mcp-shim.spec.ts` thay đổi: 11 → 13 ca.

| Mutant | Ca đóng nó | Dòng đỏ |
|---|---|---|
| `D1` | ca framing viết lại | `differs at character 74 — expected "𝄞-ü\"}}", got "����-ü\"}}"` (vẫn parse được thành JSON) |
| `CE1` | ca 12 mới | `INV-SHIM-1 violated: the daemon link error path wrote to the process own stdout` |
| `CE1del` | ca 12 mới | `timed out … waiting for: a real error event on the daemon link` |
| `D3` | ca 13 mới | `answered: [1,2], still buffered: 2, daemon saw: 2` |
| `D2` | ca 13 mới | `actual [1,4,3,2]` vs `expected [1,2,3,4]` |

Ba điểm đáng ghi lại:

1. **Điểm cắt giữa ký tự phải được chứng minh, không được tuyên bố.** `midCharacterCut()` lấy byte
   thứ hai của ký tự 4 byte `𝄞` và khẳng định `(byte & 0xc0) === 0x80`. Việc chunk thật sự tới
   thành hai lần đọc cũng được chứng minh: một thông điệp neo đi chung chunk với phần đầu, nên
   thấy thông điệp neo nghĩa là framer đã nuốt xong phần đầu; phần đuôi chỉ được ghi sau đó cộng
   một khoảng lắng 100 ms nên không thể bị gộp chunk. Cả hai chiều giết `D1` độc lập.
2. **`CE1del` không làm chết tiến trình như chú thích trong `src` nói.** Đo được:
   `daemon-supervisor.probeDaemon` để lại một `socket.once("error", …)` đã settled trên chính
   connection trao cho shim; listener đó nuốt sự kiện `error` đầu tiên rồi trả về im lặng. Nhánh
   vẫn chịu lực (thiếu nó thì lỗi biến mất không dấu vết) nhưng lý do trong chú thích chưa đúng
   trên đường `delegated`. Ghi vào `checkerNotes`, không sửa `src` ở lượt này.
3. **Thứ tự thao tác quyết định có sinh được `EPIPE` hay không.** Phá socket phía daemon *rồi* ghi
   ngay một call 1 MB: 5/5 lần có `error`. Ghi trước rồi phá sau với thông điệp nhỏ: 0/5.

Suite: 13/13 (5 lần liên tiếp), thêm 10 lần chạy riêng ba ca nhạy timing đều xanh;
`npm test -- test/shim/mcp-shim.spec.ts` 72/72; `npm test` 59/59; `npm run test:integration` 120/120;
`./harness/init.sh` xanh.

## 2026-08-24 — `feat-tool-layer-core` (maker, lượt 1/3)

Lõi `mcp-tool-layer` (`src/tools/tool-layer.ts`, MỚI) cộng phần nối dây production của đường
notification trong `workspace-pool.ts`, đúng phạm vi mà feature-planner cấp cho tính năng này ở
lượt 2 ngày 2026-08-23.

**Ranh giới toạ độ.** Toàn tệp có đúng hai hàm chạm vào phép cộng trừ chỉ số: `fromLspPosition`
(LSP 0-based UTF-16 → 1-based của X-007) và `toLspPosition` cho chiều ngược lại. `fromLspRange`,
hover, completion và mọi capability sau này đều đi qua chúng — đó là toàn bộ nội dung của
`INV-TOOL-1`. Không có đường tắt nào tự cộng lấy, và mutant `M1` dựng một đường thứ hai cho
completion bị giết ngay bằng khẳng định `completionRange` phải bằng `hoverRange`.

**Thứ tự các bước trong `callPositionalTool` là nội dung của hai bất biến, không phải sở thích:**
hỏi readiness → đọc nội dung hiện tại → xác thực line/column → chỉ khi đó mới phát LSP request.
Facade giả đếm số lời gọi, nên "chưa gọi LSP lần nào" là một đại lượng đo được chứ không phải suy
đoán; ca `INV-TOOL-5` có mỏ neo dương (vị trí hợp lệ sinh đúng 2 lời gọi) trước khi khẳng định 0.

**Vòng đời attach là spawn ↔ evict, không phải acquire ↔ release.** `WorkspaceAttachment` chạy đúng
một lần cho mỗi tiến trình JDT LS, trong `#startWorkspace` sau khi `spawnWorkspace` trả về; hàm
detach chạy đúng một lần trong `#evict`, TRƯỚC `spawned.stop()`. `diagnosticsAttachment(cache)` gỡ
đăng ký trước rồi mới `cache.forget()` — thứ tự ngược lại để một publish tới muộn dựng lại đúng mục
vừa bị xoá, và đó chính là mutant `M5`.

| Mutant | Ca đóng nó | Dòng đỏ |
|---|---|---|
| `M1` INV-TOOL-1 | hover+completion cùng response | `completionRange` lệch `hoverRange` |
| `M2` INV-TOOL-5 | toạ độ vượt giới hạn | `expected true, actual false` (isError) |
| `M3` INV-TOOL-4 | not-ready + taxonomy X-003 | 2 ca đỏ, `expected true, actual false` |
| `M4` attach theo lease | attach một lần mỗi tiến trình | `expected 1, actual 6` |
| `M5` forget không detach | publish sau evict | `expected false, actual true` |
| `M6` không detach lúc evict | forget + đóng watcher | 2 ca đỏ |

**Một bài học phải trả giá bằng một lần treo.** `M6` lần đầu không cho dòng đỏ nào: nó làm rò một
handle `fs.watch` persistent, `node --test` không thoát, và cả tệp spec treo thay vì báo đỏ. Ca đó
phải tự cấp ngân sách cho mình — cleanup đóng mọi watcher NGOÀI đường evict — thì mới lấy lại được
dòng đỏ có tên. Ghi vào memory của maker.

Suite: `npm test -- test/tools/tool-layer.spec.ts` đỏ 10 ca với skeleton, xanh 75/75 sau khi triển
khai; 6 mutant đều bị giết và `diff` với bản pristine rỗng sau khi hoàn nguyên; `npm test` 75/75;
`npm run test:integration` 139/139; `tsc --noEmit --strict` sạch; `./harness/init.sh` xanh.

## 2026-08-24 — `feat-tool-references` (maker, lượt 1/3)

`java_references` là tool mỏng đầu tiên có danh sách kết quả, nên nó là chỗ `INV-TOOL-3` lần đầu có
thân xác: mọi danh sách vượt cap phải đi ra ở dạng đã cắt KÈM `truncated: true` và tổng số THỰC.
Chỉ chạm `src/tools/references.ts` (mới) và `test/tools/references.spec.ts` (mới).

**Đỏ trước, và đỏ đúng chỗ.** Bản đầu tiên của `references.ts` cố tình bỏ bước cắt — nó chính là
falsifier viết thành mã. Oracle báo đỏ 3/12 với dòng `expected 200, actual 250`, tức lần đỏ rơi vào
khẳng định chứ không vào lỗi biên dịch hay thiếu fixture. Sau khi thêm bốn dòng cắt: 12/12 xanh.

**Cap không nằm cứng trên đường cắt.** X-008 còn mở nên con số 200 chỉ xuất hiện đúng một lần, ở
hằng số có tên `DEFAULT_REFERENCE_CAP`, và `ReferencesOptions.cap` ghi đè được. Ca kiểm thử đổi cap
qua tuỳ chọn (10 và 300 trên cùng một câu trả lời 250 phần tử) là bằng chứng cơ học: nếu còn một số
200 cứng đâu đó, hai ca này không thể cùng xanh.

**`callPositionalTool` chưa nhận capability `references`**, và tool-layer đang bị checker xem xét
nên không được sửa ở lượt này. `references.ts` vì vậy lắp lại đúng trình tự bốn bước từ các hàm
tool-layer xuất ra — workspace → readFile → validatePosition → request — và cho MỌI location đi qua
`fromLspRange`; không có phép cộng toạ độ nào trong tệp này. Cái giá là hàm `fail()` bị nhân bản vì
tool-layer không xuất nó; ghi trong `checkerNotes` để lượt sau gộp lại.

| Mutant | Ca đóng nó | Dòng đỏ |
|---|---|---|
| `M1` bỏ hẳn phép cắt | vượt cap, ngưỡng cap, cap-từ-cấu-hình | 3 đỏ — đúng falsifier `INV-TOOL-3` |
| `M2` `total` lấy số sau khi cắt | vượt cap + ngưỡng cap | 3 đỏ, `total` báo 200 thay vì 250 |
| `M3` `total >= cap` (lệch-một) | đúng ngưỡng cap | 1 đỏ — chỉ ca biên chết |
| `M4` cap hard-code, bỏ qua cấu hình | dưới cap, ngưỡng cap, cap-từ-cấu-hình | 3 đỏ |

Suite: `node --test test/tools/references.spec.ts` đỏ 3/12 trước khi cắt, xanh 12/12 sau; bốn mutant
đều bị giết và `diff` với bản pristine rỗng sau khi hoàn nguyên; `test/integration` 41/41 xanh;
`tsc` với đúng cấu hình dự án sạch cho cả hai tệp mới. `npm test` toàn bộ báo 108/116 — 8 lỗi nằm
trọn trong `hover.spec.ts` và `diagnostics.spec.ts` của hai maker đang chạy song song, ngoài phạm vi
lượt này; `references`, `tool-layer` và `definition` đều xanh hết.

## 2026-08-24 — maker — `feat-tool-hover`: `java_hover` với range không bao giờ vắng mặt

Falsifier của tính năng có hai vế: một hover result mà vị trí chưa đi qua ranh giới chuyển đổi duy
nhất của tầng tool nên âm thầm 0-based [INV-TOOL-1], hoặc một kết quả THÀNH CÔNG bỏ sót trường
`range` [INV-TOOL-6]. Chỉ chạm `src/tools/hover.ts` (mới) và `test/tools/hover.spec.ts` (mới);
`src/tools/tool-layer.ts` chỉ được đọc vì đang có checker xem xét song song.

**Đỏ trước, và đỏ đúng chỗ.** Bản đầu tiên của `hover.ts` chính là falsifier viết thành mã: kết quả
thành công không có `range`, và `position` tự trừ đi 1 thay vì nhận từ tầng tool. Oracle báo đỏ
5/10, mọi dòng đỏ rơi vào khẳng định (`hover thành công không bao giờ bỏ sót range`, `expected
'String demo.Rocket.gréet(String tên)'`), không vào lỗi nạp module. Sau khi triển khai thật: 11/11
xanh.

**Wrapper mỏng nghĩa là không có một phép cộng trừ toạ độ nào.** `hover.ts` gọi `hover()` của
tool-layer rồi chuyển tiếp nguyên vẹn `answer.position` và `shaped.range`. Ca `INV-TOOL-1` gọi cùng
một đầu vào qua hai đường — `javaHover` và `callPositionalTool` — rồi `deepEqual` hai kết quả; lệch
một đơn vị ở bất kỳ đâu là hỏng. Ca astral-plane nhắm token `động` nằm SAU `🚀` trên cùng dòng, với
facade trả hover KHÔNG kèm range (đường đi thật của JDT LS), rồi cắt lại chuỗi từ nội dung tệp bằng
chính range báo về.

**Hai quyết định tạo hình đã ghi vào `checkerNotes`.** Thứ nhất, "không giải được phần tử nào" là
nhánh no-result tường minh `{ resolved: false, reason }` trong một outcome THÀNH CÔNG, không phải
một mã X-003 — taxonomy đó đóng và không mã nào mô tả "ở đây không có symbol"; kiểu
`JavaHoverResolved` buộc `range` có mặt nên trạng thái "thành công thiếu range" không biểu diễn
được. Thứ hai, bảng tool nói `java_hover` trả "signature + javadoc" nhưng tool-layer gộp nội dung
hover thành MỘT chuỗi, nên `hover.ts` chỉ tách trình bày (khối đầu hoặc thân khối mã markdown là
signature, phần còn lại là javadoc) và luôn giữ `contents` thô.

| Mutant | Ca đóng nó | Dòng đỏ |
|---|---|---|
| `M1` bỏ hẳn trường `range` | 6 ca, trong đó `INV-TOOL-6: mọi hover thành công đều mang range` | 6 đỏ — đúng vế hai của falsifier |
| `M2` wrapper tự trừ 1 cho `position` | ca cơ bản + `INV-TOOL-1` hai đường | 2 đỏ — đúng vế một của falsifier |
| `M3` no-result giả dạng kết quả có `range` | `INV-TOOL-6: no-result tường minh` | 1 đỏ — chỉ ca nhắm tới chết |

Suite: `node --test test/tools/hover.spec.ts` đỏ 5/10 trên bản stub, xanh 11/11 sau khi triển khai;
ba mutant đều bị giết và `diff` với bản pristine rỗng sau khi hoàn nguyên; `npm test` 117/117 xanh;
`npm run test:integration` 181/181 xanh.

## Lượt maker 2026-08-24 — `feat-tool-definition` (in-progress, 1/3, chờ checker)

Tệp mới: `src/tools/definition.ts` (triển khai) và `test/tools/definition.spec.ts` (13 điều kiện).
Không chạm tệp nào khác — `src/tools/tool-layer.ts` chỉ đọc.

**Tái dùng thay vì chép lại.** `definition()` gọi `callPositionalTool(facade, request, [])`: danh
sách capability rỗng chạy đúng ba bước chung của tầng tool — hỏi workspace sẵn sàng, đọc nội dung
hiện tại, xác thực line/column — mà không phát request nào. Nhờ đó `invalid-position`, `unroutable`
và năm nhánh workspace của X-003 tới thẳng từ feat-tool-layer-core. Phần riêng của tệp chỉ là phát
`textDocument/definition` và tạo hình location.

**Không một phép cộng trừ toạ độ nào trong tệp.** Chiều xuống dùng `toLspPosition`, chiều lên dùng
`fromLspRange`, cả hai của tool-layer, và áp cho MỌI phần tử trong danh sách. Một điều kiện so chéo
kết quả `java_definition` với kết quả hover trên cùng một range LSP: lệch một đơn vị ở bất kỳ đâu là
hỏng.

**Bốn hình dạng phản hồi LSP được chuẩn hoá về một mảng:** `Location`, `Location[]`,
`LocationLink[]` và `null`. Với `LocationLink`, kết quả lấy `targetSelectionRange` (range của chính
định danh) và chỉ lùi về `targetRange` khi server không gửi. Mảng rỗng hoặc `null` là nhánh
`resolved: false` kèm lý do đọc được, không phải một danh sách rỗng mập mờ (INV-TOOL-4).

| Mutant | Ca đóng nó | Dòng đỏ |
|---|---|---|
| `M1` chỉ chuyển đổi location đầu tiên | ca mảng nhiều khai báo + ca `LocationLink[]` | 2 đỏ — đúng mutant mà falsifier nhắm tới |
| `M2` thay `fromLspRange` bằng ánh xạ thô | 5 ca, trong đó ca so chéo với hover | 5 đỏ |
| `M3` bỏ nhánh no-result | ca mảng rỗng + ca `null` | 2 đỏ |
| `M4` ưu tiên `targetRange` | ca `LocationLink[]` | 1 đỏ — chỉ ca nhắm tới chết |
| `M5` nuốt lỗi request | ca `workspace-crashed` | 1 đỏ |

Suite: đỏ 6/13 trên bản stub hiện thân falsifier, xanh 13/13 sau khi triển khai, `diff` với bản
pristine rỗng sau khi hoàn nguyên mutant; `node --test test/integration/*.spec.ts` 41/41 xanh. Chạy
`npm test` toàn bộ có 8 đỏ thuộc `test/tools/hover.spec.ts` và `test/tools/diagnostics.spec.ts` của
các maker đang chạy song song, không ca nào thuộc `definition.spec.ts`.

## feat-tool-diagnostics — java_diagnostics đọc cache đẩy (2026-08-24, maker)

`src/tools/diagnostics.ts` (mới) + `test/tools/diagnostics.spec.ts` (mới). Đây là item 4 trong build
order và là tool đầu tiên KHÔNG phát LSP request nào: nó đọc lại `diagnostics-cache`, nên cổng
`DiagnosticsFacade` cố ý không có `request()`, chỉ có `workspace()`, `scopeOf()` và
`projectFiles()`.

**Hình dạng giữ INV-DIAG-1 sống:** `FileDiagnostics` là union hai nhánh —
`{uri, status: "not-reported"}` và `{uri, status: "reported", problems, receivedAt, version?}`.
Nhánh "chưa báo cáo" KHÔNG mang trường `problems`, kể cả một mảng rỗng: một người gọi đọc
`problems.length === 0` sẽ đọc "chưa index xong" thành "mã nguồn sạch", đúng câu trả lời sai mà
falsifier mô tả.

**Phạm vi toàn project hợp nhất hai tập:** danh sách tệp của project và khoá của cache. Bảng tool
nói `java_diagnostics` trả lời cho "every file in the project"; một tệp chưa được index vắng mặt
khỏi cache, nên nếu chỉ liệt kê khoá cache thì tệp đó biến mất và câu trả lời đọc ra y hệt "tệp đó
sạch". Vế ngược lại giữ cho problem ở URI mà danh sách tệp không nêu tên (mã sinh) không bị bỏ rơi.

**Thứ tự bước là nội dung của bất biến:** readiness đứng trước mọi lần chạm cache. Một workspace
đang index có cache trống, và cache trống đọc ra y hệt một project không lỗi (INV-TOOL-4). Ca kiểm
thử đo thẳng đại lượng đó bằng bộ đếm `reads()` phải bằng 0.

| Mutant | Ca đóng nó | Dòng đỏ |
|---|---|---|
| `M1` gộp "chưa báo cáo" vào "đã báo cáo rỗng" | 3 ca INV-DIAG-1 | 3 đỏ — đúng falsifier |
| `M2` gắn `problems: []` vào mốc "chưa báo cáo" | ca URI chưa publish + ca toàn project | 2 đỏ |
| `M3` phạm vi project chỉ lấy khoá cache | ca toàn project | 1 đỏ |
| `M4` phạm vi project bỏ URI ngoài danh sách tệp | ca toàn project | 1 đỏ |
| `M5` bỏ bước kiểm tra readiness | ca INV-TOOL-4 | 1 đỏ |
| `M6` bỏ ranh giới `fromLspRange` | ca toạ độ 1-based | 1 đỏ |

Suite: đỏ 3/6 trên bản đầu hiện thân falsifier, xanh 6/6 sau khi sửa, `diff` với bản pristine rỗng
sau khi hoàn nguyên mutant. `npm test` 117/117 xanh; `npm run test:integration` 181/181 xanh — lần
chạy trước đó 5 ca `feat-001` đỏ vì suite unit đang đỏ tạm thời do maker song song đang sửa
`src/tools/hover.ts`, chạy lại sau khi họ xanh thì sạch.

---

## 2026-08-24 — `feat-tool-layer-core` lượt 2 (sửa sau REJECT), attempts 2/3

Ba điểm chặn của checker đều là lỗi thật trong mã sản xuất, không phải chỉ thiếu ca kiểm thử.

**R1 — rò handle ở `#evict` (nghiêm trọng nhất).** `#evict` chạy `#runDetachments(victim)` trước
`await victim.started`. Mảng `detachments` chỉ đầy đủ SAU khi `#startWorkspace` chạy xong, nên một
evict rơi vào giữa cold start gỡ trên một mảng còn rỗng. `close()` evict MỌI entry, kể cả entry
đang ở trạng thái "starting", nên đây là đường đi thường ngày của một SIGTERM tới daemon trong
khoảng ~2,3 giây cold start — không phải trường hợp biên. Hậu quả đo được: `attachFileSync` giữ một
handle `fs.watch` không bao giờ đóng, tiến trình node không thoát sau `pool.close()`.

Sửa: `#evict` chờ `victim.started` settle (thành công hay thất bại) trước, rồi mới gỡ, rồi mới
`stop()`. Ý định cũ được giữ nguyên — detach vẫn chạy TRƯỚC khi giết tiến trình.

**Vì sao sáu mutant M1–M6 của lượt 1 không thấy lỗi này:** mọi ca đều `await pool.acquire()` xong
rồi mới đóng, nên trạng thái "starting" chưa từng có ca nào bước vào. Ca mới dựng hai chốt chặn
quanh spawn seam để biến cửa sổ đó thành một sự kiện xác định, và dùng `attachFileSync` thật để
handle `fs.watch` trở thành đại lượng quan sát được.

**R2 — ranh giới chuyển đổi toạ độ thứ ba.** `shapeHover` tự cộng `POSITION_BASE` trong template
string dựng `HoverAnswer.reason`. Một toạ độ đi ra ngoài dưới dạng văn xuôi vẫn là một toạ độ; ca cũ
chỉ đòi `reason.length > 0` nên mutant 0-based sống sót. Nay `reason` đi qua `fromLspPosition`.

**R3 — nhánh cleanup lỗi trong `#startWorkspace`.** Ca mới dựng ba attachment, cái thứ hai ném lỗi,
và đòi đủ năm điều: acquire reject đúng thông điệp gốc, attachment thứ ba không chạy, detach của
attachment thứ nhất đã chạy, `stop()` đã chạy, và start hỏng không được cache.

| Mutant | Ca đóng nó | Dòng đỏ |
|---|---|---|
| `R1-revert` gỡ trước khi start xong | ca `close()` giữa spawn | 1 đỏ, đúng ca đó |
| `C1` reason theo hệ 0-based | ca toạ độ trong `reason` | 1 đỏ |
| `C3` `splitLines` chỉ theo `\n` | ca CRLF/CR | 1 đỏ |
| `C4f`/`C4b` ép `width = 1` | ca định danh chứa chữ cái astral | mỗi cái 1 đỏ |
| `C8` bỏ khối dọn dẹp trong `catch` | ca attachment ném lỗi | 1 đỏ |
| `C8b` nuốt hẳn lỗi attachment | ca attachment ném lỗi | 1 đỏ |
| `C10` bỏ `.reverse()` | ca thứ tự gỡ ngược | 1 đỏ |
| `M5`/`M6` (dựng lại) | ca cũ | 1 và 4 đỏ — ca cũ không bị cùn đi |

**Một lỗi thật lộ ra nhờ ca C4:** quét ngược trong `tokenBoundsAt` dùng `codePointAt(start - 1)`,
mà ở đúng một cặp surrogate vị trí đó là nửa sau chứ không phải cả cặp. Token vì thế dừng sớm ngay
trước một chữ cái astral-plane. Bề rộng nay suy từ dải trail surrogate. Fixture cũ chỉ có emoji —
không phải identifier part — nên hai nhánh `width` không bao giờ phân biệt được.

`C11` được xác nhận là mutant tương đương; chú thích trong `diagnosticsAttachment`, câu ở đầu spec
và tên ca thứ ba đã hạ cấp xuống đúng thứ đã chứng minh: cả hai việc phải chạy, thứ tự thì chưa.

`npx tsc --noEmit` theo đúng `tsconfig.json` của dự án (có `noUncheckedIndexedAccess`) nay sạch cho
cả hai tệp src. Suite: `npm test` 123/123, `npm run test:integration` 187/187. Bốn tính năng phụ
thuộc chạy riêng từng tệp: 42/42 xanh, không chữ ký export nào đổi.

## 2026-08-25 — `feat-prove-diagnostics`: lượt xác nhận lại, môi trường đã phục hồi (maker, attempt 3/3)

Lượt cuối trong ngân sách thử lại, và nó **không sửa một dòng mã nào**. Attempt 2 đã kết luận
implementation xanh nhưng baseline đỏ vì `EMFILE` từ `fs.watch()` ở ngoài phạm vi repo; lượt này chỉ
đo lại xem hạn ngạch theo dõi thư mục của host còn cạn hay không.

| Phép đo | Lệnh | Kết quả |
|---|---|---|
| Chẩn đoán EMFILE | tiến trình Node độc lập, `fs.watch()` thư mục temp trống + thư mục repo + 200 thư mục con mới | không còn `EMFILE`, cả 202 lần theo dõi đều thành công |
| Oracle của tính năng | `npm run test:integration -- test/integration/diagnostics.integration.spec.ts` | 3/3 pass, 0 fail, 0 cancelled, 10,64 s |
| Baseline đầy đủ | `./harness/init.sh` | 124/124 pass, in `=== Baseline green ===` |

Chẩn đoán của attempt 2 được xác nhận là đúng. Nguyên nhân gốc là hạn ngạch theo dõi thư mục của
macOS bị cạn tạm thời khi nhiều tiến trình test chạy song song, không phải khiếm khuyết trong
`DiskFileSyncWatcher` hay trong thay đổi canonical-URI của `DiagnosticsCache`. Hạn ngạch tự giải
phóng sau khi các tiến trình đó kết thúc, nên không có thay đổi mã nào cần thực hiện.

`attempts` lên 3/3, `readyForCheck` thành `true`, `status` giữ `in-progress` — quyền đặt `done`
thuộc checker.
