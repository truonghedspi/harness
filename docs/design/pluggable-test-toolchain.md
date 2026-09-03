# Pluggable Test Toolchain — Thiết kế

## Vấn đề

Harness biết PHẢI kiểm tra gì (scope: unit/component/contract/journey, size: small/medium/large)
nhưng không biết BẰNG GÌ. Mỗi dự án hiện phải sửa tay `init.mjs` và viết `verification` string
ad-hoc cho từng feature. Hệ quả:

1. `init.mjs` phát hiện stack (package.json → npm, pom.xml → mvn) rồi chạy một lệnh cố định —
   không phân biệt unit/e2e, không thay đổi được sau setup.
2. Feature `verification` là chuỗi shell thuần — checker không biết đó là unit test hay e2e, không
   thể kiểm tra feature có chạy đúng scope hay không.
3. `test-design` skill hardcode Java 21 + JUnit 5 + jqwik — dự án Node/Python bỏ skill này.
4. `quality-strategy` có `test-risk.json` phân loại scope × size, nhưng không nối vào lệnh chạy
   test thực tế.

## Giải pháp: `test-toolchain.json`

Một file khai báo ở gốc dự án (hoặc `harness/`). Harness đọc file này để biết: với scope X, dùng
lệnh gì, cần điều kiện gì, timeout bao nhiêu.

### Schema `test-toolchain/1`

```jsonc
{
  "schema": "test-toolchain/1",

  // Khai báo mỗi scope dự án hỗ trợ.
  // Tên scope: unit | component | contract | journey | e2e | snapshot | lint | typecheck | build
  // Bốn scope đầu tương ứng quality-strategy.
  // e2e/snapshot là alias tiện dụng.
  // lint/typecheck/build là gate phi-test nhưng cùng chạy trong baseline.
  "scopes": {

    "unit": {
      "command": "npx vitest run",
      // Lệnh chạy focused cho một file hoặc pattern.
      // {file} thay bằng đường dẫn file test, {name} bằng tên test.
      "focused": "npx vitest run {file}",
      "include": ["src/**/*.test.ts", "src/**/*.spec.ts"],
      "size": "small",
      "timeout": 60000,
      // Điều kiện chạy. null = luôn chạy.
      // Nếu khai báo, scope tự bỏ qua khi điều kiện không thoả.
      "requires": null
    },

    "component": {
      "command": "npx vitest run --project component",
      "focused": "npx vitest run --project component {file}",
      "include": ["tests/component/**/*.test.ts"],
      "size": "medium",
      "timeout": 120000,
      "requires": null
    },

    "contract": {
      "command": "npx pact-jest --ci",
      "focused": "npx pact-jest --ci --testPathPattern {file}",
      "include": ["tests/contract/**/*.pact.ts"],
      "size": "medium",
      "timeout": 180000,
      "requires": null
    },

    "e2e": {
      "command": "npx playwright test",
      "focused": "npx playwright test {file}",
      "include": ["tests/e2e/**/*.spec.ts"],
      "size": "large",
      "timeout": 300000,
      // requires: mảng điều kiện. Mỗi phần tử là một trong:
      //   - tên binary trên PATH (kiểm tra bằng `command -v`)
      //   - "env:VAR_NAME" (biến môi trường phải có)
      //   - "scope:build" (scope khác phải chạy trước)
      "requires": ["chromium", "scope:build"]
    },

    "snapshot": {
      "command": "npx vitest run --config vitest.snapshot.config.ts",
      "focused": "npx vitest run --config vitest.snapshot.config.ts -t {name}",
      "include": ["tests/snapshot/**/*.snapshot.ts"],
      "size": "medium",
      "timeout": 120000,
      "requires": null
    },

    "lint": {
      "command": "npx oxlint .",
      "size": "small",
      "timeout": 60000
    },

    "typecheck": {
      "command": "npx tsc --noEmit",
      "size": "small",
      "timeout": 120000
    },

    "build": {
      "command": "npm run build",
      "size": "small",
      "timeout": 180000
    }
  },

  // Scope nào thuộc baseline gate (init.mjs chạy mỗi session).
  // Thứ tự = thứ tự chạy. Scope có `requires: ["scope:X"]` tự sắp sau X.
  "baseline": ["lint", "typecheck", "unit"],

  // Gate profile cho CI hoặc chạy tay.
  "profiles": {
    "ci-primary": ["lint", "typecheck", "unit", "component", "build"],
    "ci-full":    ["lint", "typecheck", "unit", "component", "build",
                   "contract", "e2e", "snapshot"],
    "pre-push":   ["typecheck", "unit"]
  },

  // Scope mặc định khi feature không khai báo testScope.
  "defaultTestScope": "unit"
}
```

