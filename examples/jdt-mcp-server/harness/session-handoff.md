# Bàn giao phiên — `feat-prove-diagnostics` xanh riêng, baseline đỏ lặp lại vì EMFILE

## Stop condition 2026-08-24 — maker attempt 2/3

Human đóng VS Code rồi chạy lại repro hẹp lúc 10:14 ngày 2026-08-24; kết quả vẫn 1/1 đỏ `EMFILE`
trong 15,09 giây. Kiểm tra process sau đó không còn VS Code, Red Hat Java/JDT LS, JDT fixture hay
Node test nào sống. Vì vậy đóng VS Code không giải phóng trạng thái directory-watch của host; không
chạy feature verification/baseline và không tiêu attempt 3/3. Cần logout/restart host (hoặc một
thay đổi external-state tương đương) trước khi thử lại repro hẹp.

Maker lượt 1/3 đã sửa identity URI trong `src/lsp/diagnostics-cache.ts`: JDT LS publish URI
canonical `file:///private/var/...`, còn tool truy vấn alias `file:///var/...`. Verification chính
xanh 3/3 trong 10,6 giây. Feature giữ `status: in-progress`, `readyForCheck: false`.

Không được dispatch checker. Repro hẹp một ca vẫn đỏ `EMFILE` trong ~15,1 giây. Standalone Node
không nạp code repo cũng lỗi khi watch một directory rỗng mới tạo hoặc repo root; watch một file và
mở 300 descriptor thường đều xanh. Đây là host directory-watch capacity/runtime state, không phải
project-layer, nên không có sửa product/test hợp lệ. Chỉ chạy lại repro hẹp sau khi trạng thái host
thay đổi; feature verification và baseline chỉ chạy sau khi repro đó xanh.

## Checkpoint 2026-08-24

**Quyết định của human, 2026-08-24:** chọn phương án 1 — giao `feature-planner` xác minh blocker
đã hết hiệu lực, sửa `feat-prove-diagnostics` từ `blocked` sang `not-started`, cập nhật ghi chú và
để router tiếp tục. Nếu kiểm tra phát hiện blocker mới có thật, planner phải giữ trạng thái và ghi
rõ bằng chứng thay vì gỡ cờ máy móc.

`node harness/loop/route.mjs` trả về `human`: bốn feature tool còn mở nhưng mọi rule đều từ chối.
Nguyên nhân trực tiếp là `feat-prove-diagnostics` vẫn mang `status: blocked`, trong khi chính lệnh
`node harness/tools/feature.mjs feat-prove-diagnostics` báo ba dependency
`feat-diagnostics-cache`, `feat-tool-diagnostics`, `feat-lsp-notifications` đều `done`. Ghi chú block
vẫn mô tả hai dependency là `not-started`, nên điều kiện gỡ block của ghi chú đã được thoả nhưng
trạng thái chưa được cập nhật. Chuỗi phụ thuộc phía sau vì thế dừng ở
`feat-tool-completion` → `feat-prove-completion` → `feat-tool-rename` → code actions.

Baseline `node harness/init.mjs` xanh ngày 2026-08-24. `feature-planner` đã xác minh blocker stale,
đổi `feat-prove-diagnostics` từ `blocked` sang `not-started`, cập nhật context/checkerNotes và tái
sinh digest; không sửa product hay test. `git diff --check` sạch. Router hiện chọn
`test-implementer` cho `feat-prove-diagnostics`: oracle đã được đặc tả nhưng chưa được viết.

# Bàn giao trước đó — feature-planner chuyển ba mục FOLLOW-UP của `feat-workspace-pool` thành scope

## Kết luận

Ba mục tồn đọng trong verdict APPROVE của `feat-workspace-pool` được xử lý ở ba mức can thiệp khác
nhau: một ghi chú có kèm quyền sửa giới hạn, một tính năng mới, một ghi chú thuần tuý. Cộng thêm một
việc gỡ chặn. `feat-workspace-pool` không bị đụng: vẫn `done`, vẫn `attempts` 1/3, evidence nguyên
vẹn, `src/workspace/workspace-pool.ts` vẫn là sha256 `a72b2ed5…`.

