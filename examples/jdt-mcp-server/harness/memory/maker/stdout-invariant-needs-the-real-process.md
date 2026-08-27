# Bất biến về stdout chỉ đo được ở tiến trình thật

**Khi nào áp dụng:** tính năng nào sở hữu một bất biến dạng "không có gì ngoài X được ghi ra
stdout". Gặp ở `feat-mcp-shim` (`INV-SHIM-1`), và mọi tính năng tầng tool sau này đều nằm sau đúng
cái stdout ấy.

## Vấn đề

Cách viết oracle theo phản xạ là tiêm một `Writable` thu gom vào tuỳ chọn `stdout` rồi khẳng định
mọi dòng trong đó đều phân tích được. Cách này đo sai đối tượng. `console.log`, `process.stdout.write`
và mọi thư viện gọi hai hàm đó đều ghi vào `process.stdout` của tiến trình, không vào luồng được
tiêm. Một dòng gỡ lỗi bỏ quên vì thế đi thẳng tới bộ phân tích của client mà oracle không thấy gì.

Đo được, không suy diễn: mutant M1 chèn đúng một `console.log("shim linked: role=…")` vào
`establish()`. Sáu ca chạy trong tiến trình vẫn xanh; chỉ ca chạy shim như tiến trình con thật và
đọc byte trên ống stdout thật báo đỏ:
`INV-SHIM-1 violated: real stdout line 1 is not a valid MCP message: "shim linked: role=daemon"`.

## Cách làm đúng

Ghi một script `.mjs` vào tmpdir lúc chạy test, `import` module đang kiểm thử bằng đường dẫn tuyệt
đối, `spawn` với `--experimental-strip-types` và `stdio: ["pipe","pipe","pipe"]`, rồi khẳng định
trên chuỗi byte gom từ `child.stdout`. Cùng script nên nhận thêm một tham số chế độ để phủ cả nhánh
hỏng — ở đây là "auto-spawn thất bại": khẳng định `stdout === ""` tuyệt đối, vì một lỗi khởi động là
lúc dễ rò ra stdout nhất.

Giữ lại cả ca chạy trong tiến trình: nó khẳng định được những thứ chính xác mà biên tiến trình
không cho (số dòng bị chuyển hướng, thứ tự, trạng thái nội bộ). Hai mức bổ sung nhau, không thay
thế nhau.

## Dấu hiệu đã làm đủ

Một mutant chỉ chèn `console.log` phải giết **đúng** ca ở biên tiến trình và không giết ca nào
khác. Nếu nó giết cả ca trong tiến trình, oracle đang đo nhầm chỗ; nếu nó không giết ca nào, chưa có
ca nào thật sự canh stdout.