### Quy tắc schema

1. **`command`** bắt buộc cho mọi scope. Là lệnh shell chạy toàn bộ test trong scope đó.
2. **`focused`** tuỳ chọn. Có placeholder `{file}` và `{name}`. Maker/checker dùng khi chỉ cần
   chạy test liên quan đến một feature.
3. **`include`** tuỳ chọn. Glob pattern cho biết file test nào thuộc scope này.
   `survey-project.mjs` dùng pattern này để gợi ý scope cho feature mới.
4. **`size`** bắt buộc. Một trong `small | medium | large`. Harness dùng để:
   - Quyết định timeout mặc định nếu không khai báo `timeout`.
   - Kiểm tra với `check-quality-strategy.mjs`: scope khai báo size small nhưng dùng network → lỗi.
5. **`requires`** tuỳ chọn. Mảng điều kiện. Scope tự bỏ qua (không phải lỗi) khi điều kiện không
   thoả. Checker ghi nhận "scope skipped" thay vì "scope missing".
6. **`baseline`** bắt buộc. Ít nhất một scope.
7. **`profiles`** tuỳ chọn. Tổ hợp scope tên tuỳ ý.
8. **`defaultTestScope`** tuỳ chọn, mặc định `"unit"`.

## Thay đổi `feature_list.json`

Thêm trường `testScope` vào feature:

```jsonc
{
  "id": "feat-002",
  "behavior": "...",
  "verification": "npx vitest run tests/order-matching.test.ts",
  // MỚI: scope nào feature này cần chạy qua.
  // Mảng hoặc chuỗi. Mặc định lấy từ toolchain.defaultTestScope.
  "testScope": ["unit", "contract"],
  "kind": "build"
}
```

**Ràng buộc**: `verification` vẫn là lệnh chạy được — không thay đổi. `testScope` là metadata bổ
sung để checker và gate kiểm tra. Feature có `testScope: ["contract"]` nhưng `verification` chỉ
chạy unit test → checker có cơ sở reject.

**Backward compatible**: không có `testScope` → dùng `defaultTestScope` từ toolchain. Không có
toolchain → mọi thứ hoạt động như cũ.

## Các điểm nối thay đổi

### 1. `init.mjs` — đọc toolchain cho baseline

Hiện tại: verification block hardcode lệnh cụ thể.

Sau: đọc `test-toolchain.json`, lặp qua `baseline` scopes, kiểm tra `requires`, chạy `command`.
Fallback về phát hiện stack nếu không có toolchain.

### 2. `survey-project.mjs` — phát hiện và gợi ý toolchain

Thêm phần phát hiện test runner: vitest, jest, playwright, cypress, pact, pytest, junit, go test,
cargo test. Xuất `suggestedToolchain` trong output JSON. Scaffolder dùng để sinh draft
`test-toolchain.json` — con người xác nhận trước khi lưu.

### 3. `tools/resolve-test-command.mjs` — script mới

Tra cứu lệnh test cho một scope hoặc feature:

```
node tools/resolve-test-command.mjs --scope unit
  → npx vitest run

node tools/resolve-test-command.mjs --feature feat-002
  → verification: npx vitest run tests/order-matching.test.ts
  → testScope: ["unit", "contract"]
  → contract command: npx pact-jest --ci

node tools/resolve-test-command.mjs --profile ci-primary
  → lint → typecheck → unit → component → build

node tools/resolve-test-command.mjs --scope e2e --check-requires
  → e2e: SKIPPED (chromium not found)
```

Maker, checker, và `run-loop.mjs` gọi script này thay vì đoán lệnh.

### 4. Checker — kiểm tra scope match

Nếu dự án có `test-toolchain.json` và feature có `testScope`, kiểm tra evidence có chứa lệnh chạy
từ scope tương ứng. Feature khai báo `testScope: ["contract"]` nhưng evidence chỉ ghi unit test →
reject vì thiếu scope.

Thêm kiểm tra `testScope` hợp lệ vào `review-contract.mjs`.

### 5. `check-quality-strategy.mjs` — nối test-risk với toolchain

Risk yêu cầu `requiredScope: "contract"` nhưng toolchain không có scope `"contract"` → cảnh báo.

