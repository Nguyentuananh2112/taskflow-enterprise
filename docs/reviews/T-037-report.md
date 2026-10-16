# T-037 — Nền tảng HR (grants, HrAuditLog, chốt ghi HR) — báo cáo Engineer B

Nhánh `feat/T-037-hr-foundation` (từ main dd58774). Phần 1: f3523e3 (schema + contracts + RBAC grants),
c0ac57c (migration 3 dựng lại: không seed / trigger, `work_schedules.created_by_id` NOT NULL). Phần 2: commit này.

## Đã làm (theo phạm vi ticket)

| # | Hạng mục | Vị trí |
|---|---|---|
| 1 | Migration 3 (§3) + CHECK | `apps/api/prisma/migrations/20261017000000_hr_attendance_leave/` |
| 2 | `effectivePermissions` = role ∪ grant, parity domain ↔ contracts | `domain/roles.ts`, `application/role-permissions-parity.test.ts` |
| 3 | `PUT /workspaces/:wsId/members/:userId/grants` (OWNER; 422 `GRANT_NOT_ALLOWED` cho VIEWER / OWNER; hạ VIEWER / nâng OWNER xóa grants cùng transaction; `member:grants-changed` sau commit) | `use-cases/set-member-grants.use-case.ts`, `change-member-role.use-case.ts` |
| 4 | HrAuditLog: writer dùng trong transaction bên gọi (chặn khóa `reason`), `GET /workspaces/:wsId/hr-audit-logs` chỉ OWNER (`hr:grant`) | `application/hr-audit-writer.ts`, `use-cases/list-hr-audit-logs.query.ts`, `prisma/prisma-hr-audit-log.ts` |
| 5 | Chốt ghi HR dùng chung: khóa `FOR SHARE` dòng membership của người gọi → đọc lại role + grants → 403 nếu mất quyền; luật tự xử lý (403 trừ OWNER; OWNER thiếu lý do ⇒ 422 `REASON_REQUIRED`) | `application/adapters/hr-access.ts` (`HrAccess.authorizeWrite`, `isEmployee`) |
| 6 | Zod contracts + OpenAPI (2 route, tag `hr`), CORS thêm `PUT` + `Idempotency-Key` | `packages/contracts/src/openapi/routes.ts`, `core/http/middleware.ts` |

## Hợp đồng cho A / D (T-038, T-039)

```ts
// Gọi TRONG uow.run của bên gọi, TRƯỚC khi đọc / ghi dữ liệu nghiệp vụ. Trả Actor đã đọc lại.
hrAccess.authorizeWrite({ workspaceId, actorId, targetUserId?, reason? }): Promise<Actor>
hrAccess.isEmployee({ workspaceId, userId }): Promise<boolean>   // OWNER / PM / MEMBER
hrAudit.record({ workspaceId, actorId, action, targetUserId?, refId?, before?, after? })
// action ∈ HR_AUDIT_ACTIONS (domain/hr-audit.ts); before / after KHÔNG được có khóa `reason` (ném lỗi).
```

`createWorkspaceModule` trả `hrAccess` và `hrAudit` để composition root nối sang module HR.

## Kiểm thử

- Unit `hr-grants.use-cases.test.ts` (21 test): GR-04..GR-10, X6, SEC-HR-09 (tầng U, thu grant ⇒ lệnh kế 403),
  B-H1, R26 (OWNER tự xử lý cần lý do), 404 ws xóa / không thành viên, `isEmployee`, writer chặn `reason`, audit chỉ OWNER + phân trang.
  Chạy lại trên Postgres qua `test/integration/lsp/workspace.hr-grants.use-cases.lsp.int.ts`.
- HTTP `test/http/hr-grants.http.test.ts` (7 test): 200 / 403 / 422 / 400 / 404, `myGrants` ở `GET /workspaces`, audit 200 OWNER / 403 HR, cursor.
- Integration `test/integration/hr-constraints.int.ts`: CHECK grants theo role (INSERT + UPDATE), unique IN WEB / idempotency,
  CHECK hủy / ADJUSTMENT / lịch, `hr_audit_logs` không FK target / ref, FK Restrict actor.
- Parity: `HR_AUDIT_ACTIONS` ↔ `HrAuditAction`; 7 enum mới Prisma ↔ contracts (`test/prisma-enums.parity.test.ts`).

### Đột biến thủ công (14, chết 13)

Bị bắt: bỏ luật tự xử lý; `trim()` lý do; bỏ `requirePermission('hr:manage')`; tin grants cũ thay vì đọc lại;
bỏ kiểm ws đã xóa; `isEmployee` luôn true; writer không chặn `reason`; `changeRole` không xóa grants;
`setGrants` không chặn OWNER / VIEWER; bỏ kiểm `hr:grant` sau khóa (X6); no-op vẫn ghi audit; audit bỏ quyền; đổi tên event.

Sống: bỏ `requirePermission('hr:grant')` ĐẦU `SetMemberGrantsUseCase` — đột biến tương đương (cùng quyền được kiểm
lại sau khóa trong `lockOwnersAndReloadActor`); giữ để thất bại sớm trước khi mở transaction.

### Chưa phủ ở T-037 (ghi rõ)

- `FOR SHARE` thật sự tuần tự hóa thu grant ↔ lệnh HR đang bay (SEC-HR-10 / CC-HR-11) chỉ kiểm được bằng test
  đồng thời trên Postgres: F gác bằng `SEC_RUN_PENDING=T-037`; bản in-memory `findForShare` = `find`.

## Lệnh đã chạy (exit code)

`prettier --check .` 0 · `eslint apps/api packages/contracts apps/web/src --max-warnings=0` 0 · `pnpm -r lint:deps` 0 ·
`tsc` api / contracts / web 0 · `vitest run` toàn repo 0 (193 file, 1916 test) · integration chọn lọc trên DB riêng
(`lsp/workspace.*`, `constraints`, `hr-constraints`) 0 (12 file, 144 test).
Còn chờ lượt Tech Lead: `pnpm verify` + integration đầy đủ + security trên DB mới.
