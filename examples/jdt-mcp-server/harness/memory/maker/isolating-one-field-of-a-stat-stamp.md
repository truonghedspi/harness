# Cô lập từng trường của bộ ba `(mtimeMs, size, ino)`: ghi tại chỗ, không temp+rename

**Khi nào áp dụng:** oracle phải chứng minh một phép so sánh nhiều vế thật sự cần từng vế. Gặp ở
`feat-file-sync-watcher`, lượt 3, sau khi checker chỉ ra rằng mười hai ca chỉ ghim được một trong ba
vế của phép quyết định `Changed`.

## Vì sao ca temp-write-then-rename không bao giờ ghim được mtime hay size

Lối ghi `writeFileSync(temp) → renameSync(temp, đích)` đổi inode ở **mọi** trường hợp. Ca dùng lối đó
luôn có ít nhất một vế đủ để làm phép hợp đúng, nên xoá vế `mtimeMs` hay vế `size` khỏi mã nguồn
không làm ca nào đỏ. Muốn cô lập một trường thì phải bỏ hẳn lối rename.

Đòn bẩy là hành vi của `writeFileSync` lên một đường dẫn **đã tồn tại**: trên macOS nó mở tệp với
`O_TRUNC` và không `unlink`, nên inode giữ nguyên. Đo được:

| Thao tác | ino | size | mtimeMs |
|---|---|---|---|
| `writeFileSync(p, nội dung cùng số byte)` | giữ nguyên | giữ nguyên | đổi |
| `writeFileSync(p, nội dung khác số byte)` rồi `utimesSync(p, mốc cũ, mốc cũ)` | giữ nguyên | đổi | giữ nguyên |

Hai dòng đó là hai ca, mỗi ca giết đúng một mutant. Đây cũng là lối ghi phổ biến nhất trong thực tế,
không phải trường hợp biên: một editor sửa tại chỗ, và `cp -p` / `rsync --times` / `git checkout` đều
khôi phục mtime cũ.

## Hai chi tiết khiến ca xác định thay vì may rủi

1. **Đóng băng mốc nền vào quá khứ, trước khi bật thành phần quan sát.** Nếu mốc nền là "bây giờ" thì
   ca chỉ đúng khi filesystem có độ phân giải mtime đủ mịn. Đặt `utimesSync(p, new Date(1_700_000_000_000), ...)`
   **trước** `start()` khiến mtime mới (năm hiện tại) khác mốc nền hàng năm trời, đúng với mọi độ
   phân giải, và để lần quét khởi động chốt ảnh nền thay vì đua với một flush.
2. **`writeFileSync` rồi `utimesSync` phải nằm trong cùng một khối đồng bộ.** Không có `await` ở giữa
   thì không callback `setTimeout` nào chen vào được, nên watcher chỉ có thể quét trạng thái đã hoàn
   tất — mtime đã được trả về. Nếu để lọt một `await` vào giữa, một lần flush chen ngang sẽ thấy mtime
   trung gian, ca vẫn xanh, còn mutant "bỏ vế size" thì sống.

Luôn khẳng định trực tiếp bằng `statSync` trước/sau rằng đúng một trường khác biệt. Không có khẳng
định đó, ca đang nói về một cơ chế khác với cơ chế nó tưởng.

## Bẫy đo lường: thời lượng ca không phải bằng chứng về ca

Một lần chạy dưới mutant báo 209 s cho ca đang đỏ, vượt xa `{ timeout: 30000 }`. Bốn lần đo lại khi
máy rảnh đều cho đúng 15,14 s. Nguyên nhân là load average trên 5 do các agent khác chạy suite song
song. Trước khi đi tìm lỗi treo trong tệp spec, hãy chạy lại lúc máy rảnh và xem `uptime`.
