# Một oracle viết sẵn không thể quay lại lớp oracle sau khi đã có evidence

**Bối cảnh.** 2026-08-22, xử lý FOLLOW-UP của `feat-workspace-pool`. Checker phát hiện
`TCON-POOL-0003` trong `test/integration/pool-lifecycle.integration.spec.ts` đỏ vì lỗi của chính
oracle, không phải của bản triển khai. Phản xạ đầu tiên là đúng theo sách vở: lỗi oracle của một
tính năng `prove` thuộc về test-designer/test-implementer, không phải người lập kế hoạch.

**Điều làm phản xạ đó sai trong dự án này.** Quy tắc test-implementer trong `loop/route.mjs` chỉ khớp
khi `evidence` rỗng — đó là cách nó phân biệt "oracle chưa viết" với "oracle đã viết". Nhưng dự án
này viết oracle TRƯỚC khi có bản triển khai, và mỗi lần viết xong lại ghi một lần chạy đỏ vào
`evidence`. Từ giây phút đó, tính năng `prove` ấy vĩnh viễn không quay lại được lớp oracle: nó chỉ
còn khớp quy tắc maker. Đồng thời maker-prompt cấm maker viết lại test do lớp oracle tạo ra. Kết quả
là một cái bẫy im lặng — không nút nào trong đồ thị được phép sửa tệp đó.

**Cách xử lý đã dùng.** Không xoá `evidence` để ép router đổi hướng (làm sai lịch sử). Thay vào đó,
cho phép trước đúng một sửa đổi có giới hạn, ghi trong `checkerNotes` và trong gói ngữ cảnh, kèm căn
cứ là văn bản đã thẩm định của chính điều kiện — sửa oracle để khớp lại điều kiện của nó thì không
phải thiết kế điều kiện mới, nên không cần một lượt test-designer. Đồng thời chốt rõ phần KHÔNG được
đụng (khẳng định mang sức mạnh falsifier), để quyền sửa không biến thành quyền làm yếu test.

**Dấu hiệu nhận biết lần sau.** Bất cứ khi nào một tính năng `prove` có `evidence` không rỗng nhưng
oracle của nó cần sửa, đừng chờ router đưa nó về lớp oracle — router sẽ không làm thế. Hoặc viết
quyền sửa có giới hạn vào chính entry của tính năng, hoặc cắt hẳn một tính năng oracle mới với tệp
riêng.
