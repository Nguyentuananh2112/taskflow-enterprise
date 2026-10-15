# T-032 — Đồng thời & phiên: sửa findings đọc chéo của F (auth/workspace)

**Giao cho:** Engineer B (`taskflow-enterprise-87`) · **Phase:** 4–5 · **Nguồn:** `docs/reviews/T-028-crossread-F.md` (branch `feat/T-028-crossread-F`) · DECISIONS ADR-104, **ADR-110**

## Việc (mỗi mục có test, race test lặp ≥ 20 lần trên Postgres thật)
1. **ADR-110 — X2, X8 (Medium):** `Workspace` và `Project` thêm cột `version` (migration mới — báo C trước để tránh trùng migration với T-023), repository ghi bằng `updateMany({ where: { id, version, deletedAt: null } })` ⇒ `count = 0` ⇒ 409 `VERSION_CONFLICT` (hoặc 404 nếu đã xóa). Bỏ mọi `save()` ghi cả snapshot không điều kiện trong module workspace. Race test: PATCH ‖ DELETE workspace ⇒ không bao giờ hồi sinh; rename ‖ archive project ⇒ không mất archive.
2. **X3 (Medium):** authenticator cache-miss ⇒ kiểm **cả** `sid` đã thu hồi trong DB (không chỉ `tv`) — Valkey không bền ⇒ sau khi Valkey restart, session đã logout-1-thiết-bị/reuse không được sống lại. Cổng: SEC-24e của F (container Valkey tạm).
3. **X4 (Medium):** refresh ‖ logout-all/change-password: trong transaction refresh đọc user `FOR SHARE` (hoặc kiểm `token_version` có điều kiện khi insert token mới) để token mới Y không sống sót sau thu hồi. Test tầng I mô phỏng xen kẽ.
4. **X1 (phần còn lại):** giới hạn số giá trị cookie đọc (`readAll` tối đa 4, vượt ⇒ 400) — cùng lượt ADR-109 trên `feat/T-028-task`.
5. **X5 (Low):** cursor giả ⇒ 400 (validate cursor, `afterKey` là uuid, anchor members có phạm vi `workspace_id`).
6. **X6, X7 (Low):** đọc lại role của actor sau `lockOwners` trong transaction; thêm `deleted_at IS NULL` phòng thủ trong query/use case (security.md §3.6).
7. **X9 (Low):** sự kiện bảo mật có `requestId` + `ip` (dùng request context của A ở T-031 mục 8 — phối hợp A); thêm sự kiện: xóa workspace, thêm thành viên, sai currentPassword, cookie trùng.

## Phạm vi sở hữu
`apps/api/src/modules/auth/**`, `apps/api/src/modules/workspace/**`, `apps/api/prisma/**` (chỉ migration mới cho `version` — báo C), test tương ứng, `docs/design/security.md`.

## Done
DoD (exit code); F chạy lại X2/X8 hộp đen (40 vòng ⇒ 0 hồi sinh) + SEC-24e. Nhắn `DONE T-032 feat/T-032`.
