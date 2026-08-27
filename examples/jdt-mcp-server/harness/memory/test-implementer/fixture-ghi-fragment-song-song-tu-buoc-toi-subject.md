# Fixture ghi fragment song song sẽ tự buộc tội subject

## Quan sát

Oracle của TCON-SHIM-0001 đo một thuộc tính của stdout: mọi dòng phải là đúng một message MCP. Để
dựng hazard "message bị cắt ngang giữa hai lần ghi", phía daemon trong fixture ghi mỗi câu trả lời
làm ba lần ghi tách rời, có `setTimeout` xen giữa. Bản đầu tiên xử lý mỗi dòng nhận được ngay trong
handler `data`, nên ba câu trả lời chạy chồng lên nhau và byte của chúng trộn vào nhau trên socket.

Kết quả: ca đỏ với "host: 1, joiner: 1" sau 30 s chờ, trông hệt như một vi phạm INV-SHIM-1 của shim.
Thực tế shim làm đúng — nó nhận một dòng ghép từ ba message khác nhau, thấy không parse được, và
chuyển sang stderr. Lỗi nằm ở fixture.

## Bằng chứng

Sau khi cho fixture xếp hàng và ghi TỪNG message một cách trọn vẹn (vẫn giữ ba lần ghi tách rời cho
mỗi message), ca xanh ngay. Hazard vẫn còn nguyên: mutant bỏ khung theo newline trong `attach()` vẫn
làm ca đỏ, và mutant bỏ cổng chặn `isMcpMessage` cũng vậy.

Ranh giới đúng: một message được phép bị cắt ngang qua nhiều lần ghi (đó là hazard của subject),
nhưng HAI message không được phép trộn byte (đó là lỗi của phía ghi, không phải của shim). Trộn hai
message là điều một daemon thật không bao giờ làm, nên khẳng định nào đỏ vì nó thì đang nói về
fixture.

## Quy tắc cho các lần sau

Khi fixture cố tình ghi dở dang để dựng hazard framing, luôn tuần tự hoá theo từng message. Và khi
một oracle mới đỏ ngay lần chạy đầu trên mã nguồn đã `done`, đọc thông điệp lỗi để phân biệt hai
khả năng trước khi kết luận: subject sai, hay chính fixture đã tạo ra đầu vào mà spec không cho phép
tồn tại.
