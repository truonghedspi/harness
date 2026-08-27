# Một mutant thứ tự chỉ tương đương khi cả kẻ kế nhiệm cũng không quan sát được

**Bối cảnh:** FOLLOW-UP của `feat-tool-layer-core` (2026-08-25). Checker dựng mutant N1 — đảo
`spawned.stop()` lên trước `#runDetachments(victim)` trong `#evict` của `workspace-pool.ts` — và nó
sống sót 28/28. Lập luận tương đương nghe rất vững: hàm detach làm CẢ `detach()` lẫn
`cache.forget(workspaceId)`, nên một publish chen vào giữa `stop()` vẫn bị `forget()` xoá sạch ngay
sau đó. Trạng thái cuối của cache giống hệt nhau ở cả hai thứ tự.

**Lập luận đó sai, và đo ra mới thấy.** Nó chỉ xét một người quan sát: chính workspace đang chết.
Người quan sát thứ hai là workspace KẾ NHIỆM. `#identify` băm `sha256(canonicalRoot)`, nên
`workspaceId` là hàm của project root chứ không của thế hệ tiến trình; `#evict` xoá entry khỏi
`#entries` TRƯỚC khi dọn dẹp, nên một `acquire` song song cùng root spawn tiến trình mới dưới đúng
cái id đó. Ở thứ tự đảo, `cache.forget()` muộn của kẻ tiền nhiệm xoá cache của kẻ kế nhiệm — mất dữ
liệu thật, không phải trạng thái thoáng qua.

**Quy tắc rút ra khi phân loại một FOLLOW-UP dạng "mutant nhiều khả năng tương đương":**

1. Hỏi tài nguyên bị dọn dẹp được khoá theo cái gì. Nếu khoá theo IDENTITY (đường dẫn, hash của
   root, tên logic) chứ không theo THẾ HỆ (pid, đối tượng tiến trình), thì luôn còn một người quan
   sát nữa và lập luận "trạng thái cuối giống nhau" chưa đủ.
2. Hỏi cửa sổ nhường rộng bao nhiêu so với thời gian dựng lại. Ở đây `terminate()` chờ tiến trình
   con thoát trong hạn ân xá 5 000 ms, còn cold start ~2 300 ms — kẻ kế nhiệm kịp ra đời trong cửa
   sổ đó.
3. Đo, đừng đọc. Chép `src/` sang thư mục nháp ngoài cây nguồn, vá mutant vào bản chép, chạy một
   probe ~60 dòng với spawner giả. Mất vài phút và cho ra một câu trả lời nhị phân; repo không bị
   đụng một byte.

**Hệ quả cho cách viết chú thích:** chú thích cũ nêu SAI mối nguy (notification muộn rơi vào cache
của workspace đang chết). Chính vì nó nêu sai mà không mutant nào falsify được nó. Một câu chú thích
không falsify được là dấu hiệu nó đang mô tả nhầm cơ chế, không phải dấu hiệu cơ chế không quan trọng.
