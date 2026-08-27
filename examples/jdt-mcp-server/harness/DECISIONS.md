# Decisions Log — JDT MCP Server

The *why* behind choices (Lesson 5). Rationale is the most expensive thing to rebuild across
sessions — record it here so a future session (human or agent) doesn't relitigate settled calls
or repeat a rejected approach. One entry per decision. Newest first.

---

## 2026-08-26 — Human override: project WIP is 4; verification may follow implementation

- **Decision:** the human explicitly set the project work-in-progress limit to four concurrent
  features and authorized implementation to proceed before the deferred verification pass.
- **Boundary:** this changes scheduling, not truth. Each feature keeps independent state, attempt
  history, scope, and evidence; no unverified feature may become `passing` or `done`, and only the
  checker may approve `done` after the recorded command runs.
- **Planner effect:** decomposition may leave up to four independent eligible claims available. It
  does not merge them, erase their DAG edges, or manufacture evidence to make deferred tests look
  complete.
- **Ownership note:** generated runtime instructions still describe the default WIP=1 policy. This
  receipt records the project-specific human override without hand-editing generated workflow files
  from the feature-planner role.

---

## 2026-08-26 — Cache-side URI canonicalization stays as unmeasured defensive redundancy

- **Source:** the approved `feat-prove-diagnostics-identity` checker follow-up. Mutant m3b removed
  only `canonicalFileUri(report.uri)` and survived the feature's 3 integration cases plus the 19
  diagnostics unit cases.
- **Decision:** choose option (a). The load-bearing canonicalization is the `projectFiles()` side of
  `projectUris()`. Canonicalizing `DiagnosticsReader.list()` output is defensive normalization at a
  structural port: the current `DiagnosticsCache` already canonicalizes on `absorb()`, so no
  present oracle measures that second call.
- **Why no feature:** this is neither a product defect nor an independently demonstrable behavior.
  Cutting a test-only feature for an intentionally defensive branch would overstate the current
  contract and violate the lower size bound in `cutting-rules.md`.
- **Rejected alternative:** inject a fake reader returning a noncanonical URI. That would promote a
  permissive structural-port possibility into required behavior without a design invariant or a
  real second reader implementation demanding it.
- **Effect:** preserve the approved feature, evidence, attempts, and status. The implementation
  comment should describe the second call as unmeasured defensive redundancy, not claim both sides
  are required to prevent duplicate physical-file results.

---

## 2026-08-25 — Gỡ chặn `feat-prove-navigation-tools`: điều kiện thoát trong chính ghi chú chặn đã thoả

- **Nguồn:** router dừng ở `human` với bốn tính năng mở nhưng không tính năng nào định tuyến được.
- **Quyết định:** `blocked` → `not-started`, `attempts` giữ nguyên 0/3, không đổi `behavior`,
  `falsifier`, `verification`, `conditions` hay `dependencies`. Ghi chú chặn cũ giữ nguyên bên dưới
  dòng `GỠ CHẶN 2026-08-25` để lưu vết.
- **Nguyên nhân:** ghi chú chặn nêu điều kiện thoát nguyên văn — "implement and specify the four
  dependencies first". Cả bốn (`feat-tool-hover`, `feat-tool-definition`, `feat-tool-references`,
  `feat-tool-layer-core`) nay đều `done` và đã qua checker, nên `java_hover`/`java_definition`/
  `java_references` cùng mcp-tool-layer và per-workspace pool đã là giao diện gọi được thật.
- **Tiền lệ:** cùng dạng với `feat-prove-pool-crash-handling` (2026-08-22) và
  `feat-prove-daemon-lifecycle` — một ghi chú chặn tự nêu điều kiện thoát thì việc kiểm tra điều
  kiện đó là công việc của người lập kế hoạch, không phải của một lượt maker.
- **Ảnh hưởng:** tính năng trở lại hàng đợi của test-implementer; không đổi mã sản phẩm, không đổi
  test, không đổi tính năng nào khác.

---

## 2026-08-25 — INV-DIAG-3 mất sức phân biệt: cắt `feat-prove-diagnostics-identity`, giữ `feat-prove-diagnostics` `blocked`

- **Nguồn:** verdict REJECT của `feat-prove-diagnostics` (checker, 2026-08-25) với hai phát hiện
  độc lập. Tính năng đó giữ nguyên `blocked`, `attempts` 3/3, evidence và checkerNotes không bị đụng
  — mục này là lý do chặn được ghi nhận, nên `verify-harness` không coi là `blocked-unjustified`.
