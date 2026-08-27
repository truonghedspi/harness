# Chú thích của ca kiểm thử khẳng định fixture chứa trường hợp biên — hãy tính lại số học

**Khi nào áp dụng:** một ca kiểm thử có chú thích tự mô tả trường hợp biên nó dựng ("một định danh
non-ASCII nằm vắt qua ranh giới chunk", "một bản ghi đúng bằng kích thước bộ đệm", "một mốc thời gian
ngay tại biên giây"). Gặp ở `feat-mcp-shim` lượt 2 (2026-08-23).

## Cái bẫy

Ca framing của `mcp-shim` ghi một thông điệp 200 KB gồm toàn ký tự `ü` hai byte, cắt thành các chunk
30.000 byte, và chú thích nói rõ mục đích: một bản giải mã theo từng chunk sẽ biến ký tự bị cắt đôi
thành ký tự thay thế. Chú thích thuyết phục, dữ liệu lớn, ca xanh. Nhưng tiền tố
`{"jsonrpc":"2.0","id":1,"result":{"text":"` dài đúng **42 byte** — số chẵn — nên mọi ranh giới bội
số của 30.000 rơi đúng vào **byte đầu** của một ký tự. Không ký tự nào bị cắt đôi. Mutant thay
`StringDecoder` bằng `chunk.toString("utf8")` sống 11/11.

Chiều ngược lại còn khép kín hơn: `Buffer.from(big.slice(offset, offset + size), "utf8")` cắt theo
chỉ số **chuỗi** rồi mới mã hoá, nên mỗi buffer luôn là UTF-8 trọn vẹn theo cấu tạo. Ca đó không bao
giờ có khả năng phân biệt, dù có chạy bao nhiêu lần.

Cách bắt rẻ hơn cả việc dựng mutant: lấy đúng biểu thức fixture, tính độ dài tiền tố và bước nhảy
bằng `Buffer.byteLength`, rồi kiểm tra `(buf[boundary] & 0xc0) === 0x80` ở từng ranh giới. Ba dòng
Node là đủ. Quy tắc rút ra: **mỗi chú thích khẳng định "fixture này chứa trường hợp biên X" là một
khẳng định cần đo, không phải một dữ kiện cần đọc.** Kích thước dữ liệu lớn không thay cho số học.

Cách đòi cho tất định: bắt ca chọn điểm cắt rồi **khẳng định điều kiện biên như tiền đề của chính
nó** (`assert.ok((buf[cut] & 0xc0) === 0x80)`), thay vì hy vọng một ranh giới đều đặn rơi trúng.

## Mutant sống sót ≠ mutant tương đương: đo tính tới được của nhánh trước

Cùng lượt đó, mutant thêm `console.log` vào `socket.on("error")` sống 11/11, và mutant **xoá hẳn**
listener cũng sống 11/11. Hai kết quả này chỉ đọc được sau khi có một phép đo thứ ba: thay thân
handler bằng một lệnh `appendFileSync` vào `/tmp` rồi chạy lại cả suite. Không có tệp nào được tạo —
nhánh không chạy lần nào. Nhờ đó "mutant sống sót" chuyển từ "có thể là tương đương" thành "nhánh
này chưa ca nào chạm tới", tức một yêu cầu cụ thể chứ không phải một nghi ngờ.

Và trước khi đòi ca mới, hãy đo cách dựng nó. Ở đây `socket.resetAndDestroy()` — cách hiển nhiên để
ép ECONNRESET — **ném** `ERR_INVALID_HANDLE_TYPE` trên Unix domain socket, chỉ dùng được cho TCP.
Cách chạy được là phá socket phía daemon rồi ghi ngay một message lớn từ phía client trước khi sự
kiện `close` kịp tới: probe cho ra đúng một sự kiện `error` mã `EPIPE`. Yêu cầu kèm phép đo thì
maker không mất một lượt để phát hiện đường cụt.
