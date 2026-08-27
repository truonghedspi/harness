# Teardown chạy trước khi startup kịp đăng ký — mọi mutant về evict đều bỏ sót

**Khi nào áp dụng:** mọi cặp attach/detach có vòng đời spawn ↔ evict — pool, registry, subscriber
list, watcher. Gặp ở `feat-tool-layer-core` (2026-08-24), phần nối dây `WorkspaceAttachment` trong
`workspace-pool.ts`.

## Vì sao danh sách mutant về evict trông đầy đủ mà vẫn hụt

Maker dựng đúng hai mutant về đường gỡ: "evict chỉ gọi forget, không gọi detach" và "evict không
chạy detach nào". Cả hai đều đỏ, cả hai đều tái hiện. Nhưng cả hai đều chạy trên một fixture duy
nhất: workspace ĐÃ khởi động xong rồi mới evict. Trục không ai chạm là trục thời gian.

Mã nguồn có dạng này:

```
async #evict(victim) {
  this.#entries.delete(victim.workspaceId);
  await this.#runDetachments(victim);   // splice(0) trên một mảng CÒN RỖNG
  const spawned = await victim.started;  // start mới chạy tiếp, mới push detach vào mảng
  await spawned.stop();
}
```

`close()` evict mọi entry, kể cả entry đang starting. Lúc `splice(0)` chạy, `#startWorkspace` chưa
kịp đẩy hàm detach nào vào `entry.detachments`; ngay sau đó nó đẩy vào, và không ai chạy chúng nữa.
Tiến trình bị giết, còn đăng ký thì sống mãi.

## Cách đo, rẻ và dứt khoát

Không cần mutant — đây là lỗi trên bản pristine, nên probe chỉ cần một spawn seam CHẬM:

1. `spawnWorkspace` trả về sau ~120 ms.
2. Gọi `acquire()` mà KHÔNG await; đợi ~20 ms rồi `await close()`.
3. Đếm `attached` với `detached`. Ở đây: `attached=1, detached=0, stopped=1`.

Probe thứ hai biến con số thành hậu quả nhìn thấy được: thay attachment đếm bằng attachment thật
(`attachFileSync`). Sau khi `close()` đã resolve, tiến trình node **không bao giờ thoát** — handle
`fs.watch` bị rò giữ event loop sống. Đối chứng (await xong acquire rồi mới close) thoát trong
222 ms. Luôn bọc probe loại này bằng wrapper SIGKILL ở cấp tiến trình cha: bằng chứng ở đây chính là
"nó treo", nên lệnh trần sẽ treo cả lượt soi.

Quy tắc rút ra: với mỗi cặp attach/detach, hỏi "nếu teardown chạy khi startup mới đi được nửa
đường thì sao?" và dựng đúng một probe có seam chậm. Mutant về evict không bao giờ trả lời được câu
đó, vì mutant nào cũng chạy trên fixture đã start xong.

## Cùng entry: một toạ độ nấp trong chuỗi thông điệp là ranh giới chuyển đổi thứ hai

Cùng lượt soi, chú thích đầu tệp khẳng định "toàn bộ tệp này có đúng hai hàm chạm vào phép cộng trừ
chỉ số ... không có đường tắt nào tự cộng lấy". Đọc kỹ thì có một chỗ thứ ba, nằm trong template
string dựng thông điệp lỗi:

```
reason: `... resolved no element at line ${position.line + POSITION_BASE}, column ${...}`
```

Mutant đổi chỗ đó về 0-based sống sót toàn bộ suite, vì ca duy nhất chạm nhánh ấy chỉ khẳng định
`reason.length > 0`. Cách đọc nhanh: `grep` chính tên hằng số chuyển đổi trong cả tệp và đếm số
điểm xuất hiện, đừng tin câu "chỉ hai hàm" trong chú thích. Toạ độ nằm trong văn bản người đọc vẫn
là toạ độ — nó rời khỏi hệ thống và agent hành động theo nó.
