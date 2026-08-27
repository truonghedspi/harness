# Recorder trên `process.stdout.write` bắt luôn kênh báo cáo của `node --test`

**Khi nào áp dụng:** ca in-process cần khẳng định "không có gì rò ra stdout thật của tiến trình",
bằng cách ghi đè tạm `process.stdout.write`. Gặp ở `feat-mcp-shim` lượt 2 (`INV-SHIM-1`), và sẽ gặp
lại ở mọi tính năng nằm sau cùng cái stdout ấy.

## Vấn đề

Entry `stdout-invariant-needs-the-real-process.md` nói đúng rằng `Writable` được tiêm không thấy
`console.log`, và giải pháp rẻ là ghi đè `process.stdout.write` ngay trong thân ca. Cạm bẫy nằm ở
bước tiếp theo: `node --test` chạy **mỗi tệp spec trong một tiến trình con** và báo cáo kết quả về
tiến trình cha qua **chính `process.stdout` đó**, tuần tự hoá bằng bộ tuần tự V8
(`NODE_TEST_CONTEXT=child-v8`). Recorder ngây thơ vì thế ghi lại khung `test:start` / `test:pass`
của chính runner, và ca đỏ với một đống byte nhị phân không liên quan gì tới mã nguồn đang kiểm thử.

Đây là đỏ giả, không phải đỏ hợp lệ: nó xuất hiện ngay cả trên bản triển khai đúng.

## Cách làm đúng

Đo trước, đừng suy diễn. Một tệp probe nhỏ cho kết quả dứt khoát:

| Nguồn ghi | Kiểu chunk tới `write()` |
|---|---|
| `console.log("…")` | `string` |
| `process.stdout.write("…")` từ mã nguồn | `string` |
| kênh báo cáo của runner | `Buffer` (mở đầu `0xFF 0x0F`) |

Recorder chỉ cộng dồn chunk kiểu `string`. Kèm hai thứ làm cho quy tắc đó tự bảo vệ:

1. **Khẳng định tiền đề**: `process.env.NODE_TEST_CONTEXT === "child-v8"`. Nếu một runner tương lai
   báo cáo bằng văn bản, giả định "Buffer là của runner" sụp đổ; khẳng định này làm ca đỏ to thay vì
   lặng lẽ xanh mãi mãi.
2. **Mỏ neo dương**: ngay sau khi ghi đè, phát một `console.log` mốc và đòi recorder bắt được nó,
   rồi mới xoá bộ đệm. Không có mỏ neo này, `recorded() === ""` xanh một cách rỗng nếu recorder chết.

## Dấu hiệu đã làm đủ

Mutant chỉ **thêm** một `console.log` (giữ nguyên `stderr.write`) phải giết đúng ca đi qua nhánh đó.
Ở đây ba vị trí trên đường reconnect/stop cho ba mutant riêng: dòng link-closed và nhánh reconnect
thất bại giết cả hai ca recorder, nhánh stop-shutdown thất bại chỉ giết ca đi qua `stop()`. Nếu
mutant nào sống, ca chưa chạm nhánh đó — không phải recorder hỏng.
