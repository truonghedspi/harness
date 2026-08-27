# Mutant do maker tự dựng chỉ phủ nhánh chính maker đã viết

**Khi nào áp dụng:** mọi tính năng `kind: build` mà maker viết cả implementation lẫn unit test của
chính nó, rồi nộp một danh sách mutant tự dựng làm bằng chứng cho sức phân biệt của oracle. Gặp lần
đầu ở `feat-file-sync-watcher` (2026-08-22).

## Vì sao danh sách mutant của maker trông thuyết phục mà vẫn hụt

Bốn mutant maker khai báo đều tái hiện đúng từng chữ. Không mutant nào bịa. Vấn đề nằm ở chỗ khác:
cả bốn đều đánh vào một nhánh `if` mà maker vừa gõ ra vài phút trước. Người viết code chọn mutant từ
bản đồ nhánh trong đầu mình, nên tập mutant đó chứng minh đúng thứ oracle vốn đã phủ. Nó không thể
chỉ ra trục nào chưa ai nghĩ tới.

Ở lần đó, năm mutant do checker tự dựng đều sống sót với 8/8 xanh, trong khi bản triển khai hoàn
toàn đúng. Lỗ hổng thuộc về oracle, không thuộc về mã nguồn — nhưng falsifier của tính năng vẫn
không được chứng minh.

## Ba trục nên dựng mutant, ngoài bản đồ nhánh của maker

1. **Hằng số giao thức mà test nhập lại từ chính module đang phán xét.** Đây là R-T3 ở dạng khó
   thấy nhất. Nếu mọi khẳng định đều so với `FileChangeType.Created` nhập từ module đó, thì đổi
   `{ Created: 1, Deleted: 3 }` thành `{ Created: 3, Deleted: 1 }` sẽ sống sót: oracle chỉ chứng
   minh nhãn nhất quán với chính nó, không chứng minh số nguyên đặt lên dây. Cách bắt: đọc chú thích
   trích dẫn spec ngay trên hằng số, rồi hỏi ca nào ghim literal của spec thay vì ghim tên hằng số.
2. **Cơ chế mà chính lời giải thích của maker gọi là chịu lực.** Ghi chú thiết kế khẳng định vế
   `ino` là điểm khiến pattern ghi-tạm-rồi-đổi-tên hiện ra "kể cả khi kích thước không đổi". Xoá vế
   `ino`: vẫn xanh, vì mọi ca đều ghi nội dung khác độ dài. Quy tắc rút ra: mỗi câu "X là lý do thiết
   kế này chạy đúng" phải có một ca đỏ khi thiếu X. Nếu không, X là lời khẳng định chứ không phải
   hành vi đã được chứng minh.
3. **Hình dạng fixture mà mọi ca cùng chia sẻ.** Cả tám ca dùng một module, một source root
   `src/main/java`, một `pom.xml` ở gốc. Ba mutant thu hẹp tập được theo dõi (chỉ pom gốc; bỏ
   `src/test/java`; bỏ luật infix cho reactor) cùng sống sót vì không fixture nào có hình dạng thứ
   hai. Đây là R-T9 nhìn từ dữ liệu thay vì nhìn từ mã: đọc hằng số cấu hình và chú thích tuỳ chọn
   của component, rồi đếm xem mỗi giá trị trong đó được ca nào chạm tới.

## Cách dựng rẻ và an toàn

Chép `src/<file>.ts` và spec vào `harness/trace/scratch/<slug>/`, đổi import tương đối của bản sao
source về `../../../../src/...`, đổi import của bản sao spec về bản sao source. Luôn chạy một bản
đối chứng `m0` không đột biến trước: nếu `m0` không xanh đúng số ca như bản gốc, bản sao sai và mọi
kết luận sau đó vô nghĩa. Xoá thư mục sau khi xong; các ca còn thiếu ghi thành yêu cầu cụ thể trong
`checkerNotes`, không để lại kịch bản.
