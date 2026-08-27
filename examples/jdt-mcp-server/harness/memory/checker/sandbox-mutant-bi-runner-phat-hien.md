# Sandbox mutant nằm trong repo bị chính test runner phát hiện

**Bối cảnh.** Lượt soi `feat-prove-daemon-lifecycle`. Prompt yêu cầu dựng sandbox trong
`harness/trace/scratch/`, nên tôi sao chép `src/`, `test/`, `package.json` vào
`harness/trace/scratch/dlc/base`, rồi tạo mỗi mutant thành một thư mục `run-M*` riêng (mỗi thư mục
mang một bản `src/` đã hỏng có chủ ý).

**Hiện tượng.** Bước cuối của lượt soi chạy `npm run test:integration` không tham số. Kết quả:
`tests 1722, pass 1623, fail 99`, và trong danh sách đỏ có cả `TCON-SHIM-0001` — đúng ca đang được
phê duyệt. Nhìn qua thì đây là bằng chứng mạnh để REJECT.

**Nguyên nhân gốc.** `package.json` khai `"test:integration": "node --experimental-strip-types --test"`
— không có đường dẫn. `node --test` không tham số quét đệ quy toàn bộ cây thư mục làm việc, nên nó
tìm thấy 11 bản sao `test/` trong sandbox của chính tôi, mỗi bản chạy trên một `src/` đã bị đột biến.
Con số 13 lần lặp của cùng một tên ca là dấu hiệu: một dự án chỉ có một tệp thì không thể có 13 lần.
Sau khi xoá `harness/trace/scratch/dlc`, đúng lệnh ấy trả về `tests 123, pass 123, fail 0`.

**Bài học.**

1. Trước khi coi một lượt chạy toàn bộ suite là bằng chứng, hãy đối chiếu SỐ LƯỢNG ca với số ca đã
   biết của dự án. Số ca phình lên gấp mười lần là dấu hiệu của quét trùng, không phải của hồi quy.
2. Tên ca lặp lại N lần trong cùng một lượt chạy luôn là lỗi khám phá tệp, không bao giờ là lỗi
   hành vi.
3. Sandbox của checker phải bị xoá TRƯỚC khi chạy bất kỳ lệnh nào quét cả cây thư mục. Nếu cần giữ
   sandbox để chạy tiếp, hãy đặt nó ngoài thư mục làm việc của runner, hoặc chạy suite bằng đúng
   glob mà evidence đã ghi (`test/integration/*.integration.spec.ts`).
4. Hệ quả ngược cũng đúng và đáng cảnh giác: một lệnh `--test` không tham số có thể nuốt cả tệp
   không thuộc dự án. Khi maker ghi evidence bằng lệnh dạng này, hãy hỏi lệnh ấy thực sự đã chạy
   những tệp nào.
