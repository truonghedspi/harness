# Cấp ngân sách ở lớp test mới chặn được nửa cơn treo

**Khi nào áp dụng:** checker báo một mutant làm bộ chạy TREO thay vì đỏ, và yêu cầu bạn biến nó
thành một ca đỏ có kiểm soát. Gặp ở `feat-daemon-supervisor` lượt 2, mutant DM10 (shutdown không
`destroy()` các connection đã accept, nên `server.close()` không bao giờ gọi callback).

## 1. Ngân sách trong móc `t.after` chữa triệu chứng, không chữa nguyên nhân

`node --test` áp `{ timeout }` cho **thân** hàm kiểm thử, không áp cho móc `t.after`. Nên bước đầu
tiên ai cũng nghĩ tới là bọc `shutdown()` trong `Promise.race` với một bộ đếm giờ. Việc đó có tác
dụng: cả 9 ca đều báo đỏ với thông điệp có tên, trong vài giây.

Nhưng tiến trình **vẫn không bao giờ thoát**. Đo được: mọi ca đã in kết quả, rồi bộ chạy đứng im
cho tới khi tôi SIGKILL ở 120 giây. Lý do là tài nguyên rò rỉ không phải một promise — nó là một
`net.Server` còn listening với connection còn mở, và nó giữ event loop sống sau khi test kết thúc.
Ngân sách phía test buông promise ra chứ không đóng được server, vì tập connection là riêng tư của
bản triển khai.

Quy tắc rút ra: **hỏi tài nguyên nào đang giữ event loop, đừng chỉ hỏi lời `await` nào đang treo.**
Nếu tài nguyên đó nằm trong `src`, hạn chót phải nằm trong `src`.

Ở đây lời sửa là cho `closeServer` một hạn cưỡng bức: hết `FORCE_CLOSE_AFTER_MS` thì `destroy()`
mọi connection còn lại, buộc `close()` hoàn tất. Đây không phải nới lỏng gì cả — nó chính là bất
biến đang xét: trình xử lý tín hiệu gọi `shutdown()`, nên một `server.close()` kẹt khiến daemon
không bao giờ thoát và bỏ lại toàn bộ tiến trình con, tức đúng điều INV-SHIM-4 cấm.

Lưu ý API: `net.Server` **không** có `closeAllConnections()`; đó là API của `http.Server`. Tập
connection do chính component ghi nhận là cách kế toán duy nhất.

## 2. Hạn cưỡng bức sẽ giết chết chính ca vừa dựng, nếu không tách hai con số

Thêm đường cưỡng bức vào `src` làm mutant hết treo — nhưng cũng suýt làm nó hết đỏ. Dưới DM10, mã
rơi xuống đường chậm, connection vẫn bị đóng, mọi khẳng định về kết quả vẫn đúng. Mutant trở thành
**tương đương**, và ca vừa viết mất sạch sức phân biệt.

Cách giữ: cho ca đòi hỏi shutdown xong trong một ngân sách nằm **hẳn dưới** hạn cưỡng bức (1000 ms
so với 2000 ms). Đường nhanh phải xong trong vài ms; chạm tới đường cưỡng bức tự nó đã là thoái
hoá. Đường cưỡng bức là lưới an toàn, không phải đường đi thường, và ca phải nói đúng điều đó.

Tổng quát: mỗi khi thêm một fallback để chặn treo, tìm ngay con số phân biệt fallback với đường
thường, rồi khẳng định con số đó. Nếu không tìm được, fallback vừa che mất một mutant.

## 3. Mutant làm cạn event loop huỷ cả tệp, không đỏ một ca

Bản đầu của ca khoá mồ côi không bọc ngân sách. Dưới mutant DM5, `startDaemon` lặp chờ khoá, và
`sleep()` trong vòng lặp đó dùng timer đã `unref()`. Không còn gì ref, event loop cạn, và
`node --test` huỷ **bốn ca** với `Promise resolution is still pending but the event loop has
already resolved` — 4 cancelled, 0 fail, không ca nào nêu tên khẳng định của nó.

Đây trông như lỗi hạ tầng nhưng là hệ quả trực tiếp của mã nguồn: mọi vòng chờ dựng trên timer đã
unref đều biến "chờ lâu" thành "tiến trình thoát sớm". Bộ đếm giờ **có ref** của `withBudget` giữ
event loop sống đủ để hạn của nó nổ, và kết quả trở thành đúng một ca đỏ có tên.

Dấu hiệu nhận biết: `# cancelled` khác 0 trong khi `# fail` bằng 0. Đừng đọc nó là "flaky"; đọc nó
là "có ai đó vừa để event loop cạn".

## 4. Chú thích "cửa chặn này tồn tại vì X" đáng để đo lại

Chú thích của `MAX_SOCKET_PATH_LENGTH` nói đường dẫn quá dài "fails deep inside libuv with an opaque
error". Đo trên Node 22.23.2 / macOS: sai hẳn. `listen()` trên đường dẫn 234 byte **trả về thành
công**, `server.listening` là true, `address()` trả lại nguyên đường dẫn dài — nhưng libuv cắt cụt
tên vào `sun_path` nên không có tệp socket nào ở đường dẫn được yêu cầu. Vì `probeDaemon` mở đầu
bằng `existsSync(socketPath)`, cửa đó mãi mãi sai và không launcher nào sau đó thấy được daemon.

Hệ quả thật nguy hiểm hơn nhiều so với điều chú thích mô tả, và nó chỉ lộ ra khi dựng mutant bỏ cửa
chặn rồi hỏi "chuyện gì thật sự xảy ra". Khi một ca phải chứng minh cửa chặn chịu lực, hãy đo hành
vi khi vượt ngưỡng trước, đừng tin lời chú thích viết cạnh nó.
