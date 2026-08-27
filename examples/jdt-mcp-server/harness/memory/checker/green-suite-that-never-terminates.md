# Bộ ca xanh hết nhưng tiến trình không bao giờ thoát

**Khi nào áp dụng:** mọi tính năng sở hữu một tài nguyên cấp hệ điều hành giữ event loop sống —
server đang listen, socket, watcher, tiến trình con — và có một hàm `shutdown()`/`close()` trả về
promise. Gặp ở `feat-daemon-supervisor` (2026-08-23), ngay lượt maker vừa vá xong một lỗi treo khác.

## Vì sao ghi chú cũ chưa đủ

Ghi chú `test-timeout-does-not-cover-the-after-hook.md` nói về một `await` KHÔNG settle trong móc
`t.after`. Maker đã vá đúng lớp đó: mọi lời gọi shutdown đi qua một hàm `withBudget` có
`Promise.race` với bộ đếm giờ, nên quá hạn thành một ca đỏ có tên.

Lớp còn lại nằm ở phía đối diện và `withBudget` không thấy được: **shutdown settle SỚM rồi bỏ lại
tài nguyên còn sống.** Không có gì để chờ, nên không có gì để đặt ngân sách. Mọi khẳng định đều xanh,
bộ chạy in đủ `ok 1..9`, rồi đứng im vì handle listening vẫn giữ event loop. Không có dòng tóm tắt,
không có mã thoát, không có ca đỏ.

## Mutant rẻ nhất phát hiện ra nó

Đúng phép thử mà checker-prompt yêu cầu: lật một phép so sánh. Trong hàm đóng server có một lối ra
sớm dạng `if (!server.listening) { resolve(); return; }`. Đổi thành `if (server.listening)`. Kết
quả: 9/9 xanh, tiến trình phải SIGKILL ở 40 s.

Bẫy suy luận cần tránh: mọi khẳng định gián tiếp vẫn đúng dưới mutant này. Tệp socket vẫn bị unlink,
khoá vẫn được giải phóng, mọi tiến trình con vẫn bị dừng, launcher tiếp theo vẫn bind được. Chỉ
riêng handle listening là còn sống, và không API công khai nào của component để lộ nó.

## Cách đo an toàn cho chính agent

Không bao giờ chạy trần lệnh test khi đang dựng mutant lớp này. macOS không có `timeout`, nên dùng
một bộ chạy tự viết: `spawn(cmd, { detached: true })` rồi `process.kill(-pid, "SIGKILL")` khi quá
hạn — giết cả process group, vì tiến trình con do spec spawn ra sẽ sống sót nếu chỉ giết tiến trình
cha. Một phiên checker trước đó đã tự kẹt agent của mình đúng ở chỗ này.

## Điều kiện đòi hỏi trong `checkerNotes`

Đòi một ca chứng minh **tiến trình thoát được**, không phải một ca chứng minh hàm shutdown trả về:
spawn tiến trình con chạy component rồi gọi shutdown, khẳng định nó thoát với mã 0 trong một ngân
sách rõ ràng, quá hạn thì kill và báo đỏ có tên. Bằng chứng cần có là ca đỏ trong ngân sách dưới
mutant lật phép so sánh, không phải một lần chạy xanh.
