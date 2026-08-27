# Hook `after` của node:test chạy theo thứ tự ĐĂNG KÝ, không phải thứ tự ngược

## Quan sát

Hai lượt liên tiếp của `feat-prove-navigation-tools` bị ngắt vì tiến trình test không bao giờ thoát.
Nguyên nhân không nằm trong sản phẩm mà trong trình tự dọn dẹp của chính tệp test.

Kiểm chứng trực tiếp trên node 22:

```
t.after(() => console.log("A"));   // in ra trước
t.after(() => console.log("B"));   // in ra sau
```

Tức FIFO. Nhiều người viết test giả định LIFO theo thói quen từ `defer` của Go hoặc `addCleanup` của
Python `unittest`, và giả định đó sai ở đây.

## Hệ quả

Mẫu quen thuộc trong repo — và đang có mặt ở `pool-lifecycle`, `diagnostics-identity`,
`pool-crash-handling` — là:

```
t.after(() => rmSync(root, { recursive: true, force: true }));   // đăng ký trước ⇒ CHẠY TRƯỚC
t.after(() => pool.close());                                     // đăng ký sau  ⇒ chạy sau
```

Thư mục bị xoá khi tiến trình JDT LS còn sống. Lệnh xoá ném lỗi, JVM sống sót và giữ stdio, `node
--test` không đóng được stdin của tiến trình con nên không bao giờ thoát. Triệu chứng là một lượt
agent bị ngắt vì hết thời gian, rất dễ bị quy nhầm cho hạ tầng.

## Quy tắc cho các lần sau

Đừng đăng ký trực tiếp nhiều `t.after` khi có tiến trình con. Dùng một ngăn xếp duy nhất tháo theo
chiều ngược:

```
function cleanupStack(t) {
  const steps = [];
  t.after(async () => {
    for (let i = steps.length - 1; i >= 0; i -= 1) {
      try { await steps[i](); } catch { /* best-effort */ }
    }
  });
  return (step) => { steps.push(step); };
}
```

Hai điều kèm theo, cả hai đều đã cứu tệp này:

1. **Đăng ký ngay khi tài nguyên tồn tại**, không phải sau khi hàm dựng trả về. Handshake ném lỗi
   giữa chừng vẫn để lại một JVM mồ côi nếu chờ tới lúc trả về mới đăng ký.
2. **Bọc từng bước bằng try/catch riêng.** Một khẳng định đỏ giữa chừng vẫn phải bỏ lại máy sạch.

Bằng chứng cơ học rẻ và thuyết phục: xoá sạch `$TMPDIR/<tiền-tố>-*`, chạy lại, rồi đếm. Còn 0 thư mục
tạm và 0 tiến trình sót thì trình tự dọn dẹp đúng. Ở lượt này, 15 thư mục sót lại đều mang mốc thời
gian của hai lượt bị ngắt, không lượt nào của bản đã sửa.