Số liệu kế hoạch: 33 tính năng — 18 build, 14 prove, 1 baseline (`feat-001`, không gắn `kind`).
DAG không có chu trình, mọi phụ thuộc trỏ về một tính năng đứng trước trong mảng, và không build nào
thiếu một prove phán xử nó. Đường dài nhất 15 mức, kết thúc ở `feat-prove-code-actions`; chuỗi này
dài vì các tính năng tool được xâu chuỗi có chủ ý qua chính prove-feature của bước trước
(`feat-tool-completion` ← `feat-prove-diagnostics`, `feat-tool-rename` ← `feat-prove-completion`,
`feat-tool-code-actions` ← `feat-prove-rename`). Lượt này không thay đổi độ sâu:
`feat-prove-workspace-identity` nằm ở mức 4.

## Việc đã làm

1. **`TCON-POOL-0003` đỏ vì lỗi oracle — không tạo scope mới.**
   `feat-prove-pool-lifecycle` nay tự đủ điều kiện vì phụ thuộc đã `done`; nó không cần tái cắt.
   Cái nó cần là đừng bắt người nhận tiếp theo chẩn đoán lại. Đã ghi vào `checkerNotes` của chính
   tính năng, vào `context.note`, và vào gói ngữ cảnh mới
   `harness/loop/context-packets/feat-prove-pool-lifecycle.json`.
   Đúng một sửa đổi oracle được cho phép trước: thu hẹp khẳng định vắng-mặt-khỏi-`pool.status()` về
   tập workspace đã evict và chưa acquire lại. Khẳng định về sự tồn tại thư mục `-data` bị chốt là
   **không được đụng** — đó chính là falsifier của `INV-POOL-4`.
   Không cần một lượt test-designer: văn bản đã thẩm định của `TCON-POOL-0003` vốn đã chỉ ràng buộc
   trạng thái vắng mặt tại thời điểm evict, nên sửa lại là khôi phục sự trung thực của oracle so với
   điều kiện của nó, không phải thiết kế điều kiện mới.

2. **Đường nối identity `project-router` ↔ `workspace-pool` — tính năng mới.**
   `feat-prove-workspace-identity`, prove, phụ thuộc `feat-project-router` + `feat-workspace-pool`,
   oracle riêng `test/integration/workspace-identity.integration.spec.ts`, falsifier trích dẫn
   `INV-POOL-1` + `INV-ROUTE-3`, `maxAttempts` 2, `conditions` để rỗng cho lớp oracle điền.
   Không nới rộng `feat-prove-pool-lifecycle`: oracle đó chạy spawner giả và không gọi project-router,
   và quan trọng hơn — tính năng đó đã có `evidence` nên quy tắc test-implementer không khớp, claim
   nhét thêm sẽ đi thẳng tới maker mà không bao giờ có oracle.

3. **SIGTERM trước SIGKILL — chỉ ghi chú.**
   Ghi mutant còn sống vào `context.note` của `feat-prove-pool-crash-handling` và mở một human
   checkpoint trong `loop/goal.md`. Không invariant nào trong `docs/design/runtime-model.md` phát
   biểu thứ tự dừng êm; `INV-POOL-3` chỉ đòi request đang bay phải kết thúc bằng lỗi trong deadline,
   và mutant xoá `child.kill("SIGTERM")` không vi phạm điều đó. Chốt hành vi này cần một invariant
   mới, tức câu hỏi thiết kế, không phải falsifier do người lập kế hoạch tự nghĩ ra.

4. **Gỡ chặn `feat-prove-pool-crash-handling`** (`blocked` → `not-started`, `attempts` vẫn 0/3).
   Điều kiện thoát do chính ghi chú chặn nêu — "once feat-lsp-client and feat-workspace-pool are both
   done" — nay đã đủ. Nếu để `blocked`, quy tắc test-implementer loại nó vĩnh viễn và `INV-POOL-3`
   không bao giờ có oracle.

Lý do đầy đủ cho cả bốn mục: `harness/DECISIONS.md`, mục 2026-08-22.

