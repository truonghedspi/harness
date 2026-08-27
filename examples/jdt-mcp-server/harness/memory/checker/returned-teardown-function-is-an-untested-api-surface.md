# Hàm dọn dẹp trả về là một bề mặt API thứ hai, thường không ca nào chạm tới

**Khi nào áp dụng:** một phương thức trả về hàm để gỡ/dừng/huỷ — `onNotification()` trả hàm gỡ đăng ký,
`attach()` trả hàm detach, `createWatcher()` trả hàm close. Gặp ở `feat-lsp-notifications` (2026-08-23);
codebase này đã có ít nhất ba chỗ cùng hình dạng.

## Vì sao nó lọt

Ca kiểm thử tự nhiên viết theo *chiều đi*: đăng ký handler, bắn sự kiện, khẳng định handler chạy. Giá trị
trả về bị bỏ qua ở mọi ca, vì nó không cần thiết để dựng tình huống. Kết quả: thay toàn bộ thân hàm trả
về bằng `return () => {};` mà 9/9 ca vẫn xanh. Bằng chứng duy nhất còn lại là "tsc nói kiểu trả về tương
thích" — đó là chữ ký, không phải hành vi.

Thêm một bẫy đi kèm: hàm gỡ và vòng lặp dispatch là **một cơ chế ghép đôi**. Ở đây `onNotification` gỡ
bằng `splice`, còn dispatch lặp trên `[...handlers]`. Bỏ ảnh chụp cũng sống sót, vì tình huống duy nhất
phân biệt được nó — handler tự gỡ mình *ngay trong lúc* dispatch — chỉ dựng được nếu ca kiểm thử chịu gọi
hàm trả về. Một axis không được chạm làm chết hai mutant cùng lúc.

## Hai mutant cần dựng, mỗi khi thấy hình dạng này

1. **`return () => {};`** — thân hàm dọn dẹp thành rỗng. Nếu suite vẫn xanh, toàn bộ đường gỡ chưa được
   chứng minh.
2. **Gỡ ngay trong lúc dispatch** — bỏ ảnh chụp danh sách (`[...handlers]` → `handlers`), rồi dựng ca có
   handler tự gọi hàm gỡ của chính nó giữa lúc lặp. `splice` dịch mảng và sibling kế tiếp bị bỏ qua im
   lặng. Đây là lỗi thật, không phải mutant tương đương — luôn chạy probe trên bản pristine trước để
   chứng minh khác biệt hành vi có thật.

## Cách đọc nhanh

Đọc kiểu trả về của mọi phương thức công khai trong diff. Với mỗi phương thức trả về `() => void`, tìm
trong spec chuỗi gọi giá trị trả về đó. Không tìm thấy lần nào ⇒ đã có sẵn một mutant sống sót, không
cần chạy cũng biết. Đây là trục thứ tư, bổ sung cho ba trục ở
`maker-authored-mutants-cover-only-branches-he-wrote.md`.
