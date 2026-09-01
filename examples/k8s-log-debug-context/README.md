# Kubernetes Log Debug Context

Hướng dẫn này mô tả cách chạy kiểm thử và xác minh luồng debug log Kubernetes của project.
Project gồm collector, service Java 21, OpenSearch và MCP server cho hai tool `search_logs` và
`get_failure_context`.

## Điều kiện cần

- JDK 21 và shell có thể chạy Maven Wrapper (`./mvnw`).
- Docker cùng Minikube (hoặc cluster Kubernetes tương đương), `kubectl` và Helm cho bài kiểm
  thử end-to-end.
- Cluster phải có khả năng tạo namespace riêng cho mỗi lần chạy. Không chạy bài journey trên
  production hoặc cluster dùng chung nếu chưa được phê duyệt.

## Cấu trúc chính

| Thư mục | Nội dung |
|---|---|
| `service/` | Service Java: ingest, truy vấn log, OpenSearch và MCP |
| `collector/` | Cấu hình OpenTelemetry Collector |
| `charts/` | Helm chart và values cho local Minikube |
| `tests/k8s/` | Fixture và bài kiểm thử journey trong cluster |
| `harness/` | Script khởi tạo, tài liệu, report và công cụ deploy/cleanup |

## Chạy nhanh (không cần cluster)

Từ thư mục project này:

```bash
env -u JAVA_HOME node harness/init.mjs
./mvnw -q test
```

Các contract quan trọng có thể chạy riêng:

```bash
./mvnw -q -Dtest=IngestServiceTest test
./mvnw -q -Poracle-test -Dtest=IngestContractTest test
./mvnw -q -Poracle-test -Dtest=McpHttpContractIT test
```

`oracle-test` là profile dành cho các contract kiểm chứng hành vi của feature; nếu môi trường
không có OpenSearch thật, các test có hậu tố `IT` có thể cần được chạy trong cluster.

## Chạy journey Kubernetes/MCP

Journey deploy chart, chờ health check, tạo dữ liệu log có chủ đích, gọi MCP bằng JWT và dọn
namespace sau khi chạy. Thực hiện từ thư mục `harness` để các đường dẫn trong manifest được phân
giải đúng:

```bash
cd harness
DEPLOY_TIMEOUT_S=300 HEALTH_TIMEOUT_S=120 TEST_TIMEOUT_S=240 \
NAMESPACE_PREFIX=log-debug-journey REPORT_ROOT=trace/k8s-test \
tools/k8s-test-env.sh --services ../services.manifest.json -- \
../tests/k8s/run-journey.sh --inside-environment
```

Script sẽ tự dùng manifest `../services.manifest.json`, build image theo cấu hình service và triển
khai chart `../charts/log-debug-context`. Nếu cluster yêu cầu nạp image thủ công, build image theo
manifest rồi chạy `minikube image load log-debug-context:feat-011` trước khi thử lại.

### Dấu hiệu thành công

Journey phải xác minh được toàn bộ các điểm sau:

- request không có token bị từ chối (`401`);
- token sai audience bị từ chối (`401`), token đúng audience được chấp nhận (`200`);
- MCP công bố đúng `search_logs` và `get_failure_context`;
- kết quả có correlation/workload context đúng, không lẫn dữ liệu decoy;
- secret trong log được redaction và giới hạn truy vấn (số bản ghi, kích thước, thời gian);
- namespace và workload tạm được cleanup sau khi kết thúc.

Report được ghi dưới `harness/trace/k8s-test/`. Mở file `READ-THIS-FIRST.txt` trong report để
xem kết quả và lệnh tái hiện; report không được chứa token hay secret.

## Xử lý sự cố

Nếu cluster không reachable, kiểm tra context và trạng thái Minikube/Colima trước khi kết luận
service bị lỗi:

```bash
kubectl config current-context
kubectl cluster-info --request-timeout=5s
```

Liệt kê namespace/release cũ do lần chạy bị gián đoạn:

```bash
cd harness
tools/k8s-test-env.sh list-stale --older-than 0h
```

Chỉ dùng `cleanup-stuck-release` khi đã xác nhận đúng release, namespace và context của journey:

