# `timeout` không có trên macOS: lượt dựng mutant im lặng và trông như đã chạy

**Khi nào áp dụng:** mọi script dựng mutant chạy trên máy này (darwin). Gặp ở `feat-tool-definition`,
lượt 1.

## Triệu chứng

Script dựng năm mutant in ra đúng năm tiêu đề `===== M1 ... =====`, rồi tới dòng
`OK: nguồn đã hoàn nguyên`. Không một dòng `not ok` nào, cũng không một dòng `# fail` nào. Đọc lướt
thì giống hệt "mọi mutant đều sống sót" — kết luận sai và tốn kém nhất có thể rút ra ở bước này.

## Nguyên nhân gốc

Dòng chạy có dạng `timeout 120 node --test ... | grep -E "^not ok|^# (tests|pass|fail)"`. macOS
không có `timeout` của GNU coreutils. Shell trả `command not found` ra stderr, `node` không bao giờ
chạy, `grep` nhận đầu vào rỗng và thoát im lặng. Vì mỗi lần chạy nằm trong một subshell và script
không bật `set -e` cho nhánh đó, mã thoát khác 0 không dừng gì cả.

Điều làm bẫy này khó thấy: một entry memory trước đó (`a-leaked-handle-turns-a-red-mutant-into-a-hang.md`)
khuyên gắn `timeout` + `killSignal` riêng cho mỗi lần chạy mutant. Lời khuyên đó đúng về nội dung —
mutant xoá đường dọn dẹp làm treo tiến trình test — nhưng công cụ nó nêu tên không tồn tại ở đây.

## Cách làm đúng

Dùng ngân sách của chính runner thay cho lệnh ngoài: `node --test --test-timeout=30000 <spec>`. Nó
có mặt cùng Node, cắt từng ca chứ không cắt cả tiến trình, và ca bị cắt vẫn in một dòng `not ok` có
tên. Khi bắt buộc cần cắt ở mức tiến trình, kiểm tra `command -v gtimeout || command -v timeout`
trước và dừng script nếu không có.

Kèm một lưới an toàn rẻ tiền: mỗi lần chạy mutant phải sinh ra **một dòng `# tests N`**. Nếu không
có dòng đó thì lần chạy ấy không hề diễn ra, và script phải kêu lên thay vì để người đọc suy ra
"mutant sống sót" từ một khoảng trắng.
