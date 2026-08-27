# "Cùng đường dẫn tương đối" không phải "cùng khoá cache"

Bối cảnh: `feat-prove-diagnostics`, TCON-DIAG-0003, bất biến INV-DIAG-3 ("một URI không bao giờ được
phục vụ từ cache của workspace khác").

## Điều đã đánh lừa

Cả `behavior` của tính năng, `falsifier` của nó, lẫn `rationale` của điều kiện đều dùng một cụm từ
đọc rất thuyết phục: *hai workspace cùng một đường dẫn tương đối*. Fixture làm đúng như vậy — hai
project root, mỗi root có `src/main/java/fixture/Sample.java`, hai JDT LS thật chạy song song, một
tệp hỏng và một tệp sạch. Ca xanh. Trông như một ca cách ly cross-workspace đắt tiền và nghiêm túc.

Nhưng khoá của cache là `(workspaceId, URI tuyệt đối)`. Cache không bao giờ nhìn thấy đường dẫn
tương đối. Hai URI tuyệt đối đã khác nhau ngay từ đầu, nên riêng URI đủ phân biệt và `workspaceId`
là thành phần khoá THỪA trên fixture này. Mutant bỏ hẳn `workspaceId` khỏi khoá (một Map phẳng dùng
chung) chạy 3/3 xanh. Mutant cho `get()` quét sang cache của mọi workspace khác cũng 3/3 xanh.

## Cách kiểm tra, áp dụng được cho mọi ca "hai X không lẫn sang nhau"

1. Đọc khoá THẬT trong mã, liệt kê từng thành phần của nó. Ở đây: `workspaceId` và `uri`.
2. Với mỗi thành phần, hỏi: fixture có giữ nó BẰNG NHAU giữa hai phía không? Chỉ thành phần được
   giữ bằng nhau mới bị ca kiểm thử đo. Thành phần nào khác nhau sẵn thì mutant xoá nó khỏi khoá
   sẽ sống sót.
3. Đừng tin cụm từ mô tả kịch bản. "Cùng tên", "cùng đường dẫn tương đối", "cùng định danh" là mô tả
   dành cho người đọc; khoá mới là thứ chương trình dùng. Chênh lệch giữa hai thứ đó chính là lỗ
   hổng.

## Trước khi gọi mutant là tương đương

Chạy oracle unit sẵn có của chính component đó trên mutant. Ở đây `test/lsp/diagnostics-cache.spec.ts`
(thuộc một tính năng đã `done`) giết cả hai mutant — 3 ca đỏ và 2 ca đỏ. Đó là bằng chứng dứt điểm
rằng mutant là khiếm khuyết thật và ca integration mù, chứ không phải mutant vô nghĩa. Đây là cách
rẻ nhất để tách "mutant tương đương" khỏi "oracle mù": tìm một oracle KHÁC trong repo đã biết giết
được nó.

## Hệ quả phụ đáng chú ý

Tính năng `prove` này còn để lọt một thay đổi mã sản phẩm (canonical hoá URI bằng `realpathSync`)
vào một component đã `done` và không nằm trong `touches`. Nhánh canonical hoá đó không được ca unit
nào chạm tới, vì mọi URI trong spec unit là chuỗi không tồn tại trên đĩa nên `realpathSync` luôn ném
lỗi và rơi vào nhánh fallback. Khi thấy `touches` chỉ có tệp test mà ghi chép của maker lại kể về
một sửa đổi trong `src/`, hãy kiểm tra ngay nhánh mới có ca nào chạy tới không.
