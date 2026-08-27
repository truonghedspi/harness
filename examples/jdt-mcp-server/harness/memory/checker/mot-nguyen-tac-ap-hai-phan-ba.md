# Nguyên tắc oracle mà maker tự phát biểu thường chỉ được áp hai phần ba

**Khi nào áp dụng:** maker giải thích vì sao một lớp ca phải đắt hơn ("Writable được tiêm không nhìn
thấy console.log, nên hai ca này chạy shim như tiến trình con thật"), rồi nộp mutant chứng minh đúng
lớp ca đó. Gặp ở `feat-mcp-shim` (2026-08-23).

## Cái bẫy

Lời giải thích đúng, mutant tái hiện đúng, ca đắt tiền có thật. Cái không ai kiểm: nguyên tắc đó
được áp cho **bao nhiêu phần** trong số các vị trí cần nó. Ở `mcp-shim` có ba cụm gọi `log()` —
đường noise bình thường, đường auto-spawn hỏng, đường reconnect/stop. Hai ca tiến trình con phủ hai
cụm đầu. Cụm thứ ba, cũng là cụm gọi `log()` dày nhất, chỉ có ca chạy trong-process — đúng loại ca
mà chính maker vừa chứng minh là mù với `console.log`.

Cách bắt rẻ: đếm **vị trí gọi** cơ chế mà nguyên tắc bảo vệ (ở đây là `grep -c "log("`), rồi đối
chiếu với danh sách ca chạy ở mức đắt. Chênh lệch chính là danh sách mutant cần dựng. Ba mutant
`console.log` trên đường reconnect/stop đều sống sót 7/7.

## Cái bẫy thứ hai, nặng hơn: hai cơ chế dư thừa đỡ cho nhau

Chú thích đầu file khẳng định "đệm theo message trọn vẹn là thứ làm cho reconnect an toàn … restart
có thể làm hỏng lời gọi đang bay nhưng không bao giờ làm hỏng khung". Thực tế có **hai** cơ chế cùng
giữ khẳng định đó: `new LineFramer()` tạo lại trong `attach()` mỗi link, và `framer.flush()` ở close
handler làm rỗng bộ đệm. Phá từng cái một thì mutant sống sót — không phải vì oracle tốt, mà vì cái
còn lại đỡ. Đây là biến thể của `redundant-fallback-masks-a-mutant.md`, nhưng khó thấy hơn: hai cơ
chế nằm ở hai hàm khác nhau và không hàm nào nhắc tới hàm kia.

Phá **cả hai cùng lúc**: spec vẫn xanh 7/7, trong khi probe dựng đúng kịch bản "daemon chết lúc một
message mới đi được nửa chừng" cho thấy câu trả lời sau restart bị nuốt mất hoàn toàn (stdout rỗng,
client treo). Quy tắc rút ra: khi một câu chú thích khẳng định tính bất biến, **đếm số cơ chế cùng
thực thi câu đó trước khi thiết kế mutant**, rồi dựng thêm một mutant phá hết cả cụm. Một mutant sống
sót trên cơ chế dư thừa không nói gì; cả cụm sống sót mới là bằng chứng oracle mù.

## Đo trước khi đòi

Hai điều đã đo trước khi viết REJECT, và cả hai đều đổi nội dung phán quyết:

- Đặt recorder lên `process.stdout.write` trong thân ca chạy trong-process **có** bắt được
  `console.log`. Nhờ đó yêu cầu trở thành một khẳng định rẻ tiền, không phải đòi thêm ca tiến trình con.
- Nhánh mà cổng `launch` loại bỏ (daemon chết, không ai thay thế, shim tự lên vai daemon) **chạy
  đúng** trong bản hiện tại. Nhờ đó nó xuống thành ca còn thiếu, không phải lỗi triển khai — và
  phán quyết không đổ oan cho maker.
