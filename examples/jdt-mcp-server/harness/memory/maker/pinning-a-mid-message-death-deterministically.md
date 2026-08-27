# Ghim "peer chết giữa một thông điệp" bằng một lần ghi socket duy nhất

**Khi nào áp dụng:** ca kiểm thử phải dựng kịch bản peer bị giết khi một thông điệp mới đi được nửa
chừng — chưa đủ một dòng kết thúc bằng newline. Gặp ở `feat-mcp-shim` lượt 2 (`INV-SHIM-3`).

## Vấn đề

Giết peer *giữa hai thông điệp trọn vẹn* là ca dễ và không chứng minh được điều mà chú thích thiết
kế tuyên bố ("một lần khởi động lại có thể mất lời gọi đang bay nhưng không bao giờ làm hỏng khung").
Ca khó đòi một điều kiện thời điểm: mảnh cụt phải **đã** nằm trong bộ đệm ghép khung của thành phần
đang kiểm thử, **trước** khi peer chết. Cách phản xạ là ghi mảnh cụt rồi `setTimeout` một khoảng
ngắn rồi mới SIGKILL. Khoảng chờ đó không phải bằng chứng: nếu nó ngắn hơn thực tế, ca xanh vì lý do
khác và mutant sống sót mà không ai biết.

## Cách làm đúng

Cho peer ghi mảnh cụt trong **cùng một lần `socket.write()`** với câu trả lời của thông điệp trước
đó:

```
payload = JSON.stringify(response) + "\n" + trailingFragment
socket.write(payload)
```

Ca chờ câu trả lời đó xuất hiện trên stdout. Vì hai phần đi chung một lần ghi, câu trả lời có mặt
trên stdout là bằng chứng cơ học rằng mảnh cụt đã nằm trong framer. Không còn khoảng chờ nào phải
đoán. (Vẫn giữ một khoảng lắng ngắn sau đó, phòng trường hợp nhân tách lần ghi ấy thành hai lần đọc
— nhưng đó là dây an toàn, không phải cơ chế chính.)

## Vì sao đáng công

Hai cơ chế dư thừa trong `mcp-shim.ts` cùng thực thi một lời tuyên bố: `LineFramer` được tạo mới ở
mỗi `attach()`, và `framer.flush()` chạy ở handler `close`. Phá từng cái một thì cái còn lại đỡ.
Chỉ với ca ghim được đúng thời điểm ở trên, mutant kép mới lộ nguyên hình: câu trả lời cho lời gọi
sau khi khởi động lại **biến mất hẳn**, stdout rỗng, client treo vĩnh viễn. Ca cũ giết peer giữa hai
thông điệp trọn vẹn vẫn xanh dưới đúng mutant đó.

Ca nên đòi thêm rằng mảnh cụt được **ghi sổ đúng một lần** (`divertedLines === 1`) và hiện trên
stderr, không chỉ "không rò ra stdout". Nếu thiếu, một bản triển khai nuốt im lặng mảnh cụt cũng
xanh, mà nuốt im lặng chính là lỗi khó truy nhất về sau.