## Kiểm tra đã chạy

- `node harness/skills/feature-planning/scripts/check-plan.mjs --target harness` — còn đúng một
  finding, `context-touches` trên `feat-workspace-pool` (4 đường dẫn, giới hạn 3). Ngoại lệ được chấp
  nhận có ghi lý do: tính năng đã `done` và đã duyệt, bốn đường dẫn phản ánh đúng phạm vi thực tế,
  cắt bớt chỉ để làm xanh bộ kiểm tra là làm sai hồ sơ. Ba finding `readyForCheck` thiếu (trên
  `feat-prove-routing`, `feat-lsp-client`, `feat-workspace-pool`) đã vá bằng `"readyForCheck": false`;
  mọi nơi tiêu thụ trường này đều so sánh `=== true` nên giá trị này tương đương trường vắng mặt.
- `node harness/tools/verify-harness.mjs --target . --skip-baseline` — 2 blocker và 3 warning, tất cả
  đều thuộc lớp harness/project và có từ trước lượt này (`check-coverage.mjs` không tìm thấy, hook
  telemetry, bảng agent trong router, AGENTS.md thiếu mục cách viết). Không có finding nào ở lớp
  tính năng.
- `node harness/tools/feature-digest.mjs --target harness` — đã tạo lại, 33 tính năng.
- `node harness/loop/route.mjs` — nút kế tiếp là **test-designer** cho `feat-prove-workspace-identity`.

## Router nên làm gì tiếp

1. **test-designer → `feat-prove-workspace-identity`.** `INV-POOL-1` chưa có điều kiện test nào, nên
   quy tắc test-designer khớp đúng như thiết kế. Đây là việc giết mutant còn sống, không phải hành vi
   mới: hai component hôm nay khớp nhau, nên lần chạy đỏ phải đến từ mutant được nêu tên trong
   `context.note` (đổi đầu vào hash hoặc kiểu mã hoá digest tại MỘT trong hai dòng
   `src/workspace/project-router.ts:47` / `src/workspace/workspace-pool.ts:171`), không phải từ một
   module chưa tồn tại. Điều kiện mới nên nằm trong một plan mới dưới
   `harness/tests/design/plans/`, không nhét vào `TP-POOL-0001` (plan đó có scope `INV-POOL-2/4`).
2. Sau đó **test-implementer** sẽ khớp `feat-prove-pool-crash-handling` — điều kiện
   `TCON-POOL-0004..0006` trong `TP-POOL-0002` đã sẵn sàng và cả hai phụ thuộc nay đều `done`, nên
   nguyên nhân của 19 lần dispatch hỏng trước đây không còn.
3. **maker → `feat-prove-pool-lifecycle`**, và maker phải đọc gói ngữ cảnh trước. Lưu ý: router đưa
   tính năng này cho maker chứ không cho lớp oracle, vì `evidence` không rỗng nên quy tắc
   test-implementer không khớp. Bằng chứng RED ngày 2026-08-20 đã cũ (nó có trước cả bản triển khai);
   cần một lần đỏ mới cho thấy `TCON-POOL-0003` hỏng ở khẳng định vắng mặt quá rộng, rồi mới tới lần
   xanh.

## Các luồng còn mở, không đổi trong lượt này

- **FOLLOW-UP mutant M12 của `feat-prove-routing` — router không còn nêu lại được.** Cả hai lượt
  dispatch `follow-up:feat-prove-routing:*` đã dùng hết nên `loop/route.mjs` sẽ im lặng vĩnh viễn về
  nó. Đã mở human checkpoint trong `loop/goal.md` và đánh dấu trong `progress.md` → Next, mục 3.
  Lượt này không tự chọn thay người dùng, vì một trong hai nhánh (chấp nhận rủi ro dưới `A-006`) là
  quyết định thuộc về con người, và mục này nằm ngoài phạm vi yêu cầu định tuyến của lượt.
- `feat-prove-provisioner` — vẫn blocked/timebox ở 3/3: bản replay 13 trường hợp vẫn thiếu điều kiện
  từ chối khi tải về hỏng checksum.
