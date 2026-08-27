# Mọi ca đều `await` xong tài nguyên, nên trạng thái nửa-dựng không ca nào bước vào

**Khi nào áp dụng:** một thành phần có vòng đời hai pha — dựng (`spawn`, `connect`, `start`) rồi nối
dây (`attach`, `subscribe`, `register`) — và bạn đang chứng minh bất biến về dọn dẹp. Gặp ở
`feat-tool-layer-core`, lượt 1 bị REJECT.

## Điều đã xảy ra

Sáu mutant `M1`–`M6` của lượt 1 đều chết đúng số ca đã khai. Checker chạy lại: khớp hoàn toàn. Rồi
checker dựng một probe **không phải mutant** — gọi `close()` trong lúc `spawn` còn dở — và đo được
`attached=1, detached=0, stopped=1` trên bản **pristine**. Lỗi nằm trong mã sản xuất, không phải
trong bản đồ nhánh: `#evict` chạy `#runDetachments` trước `await entry.started`, mà mảng detach chỉ
đầy đủ sau khi hàm start chạy xong.

Nguyên nhân gốc của việc không ai thấy: **mọi ca trong tệp spec đều mở đầu bằng
`const lease = await pool.acquire(...)`.** Sau dòng đó, entry luôn ở trạng thái đã nối dây xong.
Trạng thái `"starting"` tồn tại trong kiểu dữ liệu (`WorkspaceState`), được gán trong mã, và không
một ca nào từng quan sát nó. Một mutant chỉ chết được nếu có ca đi qua nhánh nó làm hỏng; ở đây
nhánh đó không có ca nào, nên mọi mutant về thứ tự dọn dẹp trông như mutant tương đương.

## Dấu hiệu nhận biết, áp dụng được cho lượt sau

Đọc kiểu trạng thái của thành phần rồi đếm xem mỗi giá trị được **quan sát** bởi bao nhiêu ca. Giá
trị nào chỉ được gán mà không ca nào đọc là một vùng mù. `"starting"`, `"draining"`, `"reconnecting"`
gần như luôn rơi vào đó, vì fixture thuận tay nhất là fixture giải quyết ngay lập tức.

## Cách dựng cửa sổ đó một cách xác định

Không dùng `setTimeout`. Đặt hai chốt chặn quanh chính seam đã tiêm:

```ts
const spawnReached = deferred();   // seam báo "tôi đã vào tới đây"
const spawnGate = deferred();      // test quyết định khi nào seam trả về
const spawnWorkspace = async () => { spawnReached.resolve(); await spawnGate.promise; return real; };

const acquiring = pool.acquire(root);
await spawnReached.promise;   // chắc chắn đang ở giữa hai pha
const closing = pool.close(); // sự kiện cần đo, rơi đúng vào cửa sổ
spawnGate.resolve();          // pha dựng kết thúc SAU khi dọn dẹp đã bắt đầu
await closing;
```

Hai điều bắt buộc kèm theo, nếu không mutant ngược lại sẽ treo thay vì báo đỏ (xem
`a-leaked-handle-turns-a-red-mutant-into-a-hang`): mở chốt chặn trong `t.after` để không ca nào kẹt
sau một khẳng định đỏ, và giữ tham chiếu tới tài nguyên thật (`fs.watch`) để đóng thẳng, ngoài đường
đang bị kiểm chứng.

## Hai điều nhỏ hơn, cùng lượt

- **Một toạ độ đi ra ngoài dưới dạng văn xuôi vẫn là một toạ độ.** `HoverAnswer.reason` được dựng
  bằng template string tự cộng `+ 1`, tức một ranh giới chuyển đổi thứ hai bên cạnh hàm chuyển đổi
  chính thức. Ca cũ chỉ đòi `reason.length > 0` nên mutant 0-based sống. Khi bất biến nói "chuyển đổi
  tại đúng một chỗ", hãy `grep` cả chuỗi định dạng, không chỉ các đường trả về có kiểu.
- **Fixture chứa emoji không kiểm chứng được xử lý cặp surrogate.** Emoji không phải identifier part,
  nên nhánh `width = 2` và `width = 1` cho cùng kết quả. Cần một chữ cái astral-plane THẬT
  (`𝐀`, U+1D400 — `\p{L}`) nằm trong một định danh. Ca đó lộ ra rằng quét ngược bằng
  `codePointAt(start - 1)` là sai từ đầu: ở đúng một cặp surrogate, vị trí đó là nửa sau, không phải
  cả cặp — bề rộng phải suy từ dải trail surrogate `0xDC00`–`0xDFFF`.
