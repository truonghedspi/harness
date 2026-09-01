# Context contract giữa orchestrator và worker agent

Ngày nghiên cứu: 2026-09-01. Phạm vi: so sánh bốn hệ thống bên ngoài (Claude Code, Codex,
Augment/Pi, DeepSeek Harness) với ba kênh context hiện tại của harness này, nhằm thiết kế contract
truyền context hiệu quả từ orchestrator đến worker.

## Phát hiện chính

Bốn hệ thống giải bài toán context chuyển giao theo bốn trục khác nhau, nhưng hội tụ tại ba nguyên
tắc: **cách ly context window**, **nạp theo cầu thay vì nạp toàn bộ**, và **handoff có cấu trúc
thay vì prose tự do**.

Harness này có kênh context phong phú (resources, context packet, shared memory) nhưng dispatch
message — mối nối duy nhất giữa orchestrator và worker — chỉ truyền một câu prose. Đó là điểm thắt
cổ chai cần sửa.

---

## 1. Bốn hệ thống bên ngoài

### 1.1 Claude Code — cách ly context window + subagent contract

**Kiến trúc context:**

| Tầng | Nội dung | Khi nào nạp |
|---|---|---|
| CLAUDE.md hierarchy | Global → project → thư mục | Mỗi session khởi tạo |
| Skills | `name + description` hiển thị ban đầu; `SKILL.md` đầy đủ nạp khi dùng | Theo cầu |
| Subagent prompt | System prompt riêng + task message từ parent | Khi spawn |
| Compaction | Tự động tóm tắt khi context gần đầy; giữ code và quyết định | Liên tục |

**Subagent context contract (YAML frontmatter):**

```yaml
name: code-reviewer
tools: Read, Grep, Glob        # allowlist công cụ
model: opus                     # model riêng
skills: [api-conventions]       # nạp trước
isolation: worktree             # cách ly filesystem
maxTurns: 10                    # giới hạn vòng
memory: project                 # phạm vi nhớ
```

**Điểm mạnh:**
- Subagent nhận CLAUDE.md đầy đủ, nhưng **không nhận lịch sử hội thoại** của parent.
- Parent chỉ nhận tóm tắt cuối cùng, không nhận file trung gian mà subagent đã đọc.
- `isolation: worktree` cấp bản sao Git riêng — worker không thể phá filesystem chung.
- `SendMessage` cho phép nối tiếp công việc qua agent ID mà không mất context trước đó.

**Điểm yếu:**
- Task message từ parent là prose tự do — không có schema bắt buộc.
- Không có cơ chế truyền trạng thái có cấu trúc (checker feedback, diagnosis) qua biên subagent.
- Progressive disclosure chỉ hoạt động ở tầng skill; context packet không tồn tại.

**Bài học cho harness:** Cách ly context window hiệu quả. Mỗi worker bắt đầu sạch với đúng tài
nguyên mình cần (qua YAML frontmatter). Nhưng task message vẫn là prose — giống `run-loop.mjs` của
harness này.

### 1.2 Codex — repo là nguồn sự thật + progressive skill loading

**Kiến trúc context:**

| Tầng | Nội dung | Khi nào nạp |
|---|---|---|
| AGENTS.md hierarchy | `~/.codex/AGENTS.md` → Git root → thư mục hiện tại; gộp từ root xuống | Đầu session |
| Skills | `name + description` (≤ 2% context window); `SKILL.md` đầy đủ khi chọn | Theo cầu |
| Worktree | Bản sao Git riêng; worktree mới cho mỗi task song song | Khi spawn |
| Session JSON | Log phiên lưu local; resume bằng session ID | Khi resume |

**Progressive disclosure cụ thể:**
1. Hệ thống nạp tên + mô tả của mọi skill (≤ 8.000 ký tự tổng cộng).
2. Khi context budget hẹp: rút gọn mô tả trước, bỏ skill có cảnh báo sau.
3. `SKILL.md` đầy đủ chỉ nạp khi agent quyết định dùng skill đó.

