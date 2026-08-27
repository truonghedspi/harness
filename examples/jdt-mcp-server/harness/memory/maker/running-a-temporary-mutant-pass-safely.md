# Chạy một lượt dựng mutant tạm: khôi phục bằng bản sao, không bằng git

**Khi nào áp dụng:** lượt maker được giao "oracle để sống mutant, hãy thêm ca kiểm thử", nơi bản
triển khai đã được checker xác nhận đúng và ta phải tạm làm hỏng nó để chứng minh ca mới có răng.
Gặp ở `feat-file-sync-watcher`, lượt 2.

## Ba điều dễ làm sai, xếp theo mức thiệt hại

### 1. `git checkout` không cứu được tệp chưa từng được commit

Bản triển khai của một tính năng đang chờ checker thường vẫn ở trạng thái untracked (`??` trong
`git status`). Lệnh khôi phục theo phản xạ — `git checkout -- <file>` — với tệp untracked không
khôi phục gì cả, và nếu lỡ dùng `git clean` thì mất trắng toàn bộ công sức của lượt trước.

Cách làm đúng: **chạy `git status --porcelain` trước khi dựng mutant đầu tiên.** Nếu tệp là
untracked, sao nó ra một chỗ ngoài cây nguồn, rồi cho mọi lệnh dựng mutant khởi đi từ bản sao đó
(sao đè lại, rồi mới thay chuỗi). Kết thúc lượt, `diff` bản sao với tệp nguồn phải rỗng — đây là
bằng chứng cơ học duy nhất chứng minh không còn mutant sót lại, mạnh hơn mọi lời khẳng định.

### 2. "Bằng chứng đỏ" của lượt này không cùng nghĩa với lượt xây tính năng

Ở lượt xây, đỏ nghĩa là chạy oracle trước khi có mã nguồn. Ở lượt sửa oracle, mã nguồn đã đúng, nên
một ca mới **phải** xanh ngay. Bằng chứng đỏ hợp lệ duy nhất là đỏ dưới đúng mutant mà ca đó nhắm
tới. Ghi vào evidence theo cặp: đỏ-dưới-mutant-X, rồi xanh-sau-khi-hoàn-nguyên.

Kèm một khẳng định phụ đáng giá: mutant X chỉ được giết đúng ca nhắm tới, các ca khác vẫn xanh. Nó
tái hiện đúng phát hiện của checker và chứng minh ca mới là thứ đóng khe hở, không phải trùng lặp
với ca sẵn có.

### 3. Ca xanh và đỏ đúng chỗ vẫn có thể là ca có chạy đua

Ca "chỉ còn một trường phân biệt" (ở đây: cùng size, cùng mtime, khác inode) chỉ chứng minh được
điều nó tuyên bố nếu ảnh nền được chốt một cách xác định. Bản đầu tiên của tôi chuẩn bị ảnh nền
**sau** `start()`; nó vẫn xanh trên mã đúng và đỏ dưới mutant, tức là đạt mọi tiêu chí bề mặt.
Nhưng một lần flush chen giữa `writeFileSync` và `utimesSync` sẽ khiến ảnh nền giữ mtime thật, và
khi đó mutant sống sót còn ca vẫn xanh. Tôi chỉ phát hiện nhờ đi truy nguyên nhân một lỗi flaky
khác, không phải nhờ thiết kế.

Quy tắc rút ra: đặt toàn bộ phần chuẩn bị **trước** khi bật thành phần quan sát, để lần quét khởi
động chốt ảnh nền. Và khẳng định thẳng bằng `statSync` rằng đúng một trường khác biệt — nếu không,
ca đang nói về một cơ chế khác với cơ chế nó tưởng.

## Dấu hiệu nhận biết đã làm đủ

Cuối lượt phải có đồng thời: `diff` với bản sao pristine rỗng, mỗi mutant kèm một dòng đỏ nêu đúng
tên khẳng định hoặc đúng chuỗi timeout, và các mutant của lượt trước được dựng lại để chứng minh
thay đổi hạ tầng dùng chung không làm cùn ca cũ.
