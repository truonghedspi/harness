# Hai lớp canh gác cho cùng một thời hạn làm mutant sống sót mà oracle vẫn xanh

**Khi nào áp dụng:** thành phần nào có một thời hạn (deadline) được siết ở nhiều hơn một chỗ —
readiness-gate, lsp-client, mọi vòng lặp poll có timeout riêng cho từng request. Gặp ở
`feat-readiness-gate`, lượt 1.

## Triệu chứng

Mutant nhắm đúng falsifier của `INV-READY-3` — xoá `settleBy(probe, at)` và `await` thẳng vào probe —
chạy ra **6/6 xanh**. Không phải oracle viết ẩu: bốn ca kia đều giết mutant khác đúng như thiết kế.

## Nguyên nhân gốc

Bản triển khai siết thời hạn ở hai chỗ độc lập:

1. vòng lặp trong `awaitReady` đua probe với thời hạn của người gọi (`settleBy`);
2. `#probeOnce` kẹp `timeoutMs` của chính request về `min(probeTimeoutMs, at - Date.now())`.

Với probe mặc định, lớp 2 một mình đã đủ làm mọi ca settle đúng hạn, nên xoá lớp 1 không đổi hành vi
quan sát được. Oracle không yếu — nó chỉ không có ca nào đi qua vùng mà **chỉ lớp 1** phủ.

Vùng đó có thật và nguy hiểm: `probe` là tham số tiêm được (`ReadinessGateOptions.probe`), nên một
probe do thành phần khác cung cấp có toàn quyền bỏ qua `timeoutMs`. Khi đó chỉ còn lớp 1 giữ lời hứa
`INV-READY-3`, và mutant đã xoá đúng nó.

## Quy tắc rút ra

Khi một mutant nhắm đúng falsifier mà vẫn sống, **đừng vội kết luận mutant tương đương**. Hỏi ngược:
cơ chế bị xoá có phải là cơ chế duy nhất giữ bất biến đó không? Nếu không, tìm đầu vào làm cơ chế còn
lại mất hiệu lực — thường là đúng cái seam mà thành phần cho phép tiêm từ ngoài — rồi viết ca cho
đúng đầu vào đó. Ca mới ở đây là một probe tiêm vào không bao giờ settle và cố tình bỏ qua ngân sách
thời gian; dựng lại mutant thì ca đó treo và bị `node --test` huỷ, tức mutant bị bắt.

Dấu hiệu đọc kết quả: `node --test` báo mutant kiểu treo bằng `pass N / cancelled M` kèm
`Promise resolution is still pending but the event loop has already resolved`, chứ không phải bằng
một `ERR_ASSERTION`. Đó vẫn là bằng chứng đỏ hợp lệ cho một bất biến về "phải settle trong hạn" —
treo chính là hành vi mà bất biến cấm.