**Subagent contract:**
- Worker nhận context window riêng, system prompt riêng, model riêng.
- Worker hoạt động trong worktree cách ly — filesystem tách biệt hoàn toàn.
- Kết quả trả về là tóm tắt, không phải output thô.

**Điểm mạnh:**
- AGENTS.md là trang thư mục, không phải tài liệu hướng dẫn — ngắn và dẫn đến file chi tiết.
- `project_doc_max_bytes` (32 KiB) ngăn AGENTS.md phình.
- Worktree đảm bảo worker song song không xung đột filesystem.
- Skill loading hai bước tiết kiệm context budget đáng kể.

**Điểm yếu:**
- Không có dispatch brief có cấu trúc — delegation vẫn qua prose.
- Không có cơ chế truyền trạng thái feature (checker notes, baseline, diagnosis) đến worker.
- Handoff giữa session dùng Git commit là ranh giới — không có typed handoff.

**Bài học cho harness:** Progressive disclosure cho skill/tài liệu rất hiệu quả. AGENTS.md ngắn
chỉ dẫn đường, chi tiết nạp theo cầu. Worktree cách ly filesystem tốt hơn `guard-write.mjs` ở
mức OS.

### 1.3 Augment / Pi — Expert + Worker + Context Engine MCP

**Kiến trúc context:**

| Tầng | Nội dung | Khi nào nạp |
|---|---|---|
| Expert config | System prompt + workers + model + integrations | Khi session khởi tạo |
| Skills | agentskills.io spec; nạp khi agent chọn | Theo cầu |
| Context Engine MCP | Truy vấn codebase qua Model Context Protocol | Theo cầu, mỗi tool call |
| Workers / Subagents | Worker = Expert riêng (VM, environment, context window); Subagent = lightweight | Khi delegate |

**Phân tầng Worker vs Subagent:**

| Thuộc tính | Worker | Subagent |
|---|---|---|
| Context window | Riêng | Dùng chung (trong cùng workflow) |
| Environment | VM riêng | Cùng VM |
| System prompt | Riêng (Expert config) | Không có Expert config |
| Chi phí | Cao (khởi tạo VM) | Thấp |
| Phù hợp | Task nặng, cần cách ly | Khám phá, phân tích nhẹ |

**Context Engine MCP:**
- Agent gọi tool để truy vấn codebase thay vì nạp hết file vào prompt.
- Context nạp theo cầu (mỗi MCP tool call), không nạp trước.
- Codebase được đánh index sẵn — truy vấn nhanh hơn grep toàn bộ.

**Điểm mạnh:**
- Context Engine MCP giải bài toán "worker cần hiểu codebase" mà không đổ cả repo vào context.
- Worker có VM riêng — cách ly mạnh nhất trong bốn hệ thống.
- Expert-to-Expert delegation qua integration surface — ranh giới sạch.

**Điểm yếu:**
- Tài liệu không mô tả dispatch message có cấu trúc — delegation qua prose.
- Không có typed handoff giữa parent và worker.
- "Clean handoff boundaries" là nguyên tắc thiết kế, không có schema bắt buộc.

**Bài học cho harness:** Context Engine (truy vấn theo cầu qua MCP) là giải pháp cho bài toán
"nạp toàn bộ hay nạp gì." Phân tầng worker (nặng) vs subagent (nhẹ) theo chi phí là mô hình tốt.

### 1.4 DeepSeek Harness — typed handoff + immutable objective

**Kiến trúc context:**

| Tầng | Nội dung | Khi nào nạp |
|---|---|---|
| Session event log | Append-only, typed events; replay và resume | Liên tục |
| Workspace rules | AGENTS.md/CLAUDE.md theo filesystem scope; typed `{action, scope, path, digest}` | Mỗi structured fs op |
| Ralph handoff | Một structured report duy nhất từ child trước | Mỗi round |

**Ralph structured handoff — contract chặt nhất trong bốn hệ thống:**

```json
{
  "status": "continue | complete | blocked",
  "summary": "non-empty string",
  "evidence": ["string"],
  "nextSteps": ["string"],
  "blocker": "string"
}
```