```bash
tools/k8s-test-env.sh cleanup-stuck-release \
  --release log-debug-context \
  --namespace <namespace-journey> \
  --context minikube
```

Không tự ý xóa RBAC, ServiceAccount hoặc namespace của môi trường khác. Sau cleanup, chạy lại
journey với `NAMESPACE_PREFIX` mới nếu report cũ còn không rõ trạng thái.

## Quy tắc vận hành an toàn

- MCP chỉ dành cho truy vấn debug đã xác thực; client phải gửi JWT với audience
  `log-debug-context`.
- Kubernetes credentials thuộc service account của workload, không đưa vào prompt, fixture hoặc
  report.
- Dữ liệu kiểm thử phải dùng correlation ID và secret giả; không đưa log production vào fixture.
- Thay đổi workflow hoặc harness cần cập nhật tài liệu tương ứng và chạy `bash
  ../../harness-loop/scripts/demo.sh` từ root repository.

Tài liệu thiết kế và tiêu chuẩn kiểm thử chi tiết nằm trong [`harness/docs/`](harness/docs/INDEX.md).

## Tích hợp với service khác

### Luồng tổng thể

```text
Ứng dụng/test workload
        │ stdout/stderr + metadata opt-in
        ▼
OpenTelemetry Collector (DaemonSet)
        │ OTLP → ingest
        ▼
log-debug-context service
        ├── chuẩn hóa + redaction
        ├── ghi OpenSearch
        └── MCP Streamable HTTP (/mcp)
                ▲
                │ JWT ServiceAccount
        Debug agent / CI service / chatbot
```

Collector không gọi MCP. MCP cũng không gọi Kubernetes hoặc OpenSearch trực tiếp; service giữ các
credential phía server và chỉ cung cấp hai truy vấn read-only. Một pod service mở đồng thời:

- `http://<release>-ingest:8080/ingest` cho collector;
- `http://<release>-mcp:8080/mcp` cho MCP client;
- `/health` trên port 8080 cho readiness.

Tên service mặc định khi release là `log-debug-context` lần lượt là
`log-debug-context-ingest` và `log-debug-context-mcp`.

### Tích hợp log producer

Service khác không cần gọi API của project để ghi log. Chỉ cần:

1. ghi log chẩn đoán ra stdout hoặc stderr;
2. gắn hai label opt-in vào pod template: `debug.logs/enabled: "true"` và
   `environment: "test"`;
3. truyền correlation ID trong thuộc tính `test.run_id` khi có run ID;
4. không ghi secret production vào log test.

Collector enrich mỗi record bằng namespace, pod, container, workload, timestamp và source. Payload
v1 sau khi decode tại ingest có dạng:

```json
{
  "schemaVersion": 1,
  "observedAt": "2026-08-26T09:45:00Z",
  "message": "payment test failed",
  "namespace": "ci-payments",
  "pod": "payments-test-7dc9b",
  "container": "test-runner",
  "workload": "payments-test",
  "source": "stdout",
  "optIn": true,
  "environment": "test",
  "attributes": {"test.run_id": "run-8842", "log.level": "ERROR"}
}
```

`schemaVersion` phải là số `1`; `observedAt` phải là RFC 3339; các trường định danh không được
trống; `source` chỉ nhận `stdout` hoặc `stderr`. Ingest từ chối record ngoài scope trước khi ghi
index và redaction áp dụng cho cả `message` lẫn giá trị trong `attributes`.

Ví dụ Deployment tối thiểu:

```yaml
spec:
  template:
    metadata:
      labels:
        debug.logs/enabled: "true"
        environment: "test"
```

Trên cluster không cho phép collector đọc `/var/log/pods`, dùng override
`charts/log-debug-context/values-local-minikube-sidecar.yaml` cho workload journey đã được phê
duyệt. Đây là fallback theo workload, không thay đổi mặc định DaemonSet của chart.

### Tích hợp MCP client/agent

MCP client chạy trong cluster nên dùng ServiceAccount riêng và gửi bearer JWT có audience
`log-debug-context`. Dùng MCP SDK tương ứng với protocol version `2025-06-18`; không gọi
OpenSearch trực tiếp. Client phải thực hiện `initialize`, `tools/list`, sau đó gọi một trong hai
tool:

