# Sinh một sự kiện `error` thật trên socket, và vì sao xoá listener lại **không** làm chết tiến trình

**Khi nào áp dụng:** cần một ca chạm vào nhánh `socket.on("error", …)` bằng lỗi thật, không mock.
Gặp ở `feat-mcp-shim`, mutant `CE1`/`CE1del` sống sót hai lượt.

## Thứ tự thao tác quyết định có `EPIPE` hay không

Đo bằng probe 5 lần cho mỗi tổ hợp, trên Unix socket:

| Kịch bản | Kết quả |
|---|---|
| Phá socket phía daemon, rồi **ngay trong cùng khối đồng bộ** ghi một call 1 MB từ phía client | 5/5 có `error: write EPIPE` |
| Phá trước, ghi ngay một call 64 byte | 5/5 có `EPIPE` |
| Ghi trước (64 byte) rồi mới phá | 0/5 — không sự kiện nào |
| Ghi trước (4 MB) rồi mới phá | 5/5 có `EPIPE` |

Cơ chế: lỗi chỉ phát sinh khi còn một lệnh ghi **đang dở** lúc peer biến mất. Ghi lớn giữ cho lệnh
ghi còn dở qua nhiều vòng event loop; ghi nhỏ sau khi peer đã biến mất thì gặp ngay ống gãy. Cách an
toàn nhất là kết hợp cả hai: phá trước, ghi lớn ngay sau.

`resetAndDestroy()` không dùng được: nó **ném** `ERR_INVALID_HANDLE_TYPE` trên Unix socket.

Cửa sổ này có thật trong vận hành — một MCP client không chờ shim nhận ra daemon đã chết rồi mới gọi
tiếp — nên ca không phải tình huống dựng.

## Xoá hẳn listener `error` không hề làm chết tiến trình

Chú thích trong `src` nói "a socket with no `error` listener throws", và đó là quy tắc chung của
Node. Nhưng trên đường `delegated`, `daemon-supervisor.probeDaemon` để lại một
`socket.once("error", …)` **đã settled** trên chính connection được trao cho shim. Listener đó vẫn
gắn suốt vòng đời socket, nuốt sự kiện `error` đầu tiên rồi `return` im lặng vì `settled === true`.

Hệ quả cho người viết oracle: **không được trông chờ mutant `CE1del` làm sập tiến trình**. Ca phải có
một mỏ neo dương chủ động — chờ `stderr` khớp `/daemon link error: \S/` — thì mới phát hiện được
listener biến mất; nếu chỉ khẳng định "tiến trình còn sống" thì mutant sống nhăn.

Hệ quả cho thiết kế: một listener probe còn sót là chỗ nuốt lỗi im lặng. Đã ghi vào `checkerNotes`
để checker/planner quyết định, không sửa trong lượt maker.

## Dấu hiệu nhận biết đã làm đủ

Ca phải giết được **cả hai** biến thể: thêm `console.log` vào handler (chết ở recorder
`process.stdout`) và xoá hẳn handler (chết ở mỏ neo `stderr`). Chỉ một trong hai là chưa đóng nhánh.
