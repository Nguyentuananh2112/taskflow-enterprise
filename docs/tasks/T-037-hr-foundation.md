# T-037 — Nền tảng Mốc 3: grants, migration 3, HrAuditLog

**Giao cho:** Engineer B (`taskflow-enterprise-d1`) · **Mốc:** 3 · **Phụ thuộc:** main ≥ 032cf76 · **Chặn:** T-038, T-039, T-040, T-041

## Nguồn
`docs/design/attendance-leave.md` §2 (ADR-119, ADR-120), §3, §5 (grants, thứ tự lỗi), §9 (grants, thu quyền tức thì) · `docs/design/test-spec-hr.md` §6 (GR-*), SEC-HR liên quan grants.

## Việc cần làm
1. Migration 3 gồm **toàn bộ** schema §3 (mọi enum + bảng + SQL tay: unique một phần, CHECK, FK theo §3 — userId → users Restrict, workspaceId → workspaces cascade), để T-038/039/040 không phải sửa schema. Seed lịch mặc định T2–T7 08:00–17:30, nghỉ 12:00–13:30, grace 0, `Asia/Ho_Chi_Minh` cho workspace có sẵn và workspace mới.
2. `effectivePermissions(role, grants)` + quyền mới (`attendance:self`, `leave:self`, `hr:manage`, `hr:grant`) trong ma trận domain + contracts, test parity (gồm chứng minh loại trừ của ADR-119). `loadMembership` đọc `grants` trong cùng truy vấn; `WorkspaceDto` thêm `myGrants`.
3. `PUT members/:userId/grants` (OWNER), luật 422 (VIEWER, OWNER), hạ VIEWER xóa grants, hạ role trả grants còn lại; event `member:grants-changed`.
4. `HrAuditLog` (chỉ thêm) + helper ghi trong transaction; route đọc audit OWNER-only.
5. Helper dùng chung cho lệnh ghi `hr:manage`: lấy khóa → đọc lại membership + grants → 403 nếu mất quyền; luật "không tự xử lý dữ liệu của mình" (403 trừ OWNER). Test stale-actor.
6. Contracts Zod + OpenAPI cho route mới; CORS `allowedHeaders` thêm `Idempotency-Key`.

## Không làm
Logic chấm công / nghỉ / thông báo (T-038/039/040). UI (T-041c).

## Done
`pnpm verify` + integration + security exit 0 (DB mới); GR-* và SEC-HR về grants trong test-spec xanh. Báo `DONE T-037` + hash; báo A/D/E ngay khi migration 3 + contracts quyền đã ổn định (có thể trước DONE).