- **Quyết định:** cắt MỘT tính năng `prove` mới `feat-prove-diagnostics-identity`, oracle nằm ở tệp
  MỚI `test/integration/diagnostics-identity.integration.spec.ts`, kèm quyền sửa có giới hạn cho
  phần quy chuẩn hoá URI trong `projectUris()`.
- **Nguyên nhân 1 — trục phân biệt của `TCON-DIAG-0003` sai từ fixture.** Fixture cấp hai đường dẫn
  TUYỆT ĐỐI khác nhau, trong khi khoá cache là (workspaceId, URI canonical); riêng URI đã đủ phân
  biệt nên `workspaceId` là thành phần khoá thừa. Hai mutant sống sót 3/3 xanh: m1 (Map phẳng khoá
  chỉ theo URI) và m2 (`get()` quét chéo mọi workspace khi trượt). Checker đã đo và bác bỏ giả
  thuyết tương đương: chính hai mutant đó làm 3 ca và 2 ca của `test/lsp/diagnostics-cache.spec.ts`
  đỏ. Trục đúng là hai `workspaceId` va vào CÙNG một khoá.
- **Nguyên nhân 2 — một lỗi thật chưa ca nào chạm.** `projectUris()` trong `src/tools/diagnostics.ts`
  hợp `facade.projectFiles()` (cách viết của người gọi) với `reader.list()` (đã canonical hoá) bằng
  `Set`; hai chuỗi khác ký tự cùng trỏ một tệp không bị khử trùng, nên một tệp vật lý xuất hiện hai
  mục giống hệt nhau trong phạm vi project.
- **Vì sao MỘT tính năng chứ không hai:** cùng một nguyên nhân gốc (identity của khoá cache), cùng
  một tệp oracle, và cùng một fixture lộ ra cả hai — một tệp Java thật dưới `<root>/real/...` cộng
  symlink thư mục `<root>/link -> <root>/real` cho hai cách viết URI, cùng một JDT LS thật cho
  đường notification. Tách đôi là trả tiền hai lượt dispatch cho một seam duy nhất, đúng điều
  `cutting-rules.md` gọi là chia nhỏ một hành vi không tách rời. Thứ tự oracle-trước vẫn được giữ:
  test-implementer viết ca trước, maker chỉ được sửa `src/` sau khi có lượt đỏ.
- **Phương án bị từ chối — sửa `TCON-DIAG-0003` tại chỗ trong tệp cũ.** Tệp đó thuộc
  `feat-prove-diagnostics` đã có evidence, mà router không đưa một tính năng `prove` có evidence về
  lại tầng oracle (memory `pre-authored-oracle-cannot-return-to-oracle-layer`). Giữ nguyên tệp cũ
  làm lưu vết còn rẻ hơn là sửa xuyên qua một tính năng đã hết ngân sách.
- **Phương án bị từ chối — fixture đắt với hai JDT LS thật cùng trỏ một tệp nguồn.** Nó phụ thuộc
  một tiền đề chưa có ai phát biểu: hai workspace sống đồng thời có bao giờ giữ cùng một URI
  canonical không. Đã ghi thành mục Human checkpoints trong `loop/goal.md` theo mục 7 của checker;
  trục rẻ không phụ thuộc câu trả lời đó vì nó phán xét khoá cache, không phán xét hai tiến trình.
- **Sửa kèm về DAG:** `feat-tool-completion` đổi phụ thuộc `feat-prove-diagnostics` →
  `feat-prove-diagnostics-identity`. Cạnh này là cổng thứ tự build của giai đoạn diagnostics
  (`DECISIONS/2026-08-20.md`); treo nó vào một tính năng đã hết ngân sách thì cả chuỗi bốn tính năng
  `feat-tool-*` không bao giờ chạy được nữa.
- **Ảnh hưởng:** 35 → 36 tính năng (19 build, 16 prove, 1 baseline); gói ngữ cảnh mới
  `loop/context-packets/feat-prove-diagnostics-identity.json`; kỳ 2026-08-23 của tệp này chuyển vào
  `harness/DECISIONS/2026-08-23.md` để giữ ngân sách 300 dòng. `check-plan.mjs` còn đúng một finding
  đã có ngoại lệ được chấp nhận (`context-touches` trên `feat-workspace-pool`).

---

