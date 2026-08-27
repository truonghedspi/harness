# Một handle bị rò biến mutant đỏ thành một lần treo, và xoá mất dòng đỏ

**Khi nào áp dụng:** lượt maker dựng mutant cho một bất biến về *dọn dẹp* — "detach phải chạy lúc
evict", "watcher phải được đóng", "socket phải được huỷ". Gặp ở `feat-tool-layer-core`, mutant `M6`.

## Sự thật dễ hiểu nhầm

Mutant xoá đường dọn dẹp **cũng** xoá luôn thứ giữ cho tiến trình test thoát được. Ca kiểm thử vẫn
đỏ đúng chỗ — khẳng định của nó thất bại thật — nhưng `node --test` không bao giờ in TAP ra, vì một
handle `fs.watch` (`persistent: true`) còn sống giữ event loop. Biểu hiện là lượt dựng mutant chạy
quá hạn và bị `SIGKILL`, không có `not ok` nào, và ta không phân biệt được "ca không có răng" với
"ca có răng nhưng chưa kịp nói".

Cùng cơ chế với hai mục đã có trong memory này (`bounding-a-hang-at-the-test-layer-is-not-enough`,
`inner-layer-shows-up-at-the-injectable-seam`), nhưng ngược chiều: ở đây thứ cần cấp ngân sách
không phải một promise mà là **quyền sở hữu handle**, và chủ sở hữu duy nhất trong mã đúng lại
chính là dòng mà mutant vừa xoá.

## Cách làm đúng

Ca phải có một đường dọn dẹp **độc lập với đường đang bị kiểm chứng**. Không chỉ
`t.after(() => pool.close())` — `close()` là đường evict, tức chính là thứ mutant làm hỏng. Phải
giữ tham chiếu tới mọi tài nguyên mà attachment dựng ra và đóng chúng thẳng tay trong cleanup:

```ts
t.after(async () => {
  await pool.close();                                   // đường thật
  for (const entry of started) await entry.watcher.close(); // lưới an toàn, không đi qua evict
});
```

Sau khi thêm, `M6` chuyển từ `KILLED sau timeout (SIGKILL)` thành 2 ca đỏ có tên trong 4 giây.

## Hai hệ quả kèm theo

1. **Đăng ký cleanup ngay khi tài nguyên ra đời, không đặt `close()` giữa thân ca.** Bản đầu của
   tôi gọi `pool.close()` ở giữa ca; một khẳng định đỏ trước dòng đó bỏ qua nó hoàn toàn, nên mutant
   `M4` (không liên quan gì tới dọn dẹp) cũng làm treo cả tệp spec.
2. **Cho mỗi lần chạy mutant một `timeout` + `killSignal` trong chính script dựng mutant.** Nếu
   không, một mutant treo nuốt trọn ngân sách của cả lượt và không mutant nào sau nó được chạy —
   tôi mất 600 giây trước khi biết chuyện gì xảy ra.
