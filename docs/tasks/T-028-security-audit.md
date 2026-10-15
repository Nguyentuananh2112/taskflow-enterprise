# T-028 — Rà soát bảo mật toàn hệ thống trước Phase 5

**Giao cho:** Engineer B (`taskflow-enterprise-87`) · **Phase:** 4–5 · **Phụ thuộc:** main ≥ 99e9041 (auth + workspace trên Prisma); rà phần task sau khi T-023/T-024 merge

## Mục tiêu
Một lượt rà soát có hệ thống **code đã merge** (không phải thiết kế) đối chiếu `docs/design/security.md` và OWASP ASVS 5.0 mức L2 cho các mục liên quan (xác thực, phiên, kiểm soát truy cập, validate input, xử lý lỗi/log, cấu hình HTTP, WebSocket). Người viết code không tự chấm mình: phần auth/workspace là của bạn ⇒ nhờ F đọc chéo phần đó; bạn tập trung đọc kỹ phần **của người khác** (core/http, realtime, task, web).

## Việc cần làm
1. Bảng kiểm `docs/reviews/T-028-security-audit.md`: mục ASVS/SEC → file:dòng bằng chứng → Đạt / Không đạt / Không áp dụng.
2. Đọc tìm lỗ hổng thật (ưu tiên): IDOR/tenant leak ở mọi query đọc (kể cả cursor, audit log, search `q`), mass assignment, thứ tự kiểm 401→400→404→403, rò thông tin qua thông điệp lỗi/timing, rate limit có route nào thiếu, header bảo mật, CSP/XSS ở web (dangerouslySetInnerHTML, URL người dùng nhập), WebSocket (Origin, join room, rò event chéo workspace), log có lộ token/email/mật khẩu không, secret mặc định/placeholder ở prod.
3. Dependency: `pnpm audit --prod`, liệt kê advisory còn mở + đánh giá khả năng khai thác thực tế.
4. Mỗi lỗi: mức độ (Critical/High/Medium/Low), kịch bản tái hiện, đề xuất sửa, **chủ module**. Lỗi trong module của bạn (auth/workspace) ⇒ tự sửa trên branch với test; lỗi module người khác ⇒ báo Tech Lead để giao, không tự sửa.
5. Lỗi High/Critical ⇒ nhắn Tech Lead **ngay**, không đợi DONE.

## Worktree
`../TaskFlow_wt/T-028`, branch `feat/T-028` từ `main`.

## Phạm vi sở hữu
`docs/reviews/T-028-*.md`; sửa lỗi chỉ trong `apps/api/src/modules/auth/**`, `apps/api/src/modules/workspace/**` (+ test).

## Done
Bảng kiểm đủ, danh sách findings đã phân loại và gán chủ. Nhắn `DONE T-028 feat/T-028`.