- `X-001`..`X-010` trong `docs/cross-cutting.md` vẫn mở; không tính năng nào trong lượt này đóng dòng
  nào.
- ~~`harness/DECISIONS.md` sắp vượt ngân sách 300 dòng~~ — đã xử lý ngày 2026-08-23: năm mục ngày
  2026-08-20 chuyển sang `harness/DECISIONS/2026-08-20.md` theo Pattern B, thêm một dòng vào
  `harness/DECISIONS/INDEX.md`, và hai trích dẫn theo ngày trong `loop/goal.md` cùng
  `docs/architecture.md` đã trỏ lại vào tệp lưu trữ. Tệp đang dùng còn 243 dòng.
`feat-prove-diagnostics` implementation is green, but host directory-watch capacity keeps baseline red.

Maker attempt 2/3 minimized the baseline failure with:
`node --experimental-strip-types --test --test-name-pattern='a create, a modify and a delete' test/workspace/file-sync-watcher.spec.ts`
which deterministically reports 1/1 `EMFILE` failure in about 15.1 seconds. A standalone Node process
with no repo imports reproduces `EMFILE` when watching a fresh empty directory or the repo directory.
Watching `package.json` succeeds, and opening 300 `/dev/null` descriptors succeeds. This rules out
ordinary process fd exhaustion and project code calling `watch()` repeatedly; the remaining blocker
is external host directory-watch quota/runtime state. Do not patch watcher production code or its
oracle to hide this. Retry the tight command after host watcher capacity changes; only after it is
green should the feature verification and `./harness/init.sh` be rerun. Feature stays `in-progress`,
`readyForCheck: false`, attempts 2/3. No commit was made.

## Stop condition 2026-08-28 — không dispatch được agent nào cho `feat-prove-sync`

Router leo thang `human`: "feat-prove-sync still has no feature-linked validated conditions after one
test-designer turn". Nhưng test-designer chưa hề chạy — bốn cơ chế dispatch đều hỏng trong phiên này:
native sub-agent (3 lần fail), kiro-cli (Not logged in), codex (logged in nhưng
`failed to initialize in-process app-server client: Operation not permitted`), claude (monthly spend
limit). `run-loop.mjs` vẫn ghi `route-log.jsonl` entry `test-design:feat-prove-sync:*` TRƯỚC khi
dispatch fail, nên router đếm đó là một lượt test-designer đã dùng → leo thang.

Hai vấn đề độc lập cần human quyết:
1. **Dispatch chết.** Không runtime nào hoạt động. Mọi tiến triển của loop đều kẹt, không riêng feature này.
2. **`feat-prove-sync` mang `status: blocked` (stale) + điều kiện đã tồn tại nhưng router báo "chưa
   feature-linked validated".** Ba dependency đều `done`. Plan `harness/tests/design/plans/TP-SYNC-0001`
   (TCON-SYNC-0001..0003, requirement_id INV-SYNC-1) đã có trên đĩa và do một test-designer trước đó
   thiết kế (xem `harness/memory/test-designer/inv-sync-1-vs-sync-2-boundary.md`), nhưng router vẫn nói
   "no complete feature-linked condition plan". Có thể là (a) thiếu một trường linkage/validation mà
   router đòi, hoặc (b) lỗi router. Chưa đọc `route.mjs` source theo đúng lệnh AGENTS.md, nên chưa
   kết luận được là khuyết thật hay lỗi harness.

Tiền lệ tương tự đã xử lý ngày 2026-08-24 cho `feat-prove-diagnostics`: human chọn phương án giao
`feature-planner` xác minh blocker stale rồi đổi `blocked` → `not-started`. Chưa áp dụng cho
`feat-prove-sync` vì chưa có cơ chế dispatch để chạy planner, và chưa có quyết định của human.
Baseline `node harness/init.mjs` vẫn xanh (124/124). Không commit gì; chỉ `loop/baseline-state.json`,
`loop/current.json`, `loop/route-log.jsonl` và `trace/trace.jsonl` đổi do lượt chạy thử.

## Tiếp nối 2026-08-28 — human chọn "tự implement", công việc đã xong