### 6. `test-design` skill — tách strategy khỏi framework template

Thay hardcode Java 21 + JUnit 5 bằng: đọc toolchain để biết stack, chọn template phù hợp.

Strategy matrix (logic shape → technique) không đổi — nó language-agnostic. Template cung cấp:
file structure, import convention, assertion style, property-based testing library tương ứng.

Thư mục template:

```
references/templates/
  vitest/    — Vitest + fast-check
  jest/      — Jest + fast-check
  junit/     — JUnit 5 + jqwik + AssertJ
  pytest/    — pytest + hypothesis
  go/        — go test + rapid
```

## Luồng hoạt động

```
Setup (một lần)
  survey-project.mjs
    → phát hiện vitest, playwright, pact...
    → gợi ý draft test-toolchain.json
    → con người xác nhận / chỉnh sửa
    → commit test-toolchain.json

Mỗi session
  init.mjs
    → đọc test-toolchain.json
    → chạy baseline scopes theo thứ tự
    → skip scope có requires không thoả
    → baseline green / red

Mỗi feature
  feature-planner
    → gán testScope dựa trên loại thay đổi
    → unit cho logic cục bộ
    → contract cho cross-service
    → e2e cho user-visible flow

  maker
    → resolve-test-command.mjs --feature <id>
    → chạy đúng lệnh test từ toolchain
    → ghi evidence với scope metadata

  checker
    → kiểm tra evidence khớp testScope
    → reject nếu thiếu scope
```

## Backward compatibility

| Trường hợp | Hành vi |
|---|---|
| Không có `test-toolchain.json` | `init.mjs` fallback về phát hiện stack như hiện tại |
| Có toolchain nhưng feature không có `testScope` | Dùng `defaultTestScope` |
| Có `testScope` nhưng không có toolchain | `testScope` bị bỏ qua, `verification` vẫn là nguồn duy nhất |

## File mới cần tạo

| File | Mô tả |
|---|---|
| `schemas/test-toolchain.schema.json` | JSON Schema cho `test-toolchain/1` |
| `tools/resolve-test-command.mjs` | Tra cứu lệnh test theo scope/feature/profile |
| `tools/validate-toolchain.mjs` | Kiểm tra toolchain hợp lệ |
| `references/templates/<framework>/` | Template test per framework |

## File sửa đổi

| File | Thay đổi |
|---|---|
| `init.mjs` (+ template) | Đọc toolchain, chạy baseline scopes |
| `survey-project.mjs` | Phát hiện test runner, xuất suggestedToolchain |
| `feature_list.json` template | Thêm `testScope` vào feature mẫu |
| `review-contract.mjs` | Kiểm tra testScope hợp lệ |
| `check-quality-strategy.mjs` | Nối scope trong test-risk với toolchain |
| `test-design/SKILL.md` | Đọc toolchain thay vì hardcode Java |
| `testing-standards.md` | Tham chiếu toolchain |
| `checker.md` | Hướng dẫn kiểm tra scope match |
| `maker.md` | Hướng dẫn dùng resolve-test-command |

## Không làm

1. **Không thay thế `verification` string.** Toolchain bổ sung metadata, không thay thế lệnh.
   Feature vẫn khai báo lệnh cụ thể trong `verification`.

2. **Không tự động chọn scope cho feature.** Feature-planner gán `testScope` dựa trên phân tích.
   Harness không suy luận scope từ tên file test.

3. **Không gate dependency DAG phức tạp.** `baseline` là danh sách có thứ tự, `requires` xử lý
   phụ thuộc đơn giản. DAG phức tạp hơn → feature riêng sau này.

4. **Không bắt buộc.** Đây là opt-in. Dự án nhỏ với một lệnh `npm test` không cần file này.

## Đánh đổi

| Quyết định | Lý do chọn | Mặt trái |
|---|---|---|
| File JSON tĩnh thay vì code | Dễ đọc, validate, sinh tự động | Thiếu logic điều kiện phức tạp. `requires` đủ cho 90% trường hợp. |
| Scope tên cố định | Tooling đọc/so sánh được giữa dự án | Giới hạn tên. Mở rộng qua schema version. |
| `testScope` trong feature | Tránh suy luận sai | Thêm việc cho feature-planner. |
| Template per-framework | Mỗi template sát thực tế | Nhiều file. Abstraction layer luôn rò rỉ. |
| Không làm DAG | Đơn giản, đủ cho đa số dự án | Dự án lớn cần chạy gate song song phải chờ feature sau. |
