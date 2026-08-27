# Mutant sống sót mà maker khai là "tương đương"

**Khi nào áp dụng:** maker báo cáo một mutant SỐNG SÓT nhưng lập luận đó là mutant tương đương
(equivalent mutant), thường trên mã phòng vệ: bộ đếm giờ dự phòng, nhánh fallback, lớp bảo hiểm.
Gặp ở `feat-daemon-supervisor` lượt 3 (2026-08-23), mutant "làm rỗng thân bộ đếm giờ buộc-đóng".

## Vì sao đây là một quyết định thật, không phải chuyện vặt

Hai lối tắt đều sai. Bắt maker dựng một ca để giết bằng được thì ca đó chỉ có thể là mock — phải
dàn dựng một trạng thái mà mã đúng không bao giờ tạo ra, tức là kiểm thử theo mutant dẫn dắt.
Ngược lại, tin ngay lời khai "tương đương" thì mọi mutant sống sót đều có một lời bào chữa sẵn.

## Ba phép kiểm tra trước khi chấp nhận

1. **Dựng lại mutant.** Nó phải sống sót đúng như báo cáo, trên bản sao mã hiện tại.
2. **Đọc cửa sổ đồng bộ.** Lập luận tương đương hầu như luôn có dạng "trạng thái X luôn rỗng khi
   tới đó". Xác minh bằng mắt trên mã: liệt kê mọi câu lệnh giữa điểm làm rỗng X và điểm dùng X,
   và tìm một `await` chen giữa. Không có await nghĩa là không callback nào xen vào được. Ở ca này,
   trình tự là `destroy tất cả` -> `connections.clear()` -> `server.close()` trong đúng một lượt
   event loop, và `close()` đóng listening handle tức thì nên không còn sự kiện connection nào nữa.
3. **Probe của chính mình, không phải số đo của maker.** Ghi stderr ở điểm vào và trong thân nhánh
   nghi là không thể tới. Ở ca này: 8/8 lần vào với tập rỗng, thân bộ đếm giờ không chạy lần nào.

Đủ ba phép thì mutant tương đương là kết luận hợp lệ, và cách xử lý đúng là **hạ cấp chú thích**:
khối chú thích không được tuyên bố nhánh đó là cơ chế bảo đảm một invariant, mà phải ghi rõ nó là
dự phòng chưa được chứng minh, kèm số đo. Giữ mã lại vẫn hợp lý nếu có một mutant thoái hoá khác
(ở đây là DM10) mà nhánh đó biến một lần treo thành một ca đỏ có ngân sách.

## Điều dễ bỏ sót

Một mutant sống sót vô hại về hành vi vẫn nên đo chứ đừng suy đoán. Ví dụ cùng lượt: bỏ
`process.removeListener` của các tín hiệu trong `shutdown()` cũng sống sót. Câu hỏi thật là listener
tín hiệu có giữ event loop sống không — đo một dòng
(`node -e 'process.once("SIGTERM", () => {}); console.log("x")'` thoát ở 32 ms) trả lời dứt điểm là
không, nên nó vô hại. Không đo thì đây trông y hệt một lỗ hổng đáng chặn.