## 2026-08-25 — `TCON-DIAG-0004`: `stateful` + `deterministic_replay`, không phải `integration`

- **Nguồn:** mục FOLLOW-UP trong verdict APPROVE của `feat-prove-evict-succession`. Tính năng giữ
  nguyên `done`; status, evidence và tệp oracle không bị đụng.
- **Quyết định:** ghi đè nguyên tử `TCON-DIAG-0004.json`: `behavior_shape` `integration` →
  `stateful`, `technique` `e2e_scenario` → `deterministic_replay`, `rationale` viết lại cho khớp.
  Planner tự sửa vì router không đưa một tính năng `prove` đã có evidence về lại tầng oracle được
  (memory `pre-authored-oracle-cannot-return-to-oracle-layer`).
- **Nguyên nhân:** oracle chạy trên spawner giả ở bộ unit, không phải hai thành phần thật.
  `strategy-matrix.md` cấm gán `integration` cho behavior kiểm chứng được ở mức unit với contract
  giả lập; mục D2 của `designer-checklist.md` cấm `concurrent` cho single-threaded event loop.
- **Sửa kèm:** `behavior` dài 505 ký tự, vượt giới hạn 500 của schema từ lượt trước; rút còn 491
  bằng cách thay `the predecessor's eviction cleanup` thành `its eviction cleanup`, không đổi nghĩa.
- **Ngoại lệ D3 được chấp nhận:** TP-DIAG-0001 nay có một condition `stateful` mà không có condition
  `property_kind: invariant` kèm theo. Không cắt thêm điều kiện: cửa sổ này chỉ dựng được bằng hai
  lời gọi acquire chồng lấn, mà một command sequence sinh tự động không bao giờ dựng được.
- **Không đụng `plan.json`:** schema đặt `additionalProperties: false`, không có field ghi chú;
  `spec_gaps` dành cho spec mơ hồ, đây không phải. Lý do nằm trong `rationale` của chính condition.
- **Ảnh hưởng:** không đổi `feature_list.json`, không đổi mã sản phẩm, không đổi test.

---

## 2026-08-25 — Mutant N1 của `#evict` KHÔNG tương đương: cắt `feat-prove-evict-succession`

- **Nguồn:** mục FOLLOW-UP trong verdict APPROVE của `feat-tool-layer-core`, request
  `follow-up:feat-tool-layer-core:bcf69f4971bf`. Tính năng giữ nguyên `done`; evidence và
  checkerNotes không bị đụng.
- **Quyết định:** cắt tính năng `prove` mới `feat-prove-evict-succession`, kèm quyền sửa có giới hạn
  cho đúng một khối chú thích trong `src/workspace/workspace-pool.ts`.
- **Không chọn phương án (b) của checker** (hạ cấp chú thích rồi bỏ ca): số đo cho thấy thứ tự trong
  `#evict` thật sự chịu lực, nên bỏ ca là chôn một khoảng trống có thật.
- **Nguyên nhân 1 — giả thuyết tương đương đã bị số đo bác bỏ.** Planner dựng lại mutant N1 trên bản
  sao `src/` ngoài cây nguồn (repo không bị đụng): cap 3, spawner giả, chỉ tiến trình đầu tiên của
  root A có `stop()` chậm. Bản gốc giữ diagnostics của kẻ kế nhiệm (`reported: true`); mutant N1 làm
  nó thành `false`.
- **Nguyên nhân 2 — `stop()` có điểm nhường thật.** `terminate()` gửi SIGTERM rồi `await exited`,
  leo thang SIGKILL sau `STOP_GRACE_MS` = 5 000 ms. Cửa sổ đó rộng hơn cold start ~2 300 ms, đủ cho
  một lần acquire lại cùng project root hoàn tất.
- **Nguyên nhân 3 — chú thích hiện tại nêu SAI mối nguy.** Câu ở dòng 328-329 nói một notification
  muộn không được rơi vào cache của workspace đang biến mất. Thứ đó bị chính `forget()` trong cùng
  hàm detach xoá ngay sau đó, nên nó không falsify được — đúng lý do N1 sống sót 28/28. Mối nguy
  thật là chiều ngược lại: `cache.forget(workspaceId)` muộn của kẻ tiền nhiệm xoá cache của kẻ kế
  nhiệm vừa tiếp quản cùng identity.
