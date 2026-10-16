# T-040b L2 — notifications đọc qua reader do module khác cung cấp (Engineer G)

> Nhánh `feat/T-040b-l2-readers`, dựng trên L3 của B (`fc820bc`). B review **APPROVE** (3898bba).
> Thứ tự merge TL chốt: T-038 → T-039 → **T-040b**. Đã rebase lên `main` 35e4589 (có T-039); cổng: verify đầy đủ của TL (integration + security).

## Đã làm
- **Workspace** cung cấp audience: `IWorkspaceQueries.listMemberAccess(ws)` (Prisma: một `findMany`, select `{userId, role, grants}`; InMemory) + `application/adapters/notification-audience.ts` — `WorkspaceNotificationAudience implements INotificationAudience` (type công khai từ `notifications/index.ts`). `workspacesOf` dùng `listActiveForUser` (đã có `joinedAt` — L3 của B), `membersOf` dùng `listMemberAccess`.
- **Notifications**: xóa `infrastructure/prisma/prisma-notification-readers.ts`; thêm port `ILeaveSummaryReader`; `index.ts` export type `AudienceWorkspace`, `ILeaveSummaryReader`, `INotificationAudience`, `LeaveSummary`, `MemberAccess`. Không còn chỗ nào trong `modules/notifications` đọc `workspaceMember` / `leaveRequest` / `user`.
- **Composition**: `notificationContextFrom({ users, leaves })` — tên actor qua `IUserRefReader` dùng chung với Task, đơn qua `ILeaveSummaryReader`. `persistence.ts` dựng audience/context từ đó; `NotificationRepositories` giữ hình cũ nên module/container không đổi.
- **Đơn nghỉ = reader của module leave**: sau rebase lên T-039, `persistence.ts` nối `leaves: leave.readModel` (cùng object với `leave.summaries` — `PrismaLeaveReadModel` / `InMemoryLeaveRepository`, theo cặp (ws, id), không `reason`) cho CẢ hai chế độ. Reader tạm `interim-leave-summaries.ts`, `noLeaveSummaries` và `InMemoryNotificationContextReader` (bản T-039) đã XÓA (TL: không còn đọc bảng của module khác, kể cả tạm). Commit 3169bff giữ tiêu đề cũ có chữ "interim" — nội dung sau rebase không còn lớp đó.
- Test: `notification-audience.test.ts` (+ runner LSP Prisma `workspace.notification-audience.lsp.int.ts`), `composition/notification-context.test.ts`; int test notifications dùng đúng reader production — `WorkspaceNotificationAudience`, `PrismaUserRefReader`, `PrismaLeaveReadModel` (góp ý B).

## Quyết định / ghi chú
- **LOW (B, chủ ý)**: `workspacesOf` đi qua `listActiveForUser` có `take: MAX_MY_WORKSPACES = 100` (bản Prisma cũ không giới hạn) ⇒ người thuộc > 100 ws không thấy thông báo của ws vượt mức. An toàn (chỉ ẩn bớt, không lộ thêm) và trùng giới hạn chung của "workspace của tôi" ⇒ chấp nhận.
- `membersOf` trả mọi role; publisher lọc bằng `canManageHr` như trước. Đóng luôn LOW (b) của T-040 (hết N+1 ở bản bộ nhớ).

## Kết quả lệnh (G, aaa8e28 trên main 35e4589)
| Bước | Kết quả |
|---|---|
| `pnpm install --frozen-lockfile` · `pnpm --filter @taskflow/api typecheck` | OK · exit 0 |
| eslint các file đổi · `lint:deps` | exit 0 · 0 vi phạm (469 module) |
| Unit toàn bộ apps/api (`vitest run --maxWorkers=2`) | exit 0 — 143 file / 1533 test |
| `grep` đọc bảng chéo module trong `modules/notifications` + `composition` | không còn |
| Integration / security | KHÔNG chạy riêng (TL): verify đầy đủ của TL |
