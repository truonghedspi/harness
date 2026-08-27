# Mutant chết chứng minh nhánh có ích, không chứng minh lý do ghi trong chú thích

**Khi nào áp dụng:** một nhánh phòng thủ đi kèm chú thích nêu rõ hậu quả nếu thiếu nó ("thiếu listener
này thì socket sẽ ném và giết tiến trình", "thiếu chốt này thì hàng đợi sẽ vô hạn"). Bạn dựng mutant
xoá nhánh, mutant chết, bạn approve. Gặp ở `feat-mcp-shim` lượt 3 (2026-08-23).

## Cái bẫy

`mcp-shim.ts` có `socket.on("error", ...)` kèm chú thích "A socket with no `error` listener throws".
Mutant xoá hẳn listener làm ca 12 chết đúng như mong đợi. Kết luận tự nhiên: chú thích đúng, nhánh
được chứng minh, xong.

Nhưng ca 12 chết vì **hết giờ chờ dòng stderr**, không phải vì tiến trình sập. Hai nguyên nhân đó cho
cùng một màu đỏ. Đo lại bằng probe riêng cho ra cơ chế thật khác hẳn: `probeDaemon` trong
`daemon-supervisor.ts` gói `connect()` vào promise bằng `socket.once("error", reject)` và **không gỡ
listener sau khi promise settled qua đường `connect`**. Socket giao cho shim vì thế tới nơi với
`listenerCount("error") === 1`. Listener thừa đó thoát ngay tại `if (settled) return`, nên nó nuốt im
lặng đúng một sự kiện error đầu tiên và ngăn Node ném. Thiếu listener của shim thì lỗi **biến mất
không dấu vết**, chứ không giết tiến trình.

Nhánh vẫn chịu lực thật, mutant vẫn chết đúng — nhưng vì một lý do khác với lý do được viết ra.

## Cách bắt

Khi mutant xoá một nhánh phòng thủ chết, đọc **thông báo lỗi của ca**, đừng chỉ đọc màu. Nếu chú thích
tuyên bố "thiếu nó thì tiến trình chết" mà ca lại đỏ vì hết giờ chờ một dòng log, hai chuyện đó không
phải một. Khoảng ba dòng probe là đủ phân giải:

```js
console.log(conn.listenerCount("error"));      // 1 = đã có kẻ khác đỡ
conn.emit("error", Object.assign(new Error("x"), { code: "EPIPE" }));
```

## Quy tắc rút ra

Mọi helper gói `connect()`/`listen()` vào promise bằng `once("connect", resolve)` + `once("error",
reject)` đều để lại **một** listener thừa đã settled trên đối tượng nó trả về, vì chỉ listener khớp
sự kiện đã xảy ra mới bị `once` gỡ. Listener thừa đó biến "sập ngay" thành "nuốt im lặng" cho đúng một
sự kiện. Trong repo này mẫu đó xuất hiện hai lần: `probeDaemon` và `connectOnce`. Khi duyệt bất kỳ
tính năng nào trả ra một socket đã kết nối, hãy đếm listener trước khi tin ngữ nghĩa mặc định của Node.

Và về mặt phán quyết: chú thích sai lý do trong khi hành vi đúng **không** phải căn cứ chặn approve —
đó là `FOLLOW-UP:` gửi planner. Điều cần chặn là hành vi sai, không phải văn xuôi sai.
