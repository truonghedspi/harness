# harness

Công cụ harness tự động cho kỹ thuật phần mềm, giúp các đội phát triển xây dựng quy trình maker-checker với độ tin cậy có thể kiểm chứng.

## Bắt đầu nhanh

### Cài đặt harness cho dự án hiện có

```bash
# Thiết lập harness trên dự án
node harness-loop/scripts/setup-harness-loop.mjs --target <đường-dẫn-dự-án>

# Kiểm tra cấu trúc (phải đạt 13/13 bài học)
node check-coverage.mjs

# Xác minh hoạt động (phải báo 0 blocker)
node harness-loop/scripts/verify-harness.mjs --target <đường-dẫn-dự-án> --run-features
```

### Chạy quy trình tự động

```bash
# Chạy vòng lặp maker-checker
node <dự-án>/harness/loop/run-loop.mjs

# Theo dõi tiến độ
node <dự-án>/harness/tools/loop-status.mjs --watch
```

## Thành phần chính

### harness-loop/
Scaffold hoàn chỉnh bao gồm 13 bài học từ [Learn Harness Engineering](https://github.com/walkinglabs/learn-harness-engineering), với vòng lặp maker-checker tự động và khả năng tự cải tiến.

**Ba pha chính:**
- **Tạo**: `setup-harness-loop.mjs` scaffold cấu trúc harness
- **Xác minh**: `check-coverage.mjs` kiểm tra cấu trúc, `verify-harness.mjs` kiểm tra hoạt động thực tế
- **Cải tiến**: `harness-issue.mjs` + `improve-harness.mjs` theo dõi và sửa lỗi tự động

**Tính năng nổi bật:**
- Hỗ trợ đa nền tảng (Windows, macOS, Linux) qua Node.js `.mjs`
- Dispatch tự động thông qua ACP cho Kiro
- Báo cáo tiến độ theo thời gian thực
- Layout được chứa trong thư mục `harness/` duy nhất

### test-design.skill
Gói kỹ năng thiết kế test độc lập với khả năng tạo oracle và điều kiện test không phụ thuộc vào implementation.

### examples/timesten-migration/
Ví dụ thực tế về migration TimesTen → Aeron Cluster, bao gồm pipeline per-unit và Definition of Done dựa trên chứng cứ.

## Mở rộng harness

### Thêm agent mới
1. Chỉnh sửa `agents.manifest.json` để định nghĩa agent
2. Tạo prompt trong `harness/prompts/` 
3. Cập nhật routing rules trong `harness/loop/route.mjs`
4. Chạy `node tools/gen-agents.mjs` để sinh config runtime

### Tùy chỉnh quy trình
- **Routing**: Chỉnh sửa `harness/loop/route.mjs` cho logic routing tùy chỉnh
- **Gate mới**: Thêm verification vào `harness/init.mjs`
- **Capabilities**: Thêm skill pack vào `harness-loop/capabilities/`

### Tích hợp Kubernetes
Harness tự động phát hiện `Chart.yaml` và cài đặt tooling cluster:
- Namespace-per-run isolation
- Helm deploy/test/teardown tự động  
- Agent `k8s-integration-tester` chuyên biệt

### Upgrade harness hiện có
```bash
# Nâng cấp harness cũ với ownership-aware merge
node harness-loop/scripts/upgrade-harness.mjs --target <dự-án>
```

## Architecture

### Vòng lặp maker-checker
- **Maker**: Triển khai features, ghi lại evidence trung thực
- **Checker**: Đánh giá cuối cùng, quyền độc quyền đặt `status: done`
- **Router**: Điều phối luồng công việc dựa trên trạng thái và dependencies

### Phân tách vai trò
- Maker không thể tự chấm `done`
- Checker chỉ chạy sau khi mọi feature được handoff
- Typed admission seam ngăn incomplete submission

### Tracing
- Decision path ghi nhận trong `trace/trace.jsonl`
- Không lưu trữ file contents trong trace

## Working in this repo

Đọc [`AGENTS.md`](AGENTS.md) — router chính: cái gì nằm ở đâu, quy tắc cần tuân thủ (sửa template chứ không sửa target; mọi thay đổi hành vi đều cần bước `demo.sh`), và cách xác minh thay đổi.