- **Vì sao identity bị dùng chung giữa hai thế hệ tiến trình:** `#identify` băm
  `sha256(canonicalRoot)`, độc lập với pid. `#evict` xoá entry khỏi `#entries` trước khi dọn dẹp,
  nên một `acquire` song song không thấy entry cũ và spawn tiến trình mới dưới đúng `workspaceId` đó.
- **Vì sao cần hai lời gọi acquire song song:** `#ensureCapacityFor` await TRỌN `#evict`, nên một
  chuỗi acquire đơn lẻ không bao giờ dựng được tình huống này. Cùng lý do `INV-POOL-5` tồn tại.
- **Phương án bị từ chối — ghi `context.note` vào `feat-tool-layer-core`.** Tính năng đã `done`, nên
  router không bao giờ đưa lại cho maker. Đây đúng bài học từ FOLLOW-UP `lsof` ngày 2026-08-23.
- **Phương án bị từ chối — gộp vào `feat-prove-diagnostics`.** Tính năng đó là oracle tích hợp chạy
  JDT LS thật, đang `in-progress` và bị chặn bởi một điều kiện môi trường (`EMFILE` của `fs.watch`).
  Nhét một ca đơn vị về thứ tự evict vào đó làm lệnh verification mang hai mức và khiến ca mới bị
  chặn bởi một vấn đề không liên quan.
- **Phương án bị từ chối — gộp vào `feat-prove-cross-process-integration`.** Tính năng đó `blocked`
  vì hai dependency chưa bắt đầu, và cửa sổ đua này chỉ tất định khi `stop()` được tiêm.
- **Phương án bị từ chối — feature-planner tự sửa chú thích ngay.** Câu chú thích đúng phụ thuộc vào
  thứ ca mới chứng minh, nên sửa trước là lại khẳng định một điều chưa ai đo.
- **Ràng buộc được thoả mãn:** `INV-DIAG-1` — đọc lại luôn trả về payload gần nhất; một tệp mà JDT LS
  đã báo cáo không được đọc ra thành "chưa báo cáo". Tệp oracle là tệp MỚI
  `test/workspace/workspace-succession.spec.ts`, nên `test/workspace/workspace-attachments.spec.ts`
  của một tính năng đã done vẫn bất khả xâm phạm.
- **Ảnh hưởng:** 34 → 35 tính năng (19 build, 15 prove; DAG vẫn sâu 15 mức tại
  `feat-prove-code-actions`, tính năng mới ở mức 7). `check-plan.mjs` còn đúng một finding đã có
  ngoại lệ được chấp nhận (`context-touches` trên `feat-workspace-pool`).
- **Còn mở, ngoài phạm vi lượt này:** chưa tệp nào trong `src/` gọi `createWorkspacePool` hay truyền
  `attachments`, tức composition root nối pool + cache + tầng tool vẫn chưa có tính năng nào sở hữu.

---

## Kho lưu trữ

Các kỳ đã đóng nằm trong `harness/DECISIONS/` — bắt đầu từ `harness/DECISIONS/INDEX.md`. Kỳ
2026-08-19 (lựa chọn kiến trúc, hoãn Gradle) đã chuyển sang `harness/DECISIONS/2026-08-19.md`
ngày 2026-08-22. Kỳ 2026-08-20 (lần cắt tính năng đầu tiên, thứ tự build, hai khoảng trống chưa
cắt) chuyển sang `harness/DECISIONS/2026-08-20.md` ngày 2026-08-23. Kỳ 2026-08-21 (năm lần nới
tính năng `prove` sẵn có thay vì cắt tính năng mới) chuyển sang `harness/DECISIONS/2026-08-21.md`
cùng ngày 2026-08-23. Kỳ 2026-08-22 (timeout thiếu ở hai spec tích hợp; ba việc tồn đọng từ
`feat-workspace-pool`) chuyển sang `harness/DECISIONS/2026-08-22.md` cùng ngày 2026-08-23. Kỳ
2026-08-23 (bốn quyết định FOLLOW-UP: `lsof`, listener `error` của `probeDaemon`, hàm gỡ đăng ký
của `attach()`, và lần cắt `feat-lsp-notifications`) chuyển sang `harness/DECISIONS/2026-08-23.md`
ngày 2026-08-25.

<!-- Mẫu cho mục mới: ## YYYY-MM-DD — Tiêu đề, rồi các gạch đầu dòng Quyết định / Nguyên nhân /
     Phương án bị từ chối / Ràng buộc được thoả mãn / Ảnh hưởng. -->
