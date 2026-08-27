# Mutant hỏng cú pháp cho một màu đỏ rỗng nghĩa — và TAP giấu điều đó rất khéo

**Khi nào áp dụng:** mọi lượt checker tự dựng mutant trên dự án chạy TypeScript bằng
`node --experimental-strip-types`. Gặp ở `feat-tool-layer-core` lượt 2 (2026-08-25).

## Cái bẫy

Tôi dựng mutant A1 để đo tác dụng của một mỏ neo dương: cho vòng lặp attachment chạy trên mảng rỗng.

```ts
for (const attach of [] as typeof this.#attachments) {
```

Kết quả trả về trông y hệt một mutant bị giết:

```
not ok 2 - test/workspace/workspace-attachments.spec.ts
not ok 3 - test/workspace/workspace-pool.spec.ts
# tests 17
# pass 15
# fail 2
```

Có `not ok`, có `fail 2` — nếu chỉ `grep "^not ok"` như tôi đang làm thì kết luận là "mutant chết,
oracle có sức phân biệt". Thực tế mutant chưa bao giờ chạy: `--experimental-strip-types` không phải
trình biên dịch TypeScript đầy đủ, nó từ chối `typeof this.#privateField` ở vị trí kiểu với
`SyntaxError [ERR_INVALID_TYPESCRIPT_SYNTAX]: Expected ident`. Tệp không nạp được, nên oracle không
phán xét gì cả.

## Dấu hiệu nhận ra, rẻ và dứt khoát

**Tên của dòng `not ok` là ĐƯỜNG DẪN TỆP, không phải tên ca.** Khi một tệp spec không nạp được,
`node --test` báo cả tệp là một "test" và tên nó chính là đường dẫn. Đi kèm luôn là tổng số ca tụt
xuống bất thường (ở đây 28 → 17): số ca của những tệp nạp được, cộng vài dòng cấp tệp.

Ba việc rút ra, làm ngay trong vòng lặp mutant:

1. Bộ lọc đầu ra phải giữ lại `error:` và `ERR_INVALID_TYPESCRIPT_SYNTAX`, không chỉ `^not ok`.
2. Luôn đối chiếu `# tests` của mutant với `# tests` của m0. Khác nhau ⇒ nghi ngờ lỗi nạp tệp trước
   khi nghi ngờ hành vi (cùng họ với bài học ở `sandbox-mutant-bi-runner-phat-hien.md`, chỉ ngược
   chiều: ở đó số ca phình lên, ở đây nó teo lại).
3. Viết mutant bằng JavaScript thuần, đừng bằng chú giải kiểu. `[] as T` ⇒ `.slice(0, 0)`;
   `as any` ⇒ bỏ hẳn; ép kiểu ⇒ đổi giá trị. Mutant sửa **hành vi**, không sửa **kiểu**, nên nó
   không bao giờ cần cú pháp kiểu — và mọi cú pháp kiểu đều là một dịp để trình strip-types từ chối.

Sau khi đổi sang `this.#attachments.slice(0, 0)`, mutant chạy thật và cho câu trả lời tôi cần: ca đỏ
ĐÚNG tại dòng mỏ neo với đúng thông điệp của mỏ neo, tức mỏ neo có tác dụng — kết luận ngược hẳn về
chất lượng bằng chứng so với màu đỏ rỗng nghĩa lúc đầu.
