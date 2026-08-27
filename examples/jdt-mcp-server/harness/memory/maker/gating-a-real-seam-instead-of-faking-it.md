# Chặn nhịp một cổng tiêm được, thay vì thay nó bằng đồ giả

**Khi nào áp dụng:** ca kiểm thử phải giết một thành phần rồi để một thành phần khác thế chỗ trên
cùng một tài nguyên dùng chung (socket, cổng, tệp khoá). Gặp ở `feat-mcp-shim`, ca `INV-SHIM-3`
"daemon bị giết giữa phiên, shim phải tái kết nối trong suốt".

## Cuộc chạy đua mà bản viết ngây thơ tự tạo ra

Kịch bản mong muốn: daemon A đang phục vụ socket, shim đã nối; SIGKILL A; daemon B lên; shim phải
tự nối lại và định tuyến sang B.

Bản ngây thơ giết A rồi khởi động B. Nhưng ngay khi A chết, đường dẫn socket **trống**, và cơ chế
connect-or-spawn của chính shim sẽ tự bind nó. Tuỳ nhịp máy, hoặc shim thắng (nó tự làm daemon, B
sau đó delegate sang shim), hoặc B thắng. Ca xanh vì lý do khác nhau ở mỗi lần chạy, và không lần
nào chứng minh được điều nó tuyên bố.

## Cách sửa

Đừng thay `startDaemon` bằng một hàm giả — làm thế là bỏ mất chính giao thức đang cần chứng minh.
Hãy **chặn nhịp** nó: cổng tiêm vào vẫn gọi `startDaemon` thật, chỉ chờ một promise do test nắm.

```ts
let gate: Promise<void> = Promise.resolve();
let openGate: () => void = () => {};
const closeGate = () => { gate = new Promise((resolve) => { openGate = resolve; }); };
const launch: LaunchDaemon = async (options) => { await gate; return startDaemon(options); };
```

Trình tự trở thành xác định: `closeGate()` → giết A → chờ shim **thấy** link đứt
(`waitFor(() => !shim.stats().connected)`) → client ghi tiếp lời gọi → chờ nó nằm trong đệm
(`bufferedLines === 1`) → khởi động B, chờ B báo listening → `openGate()`.

## Hai điều kèm theo, cùng quan trọng

1. **Chờ hệ thống thấy sự kiện, đừng chờ sự kiện xảy ra.** Ghi vào stdin ngay sau `kill()` là ghi
   vào một socket có thể chưa phát `close`; thông điệp mất theo đúng nghĩa "lời gọi đang bay", và ca
   sẽ đỏ ngẫu nhiên. Điều kiện chờ phải là trạng thái quan sát được của thành phần
   (`stats().connected`), không phải trạng thái của con mồi.
2. **Gắn thẻ pid vào câu trả lời của mỗi tiến trình daemon.** `result.pid` khác nhau giữa hai lần là
   bằng chứng cơ học rằng một tiến trình thật sự khác đã trả lời — mạnh hơn nhiều so với việc chỉ
   khẳng định "có câu trả lời".

Đo được: mutant bỏ `reconnect()` và mutant vứt thông điệp thay vì đệm đều giết đúng ca này và không
giết ca nào khác.
