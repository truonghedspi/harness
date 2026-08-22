# Maker memory — JDT MCP Server

Index of what the maker agent has learned across runs (`harness/docs/reference/agent-memory.md` documents the schema and why). One line per entry, always loaded — keep it
short; the reasoning lives in the linked file, read that only when the line looks relevant.

Write a new entry when a checker rejection, a failed reproduction, or a recurring review comment
teaches something the *next* maker run on this project shouldn't have to rediscover. Don't write
one for routine, expected outcomes — that's noise, not a lesson.

<!-- - [Title](slug.md) — one-line hook -->
- [Đếm tiến trình con phải dùng một file log cho mỗi child](counting-spawns-needs-one-log-file-per-child.md) — fixture ghi chung một file bằng `>>` bị xen kẽ ở mức syscall, làm oracle đếm thiếu tiến trình và đổ lỗi nhầm cho mã nguồn; ghi ra `"$LOGDIR"/"$$".txt` và chờ một khoảng lắng trước khi khẳng định "đúng một tiến trình".
- [Process-boundary Level 3 oracle for a build feature](process-boundary-oracle-for-build-features.md) — checker rejection for an in-process mock on a real spawn/exit boundary is the maker's own oracle to write (build-kind), not test-designer's; materialize scripted child fixtures to a tmpdir at test run time, and red-prove the oracle by temporarily breaking the exact source behavior before trusting green.