Bất biến theo status:
- `continue`: phải có nextSteps, không có blocker.
- `complete`: phải có evidence, không có nextSteps.
- `blocked`: phải có blocker cụ thể.

**Quy tắc truyền context:**
- Objective bất biến — worker không đổi được mục tiêu.
- Child không nhận lịch sử hội thoại của parent hay child trước.
- Chỉ structured report của round trước được truyền — không phải prose.
- Schema validate tại workflow **và** tại consumer boundary (defensive decoder).
- Kích thước bị giới hạn — handoff không thể phình.

**Điểm mạnh:**
- Typed handoff loại bỏ context drift và handoff bị lỗi cấu trúc.
- Immutable objective ngăn worker thay đổi scope giữa chừng.
- Validate hai lần (workflow + consumer) đảm bảo dữ liệu đúng cấu trúc.
- Workspace là bộ nhớ dài hạn — file trên disk là nguồn sự thật, không phải hội thoại.

**Điểm yếu:**
- Ralph không có evaluator độc lập — `complete` là tự báo cáo.
- Không có cơ chế truyền context giàu (checker notes, baseline state, diagnosis).
- Chỉ truyền report trước — không truyền nguyên nhân gốc hoặc lịch sử thất bại.

**Bài học cho harness:** Typed handoff schema-validated là cách đúng đắn nhất để chuyển context
giữa các agent. Bất biến theo status ngăn handoff không nhất quán. Validate hai lần ngăn dữ liệu
lỗi cấu trúc đi qua biên.

---

## 2. Harness hiện tại — ba kênh và điểm thắt

### Kênh 1: Resources (agent-context.mjs)

`SubagentStart` hook đọc `agents.manifest.json`, nạp file vào `additionalContext`. Worker nhận
AGENTS.md, constraints, testing standards, feature digest, v.v. **Ưu:** đọc tại spawn (luôn cập
nhật), báo file thiếu. **Khuyết:** danh sách tĩnh theo vai trò — không biết iteration hiện tại đang
ở đâu.

### Kênh 2: Context packet (context-packets.md)

Feature-planner tạo `feature-context-packet/1` cho feature có seam không hiển nhiên. Packet chứa
objective, mustRead, facts, mustNotRead, sourceInputs (kèm sha256). **Ưu:** giảm re-exploration
đáng kể (Aeron A/B: packet arm = packet + 2 mustRead; rediscovery arm = 11 file + searches).
**Khuyết:** chỉ feature-planner tạo; chỉ cho feature mới; không mang checker feedback hay diagnosis.

### Kênh 3: Dispatch message (run-loop.mjs dòng 216)

```js
`You are running HEADLESS... The router selected you because: ${next.why}.
 Run exactly one iteration per your instructions and loop/goal.md.
 Honor every stop condition.`
```

**Đây là điểm thắt cổ chai.** Orchestrator biết: feature entry, checkerNotes, diagnosis record,
baseline state, dependencies, session history, shared memory. Nhưng `run-loop.mjs` chỉ truyền
`next.why` — một câu prose từ router.

Worker phải tự đọc `feature_list.json`, tự tìm checker notes, tự kiểm tra baseline. Đó là
re-exploration mà context packet đã chứng minh tốn 11 file + searches.

---

## 3. Ma trận so sánh

| Khía cạnh | Claude Code | Codex | Augment/Pi | DeepSeek | Harness hiện tại |
|---|---|---|---|---|---|
| **Cách ly context window** | Subagent riêng | Worktree + session riêng | Worker = VM riêng | Child mới mỗi round | Subagent riêng (qua Claude runtime) |
| **Dispatch message** | Prose tự do | Prose tự do | Prose tự do | Structured report (schema-validated) | Prose 1 câu |
| **Resources tĩnh** | CLAUDE.md + YAML frontmatter | AGENTS.md hierarchy | Expert config | Workspace rules (typed) | agent-context.mjs từ manifest |
| **Context theo cầu** | Skills (progressive disclosure) | Skills (2-bước) | Context Engine MCP | Không | Context packet (feature-planner tạo) |
| **Trạng thái feature** | Không truyền | Không truyền | Không truyền | Ralph report (round trước) | Không truyền |
| **Schema bắt buộc** | Không | Không | Không | Có (validate 2 lần) | Có cho context packet; không cho dispatch |
| **Kích thước giới hạn** | maxTurns | project_doc_max_bytes | Không rõ | Size-bounded handoff | context-budget.mjs cho resources |