`search_logs` luôn cần `namespace`, `workload`, `fromInclusive`, `toExclusive`, `maxRecords` và
cho phép thêm `messageContains`:

```json
{
  "name": "search_logs",
  "arguments": {
    "namespace": "ci-payments",
    "workload": "payments-test",
    "fromInclusive": "2026-08-26T09:45:00Z",
    "toExclusive": "2026-08-26T10:00:00Z",
    "maxRecords": 50,
    "messageContains": "failed"
  }
}
```

`get_failure_context` ưu tiên `testRunId`. Nếu không có run ID, phải gửi đồng thời `namespace`,
`workload` và khoảng thời gian:

```json
{
  "name": "get_failure_context",
  "arguments": {
    "testRunId": "run-8842",
    "fromInclusive": "2026-08-26T09:45:00Z",
    "toExclusive": "2026-08-26T10:00:00Z",
    "maxRecords": 50
  }
}
```

Giới hạn server: khoảng thời gian tối đa 15 phút, tối đa 200 record, response tối đa 256 KiB,
deadline truy vấn 5 giây và không có pagination/cursor. Client nên xử lý `truncated: true` bằng
cách báo rõ context bị giới hạn, không tự mở rộng truy vấn vượt các giới hạn này.

### Cấu hình Helm khi tích hợp

Tạo file values riêng, không sửa trực tiếp `values.yaml`:

```yaml
service:
  audience: "log-debug-context"
  issuer: "https://kubernetes.default.svc.cluster.local"
  jwksUri: "https://kubernetes.default.svc/openid/v1/jwks"
opensearch:
  endpoint: "http://opensearch.logging.svc:9200"
  inCluster: true
redaction:
  values:
    - "example-secret-"
```

Triển khai bằng Helm với `--values integration-values.yaml`. Không đưa JWT, password OpenSearch
hoặc secret literal thật vào file values đã commit; dùng Secret/SecretRef theo cơ chế triển khai
của cluster. Khi OpenSearch ở namespace khác, kiểm tra NetworkPolicy và DNS/egress trước khi chạy
journey.

Ví dụ cài đặt độc lập (release và namespace mới):

```bash
kubectl create namespace log-debug-context
helm upgrade --install log-debug-context charts/log-debug-context \
  --namespace log-debug-context \
  --values integration-values.yaml \
  --wait --timeout 5m
kubectl -n log-debug-context get pods,svc
```

Nếu dùng runner của harness, ưu tiên `tools/k8s-test-env.sh` ở phần journey vì runner chịu trách
nhiệm build image, isolation và cleanup. Không chạy đồng thời Helm thủ công trên cùng release.

### Ví dụ tích hợp trong cùng cluster

Một service CI có thể gọi MCP qua DNS nội bộ (sau khi lấy JWT từ ServiceAccount của chính nó):

```text
MCP_URL=http://log-debug-context-mcp:8080/mcp
Audience=log-debug-context
```

Service CI chỉ cần quyền egress tới service MCP và DNS; không cần quyền `get pods`, `pods/log`,
OpenSearch hay TokenReview. NetworkPolicy của chart cho phép pod cluster-internal tới port 8080,
còn JWT vẫn là lớp xác thực bắt buộc ở application layer.

### Checklist đưa service mới vào hệ thống

- [ ] Workload có stdout/stderr và đã bật opt-in.
- [ ] Có `test.run_id` ổn định để liên kết failure với log.
- [ ] Namespace/workload nằm trong khoảng thời gian truy vấn dự kiến (≤15 phút).
- [ ] Client dùng ServiceAccount JWT đúng audience và MCP SDK/protocol tương thích.
- [ ] Client chỉ gọi hai tool đã công bố và xử lý lỗi unauthorized, validation, timeout, truncation.
- [ ] NetworkPolicy cho phép đúng DNS, MCP và OpenSearch; không mở backend trực tiếp.
- [ ] Đã chạy journey end-to-end trong namespace riêng trước khi dùng với workload khác.
