# Máy này không có `timeout`, và một lượt mutant thiếu nó im lặng hoàn toàn

**Khi nào áp dụng:** mọi script dựng mutant chạy trên máy phát triển hiện tại (macOS, không cài
GNU coreutils). Gặp ở `feat-tool-references`.

Memory entry `a-leaked-handle-turns-a-red-mutant-into-a-hang.md` khuyên mỗi lần chạy mutant phải có
`timeout` + `killSignal` riêng. Lời khuyên đúng, nhưng cách thực hiện theo phản xạ thì hỏng ở đây:

```
command -v timeout gtimeout   # → không có gì, exit 1
```

Cả `timeout` lẫn `gtimeout` đều không tồn tại. Nếu script viết
`timeout -s KILL 120 node --test ... 2>&1 | grep -E "^(not ok|# tests)"`, dòng
`command not found` đi vào stderr, bị `2>&1` gộp vào ống, rồi bị chính `grep` lọc bỏ. Đầu ra là:

```
=== M1 bỏ hẳn phép cắt ===
=== M2 total báo bằng số sau khi cắt ===
```

Bốn tiêu đề mutant, không một dòng kết quả nào. Trạng thái này **không phân biệt được** với "mọi
mutant đều sống sót" nếu chỉ liếc qua, và một lượt maker đang vội sẽ đọc nó theo hướng thuận lợi
cho mình.

## Cách làm đúng

Lấy hạn chót từ chính `node --test`, đây là thứ luôn có mặt:

```
node --experimental-strip-types --test --test-timeout=30000 test/<vùng>/<tên>.spec.ts
```

cộng với `{ timeout: N }` khai báo ở từng ca. Một mutant làm treo khi đó vẫn kết thúc bằng một dòng
`not ok` có tên ca, chứ không phải bằng sự im lặng.

## Hai lưới an toàn rẻ tiền cho script mutant

- Luôn để `# tests` / `# pass` / `# fail` trong mẫu `grep`. Vắng ba dòng đó nghĩa là lệnh không hề
  chạy, chứ không phải mutant sống sót.
- Khẳng định chuỗi cần thay xuất hiện **đúng một lần** trước khi thay (một đoạn `python3` ba dòng là
  đủ). Một mutant không dựng được mà vẫn chạy test sẽ cho một lượt xanh vô nghĩa.