Human chọn phương án "tự đề xuất & hiện thực sync-guard ngay". Đã làm:

- `src/workspace/sync-guard.ts` (MỚI): `withSyncQuiescence()` + `ResyncingError` (code `resyncing`).
  Contract: chờ watcher settle rồi POLL cho tới khi `isStale(result) === false` (quá hạn →
  `ResyncingError`). Đây là thành phần INV-SYNC-1 mà runtime-model mô tả nhưng không build feature
  nào sở hữu.
- `test/integration/file-sync.integration.spec.ts` (MỚI): oracle tái hiện spike C qua
  `textDocument/definition` (workspace/symbol chỉ giải TYPE — đo bằng spike) trên pool thật + JDT LS
  thật + watcher thật. Control 2/2 xanh; mutant M1 (guard trả kết quả đầu không poll) làm
  TCON-SYNC-0001 đỏ.
- `test/workspace/sync-guard.spec.ts` (MỚI): 6 ca unit cho guard (quiescent/không quiescent, settle
  timeout, stale vĩnh viễn, deadline quá khứ).
- `harness/tests/design/plans/TP-SYNC-0001/`: thêm spec_gap ghi nhận workspace/symbol chỉ giải type;
  sửa TCON-SYNC-0001 behavior/rationale từ "readiness gate's semantic probe" → "sync-guarded tool call".
- `harness/feature_list.json`: `feat-prove-sync` `blocked` → `in-progress`, ghi 2 mục evidence +
  checkerNotes (scope note: sync-guard là component production mới, nên cân nhắc tách build feature
  riêng `feat-sync-guard`).

Còn lại cho phiên sau / khi dispatch hoạt động: checker review (chưa `readyForCheck` vì thiếu
`reviewPacket`), và chạy đủ `npm run test:integration`. `npm test` 130/130 xanh (124 + 6 sync-guard).

## Môi trường DSH: sandbox chặn `ps` — đừng chẩn đoán lại TCON-SHIM-0003

Sandbox workspace-write của DSH chặn lệnh `ps` (`spawnSync ps EPERM`). Hệ quả: bất kỳ test nào dùng
`ps` để đọc bảng tiến trình sẽ fail giả. Cụ thể `test/integration/daemon-lifecycle.integration.spec.ts`
TCON-SHIM-0003 [INV-SHIM-4]: `livePids()` dùng `ps -o pid= -p ...`, khi bị chặn nó rơi vào `catch` và
trả `[]`, làm khâu tiền đề "ba process con còn sống" đỏ. Đã xác nhận dứt điểm bằng hai cách: (1) tái
lập kịch bản shutdown bằng `kill(pid,0)` cho 3/3 con chết sau shutdown; (2) chạy lại test với
`sandbox_permissions: danger-full-access` cho 3/3 pass. Logic `daemon-supervisor.shutdown()` đúng —
KHÔNG sửa test sang `kill(pid,0)` vì `ps` chặt hơn (zombie hiện trong `kill(0)` nhưng không hiện trong
`ps`). Khi cần chạy suite đầy đủ và thấy xanh, chạy với `danger-full-access`.

## HOÀN TẤT 2026-08-28 — toàn bộ 12 tính năng còn lại đã checker-ready

Đã hoàn thiện 4 tool build + 4 oracle prove + 2 fix blocked-3/3 + end-to-end cross-process. Cả 12
feature `in-progress` + `readyForCheck: true` + `review-contract ADMITTED`; `npm test` 159/159, và
`npm run test:integration` (danger-full-access) 249/249 xanh. Chi tiết từng feature đã ghi trong
`feature_list.json` (evidence + checkerNotes + reviewPacket) và `progress.md`.

Còn lại DUY NHẤT: checker review để đặt `status: done` cho 12 feature — bị chặn vì dispatch hỏng
(native sub-agent fail, kiro chưa login, codex bị sandbox chặn app-server, claude hết quota). Khi
một runtime khả dụng, chỉ cần chạy checker cho các feature `readyForCheck: true` (review-contract đã
ADMITTED sẵn).