---

## 4. Thiết kế đề xuất: Dispatch Brief

### Nguyên tắc thiết kế (tổng hợp từ 4 hệ thống)

1. **Typed handoff, không prose** (DeepSeek Ralph). Dispatch message phải là JSON schema-validated,
   không phải câu văn tự do. Prose là rendering; data là nguồn sự thật.

2. **Progressive disclosure** (Codex Skills, Claude Code Skills). Truyền tóm tắt nhỏ + con trỏ đến
   file chi tiết. Worker nạp chi tiết theo cầu. Không đổ mọi thứ vào dispatch.

3. **Bất biến theo status** (DeepSeek Ralph). Mỗi trường có quy tắc tồn tại phụ thuộc trạng thái.
   Ví dụ: `diagnosis` chỉ xuất hiện khi `checkerNotes` bắt đầu `NEEDS`.

4. **Validate hai lần** (DeepSeek Ralph). Schema validate tại dispatch (nơi tạo) **và** tại worker
   (nơi tiêu thụ). Dữ liệu lỗi cấu trúc không đi qua biên.

5. **Kích thước giới hạn** (DeepSeek Ralph, Codex `project_doc_max_bytes`). Dispatch brief có byte
   budget. Vượt quá → cắt bớt phần ít quan trọng, giữ nguyên phần bắt buộc.

### Schema `dispatch-brief/1`

```json
{
  "schema": "dispatch-brief/1",
  "node": "maker",
  "why": "feature f-03 ready, no blocker",
  "feature": {
    "id": "f-03",
    "title": "Thêm baseline cache",
    "status": "open",
    "verification": "node init.mjs && grep 'cache hit' ...",
    "falsifier": "tests/baseline-cache.test.mjs",
    "dependencies": ["f-01"]
  },
  "checkerNotes": null,
  "diagnosis": null,
  "baseline": {
    "status": "green",
    "lastRun": "2026-09-01T10:00:00Z"
  },
  "recentChanges": [
    "5356819 Thêm baseline cache dùng lại verdict xanh giữa các phiên"
  ],
  "mustRead": [
    "docs/architecture.md",
    "tools/baseline-cache.mjs"
  ],
  "mustNotRead": [],
  "sessionContext": "Phiên trước hoàn thành f-01, f-02. Maker đang triển khai f-03 lần 2."
}
```

### Bất biến theo trường

| Trường | Khi nào có | Khi nào null |
|---|---|---|
| `feature` | Luôn có khi node là maker/checker/test-designer | Node là harness-setup |
| `checkerNotes` | Feature đã qua ≥ 1 checker pass | Chưa bao giờ qua checker |
| `diagnosis` | `checkerNotes` bắt đầu `NEEDS DESIGN:` hoặc `NEEDS RE-PLAN:` | Không có marker |
| `baseline` | Luôn có | Không bao giờ null |
| `recentChanges` | Luôn có (≤ 5 commit gần nhất) | Không bao giờ null |
| `mustRead` | Feature có context packet hoặc seam không hiển nhiên | Feature đơn giản |
| `sessionContext` | Handoff file tồn tại và không stale | Handoff trống hoặc stale |

### Validate hai lần

```
run-loop.mjs                         worker (maker/checker)
     │                                     │
     ├─ buildBrief(next, features)         │
     ├─ validateBrief(brief, schema) ──→ FAIL → throw, không dispatch
     ├─ dispatch(agent, brief)             │
     │                                     ├─ JSON.parse(message)
     │                                     ├─ validateBrief(brief, schema) ──→ FAIL → report, dừng
     │                                     ├─ dùng brief.feature, brief.checkerNotes...
```

### Byte budget

