# Điểm cắt giữa ký tự UTF-8 phải được chứng minh bằng byte, không được tuyên bố bằng chú thích

**Khi nào áp dụng:** ca kiểm thử cần phân biệt `StringDecoder` với `chunk.toString("utf8")`, hoặc
bất kỳ ca nào tuyên bố "dữ liệu bị cắt ở chỗ khó". Gặp ở `feat-mcp-shim`, mutant `D1` sống sót hai
lượt liền.

## Vì sao ca cũ vô hại dù nhìn rất thuyết phục

Ca framing cũ có chú thích "a non-ASCII identifier straddling the chunk boundaries" và fixture đầy
ký tự đa byte. Nhưng phép chia là `Math.ceil(length / 7)` trên **chỉ số chuỗi**, còn chiều ngược lại
chia theo bước 30.000 byte với tiền tố JSON dài 42 byte — mọi ranh giới đều rơi đúng đầu một ký tự.
Khi mọi ranh giới là ranh giới ký tự, hai bộ giải mã cho ra **cùng một chuỗi**, nên mutant sống.

Bài học: fixture *chứa* ký tự đa byte không chứng minh gì. Thứ cần chứng minh là **ranh giới nằm
trong lòng một ký tự**, và điều đó kiểm tra được bằng một phép so bit:

```ts
const cut = buffer.indexOf(Buffer.from("𝄞", "utf8")) + 1;
assert.equal((buffer[cut] as number) & 0xc0, 0x80); // byte continuation ⇒ cắt giữa ký tự
```

Chọn ký tự 4 byte để có ba byte continuation kẹt lại trong decoder, thay vì một.

## Cắt đúng chỗ vẫn chưa đủ: phải chứng minh chunk tới thành hai lần đọc

Trên socket, người viết test **không** chọn được ranh giới đọc: kernel gộp nhiều lần `write()` nhỏ
vào một lần `read()`, và với `PassThrough` thì `Readable.read()` cũng nối các chunk đang nằm trong
buffer. Ghi hai lần liên tiếp rồi tin rằng bên kia thấy hai chunk là một giả định không có bằng
chứng — đúng loại giả định đã làm hỏng ca cũ.

Cách chứng minh, dùng được cho cả hai chiều:

1. Ghép một **thông điệp neo** (một dòng hoàn chỉnh, có `\n`) vào *cùng một lần ghi* với phần đầu bị
   cắt. Framer xử lý trọn một chunk trong một lời gọi `push()`, nên thấy thông điệp neo ở đầu ra
   nghĩa là phần đầu đã nằm trong decoder — bằng chứng cơ học, không phải `setTimeout`.
2. Chỉ ghi phần đuôi **sau** khi thông điệp neo đã tới, cộng một khoảng lắng ~100 ms. Khoảng lắng
   loại nốt trường hợp kernel tự tách chunk thứ nhất rồi mới giao phần đầu.
3. So sánh **toàn văn** chuỗi nhận được với bản gốc. "Parse được thành JSON" là khẳng định rỗng ở
   đây: `chunk.toString()` trên điểm cắt giữa ký tự sinh ra `����` nằm trong một string value, JSON
   vẫn hợp lệ — đúng kịch bản xấu nhất, không throw, không đỏ, chỉ âm thầm sai.

Kèm một tiện ích nhỏ đáng có: so sánh hai chuỗi 200 KB bằng `assert.equal` in ra một khối vô nghĩa;
hàm so sánh riêng báo **chỉ số ký tự lệch đầu tiên** cùng 24 ký tự quanh đó thì đọc được ngay.

## Framer của chính oracle không được là cái hỏng

Ca này còn ẩn một bẫy ngược: phía daemon trong test tự ghép chunk bằng `chunk.toString("utf8")`. Khi
shim ghi một dòng 200 KB trong một lần `write()`, kernel trả về theo ranh giới của nó, và một ranh
giới rơi giữa ký tự sẽ làm hỏng **thứ oracle đo được** chứ không phải thứ nó kiểm thử. Bộ ghép chunk
của test phải dùng `StringDecoder` trước khi nói bất cứ điều gì về byte-exact.

## Dấu hiệu nhận biết đã làm đủ

Mutant đổi `StringDecoder` thành `toString()` phải đỏ ở **từng chiều một cách độc lập** (đo riêng
bằng một spec tạm chỉ giữ một chiều), và dòng đỏ phải nêu chỉ số ký tự lệch, không phải một timeout.