| Phần | Giới hạn | Khi vượt |
|---|---|---|
| Toàn bộ brief | 8 KiB | Cắt `recentChanges`, rồi `sessionContext` |
| `checkerNotes` | 2 KiB | Giữ marker + 3 câu đầu |
| `diagnosis` | 1 KiB | Giữ nguyên nhân gốc + hành động đề xuất |
| `mustRead` | 5 path | Ưu tiên falsifier và file thay đổi gần nhất |

---

## 5. So sánh trước/sau

### Hiện tại (không có dispatch brief)

```
orchestrator → run-loop.mjs → dispatch("maker", "You are running HEADLESS...
  The router selected you because: feature f-03 ready, no blocker.")
                                        │
                                        ▼
                              maker phải tự:
                              1. Đọc feature_list.json         (token tốn)
                              2. Tìm feature f-03              (đọc file)
                              3. Kiểm tra checker notes        (đọc file)
                              4. Kiểm tra baseline             (chạy lệnh)
                              5. Đọc session-handoff.md        (đọc file)
                              6. Tìm file liên quan            (grep, glob)
                              = re-exploration ~11 file + searches
```

### Đề xuất (có dispatch brief)

```
orchestrator → run-loop.mjs → buildBrief(next, features) → validateBrief()
  → dispatch("maker", JSON.stringify(brief))
                                        │
                                        ▼
                              maker nhận brief:
                              1. Parse brief                   (0 file)
                              2. Đọc brief.mustRead            (2 file)
                              3. Bắt đầu triển khai           (0 re-exploration)
                              = brief + 2 mustRead
```

Kết quả dự kiến tương đương Aeron A/B trong context-packets.md: giảm từ ~11 file + searches xuống
brief + 2 mustRead. Tiết kiệm ~5.000-15.000 token mỗi dispatch.

---

## 6. Kế hoạch triển khai

### Bước 1 — Schema và builder (thay đổi nhỏ, rủi ro thấp)

Tạo `tools/dispatch-brief.mjs`:
- `buildBrief(routerOutput, features, options)` → JSON object.
- `validateBrief(brief)` → throw nếu lỗi schema.
- Đọc `feature_list.json`, `session-handoff.md`, `git log`, baseline state.
- Kết quả là JSON, không phải prose.

### Bước 2 — Tích hợp run-loop.mjs (thay đổi vừa, rủi ro vừa)

Thay `headless` string bằng `JSON.stringify(brief)` trong `dispatch()`.
Giữ fallback: nếu `buildBrief` thất bại → dùng headless string cũ + cảnh báo.

### Bước 3 — Worker nhận brief (thay đổi vừa, rủi ro vừa)

Cập nhật `maker-prompt.md` và `checker-prompt.md`:
- Bước 0 mới: parse dispatch brief, validate schema.
- Nếu brief hợp lệ: dùng `brief.feature`, bỏ qua bước "đọc feature_list.json".
- Nếu brief thiếu hoặc lỗi: fallback về flow hiện tại (tự đọc).

### Bước 4 — Đo lường (thay đổi nhỏ, rủi ro thấp)

Thêm metric vào `read-telemetry.mjs`:
- Token tiêu thụ trước bước triển khai đầu tiên (brief arm vs no-brief arm).
- Số file đọc trước bước triển khai đầu tiên.
- So sánh A/B qua ≥ 5 feature.

---

## 7. Mối quan hệ với context packet hiện tại

Dispatch brief **không thay thế** context packet. Hai cơ chế bổ sung nhau:

| Khía cạnh | Dispatch brief | Context packet |
|---|---|---|
| Ai tạo | `run-loop.mjs` (tự động, mỗi dispatch) | Feature-planner (thủ công, một lần) |
| Nội dung | Trạng thái iteration: feature entry, checker notes, baseline, commits | Kiến thức domain: objective, facts, mustRead, seam |
| Thời điểm | Mỗi dispatch | Khi feature có seam không hiển nhiên |
| Kích thước | ≤ 8 KiB | Không giới hạn cứng (nhưng có sha256 validate) |

Worker nhận cả hai: brief từ dispatch message, packet từ `agent-context.mjs`. Brief cho biết "bạn
đang ở đâu trong iteration." Packet cho biết "domain knowledge bạn cần."
