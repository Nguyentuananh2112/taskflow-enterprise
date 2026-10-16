# T-040b L2 — notifications đọc qua reader do module khác cung cấp (Engineer G)

> Nhánh `feat/T-040b-l2-readers`, dựng trên L3 của B (`fc820bc`). B review **APPROVE** (3898bba).
> Thứ tự merge TL chốt: T-038 → T-039 → **T-040b**. Cổng: verify đầy đủ của TL (integration + security) sau khi rebase lên T-039.

## Đã làm
- **Workspace** cung cấp audience: `IWorkspaceQueries.listMemberAccess(ws)` (Prisma: một `findMany`, select `{userId, role, grants}`; InMemory) + `application/adapters/notification-audience.ts` — `WorkspaceNotificationAudience implements INotificationAudience` (type công khai từ `notifications/index.ts`). `workspacesOf` dùng `listActiveForUser` (đã có `joinedAt` — L3 của B), `membersOf` dùng `listMemberAccess`.
- **Notifications**: xóa `infrastructure/prisma/prisma-notification-readers.ts`; thêm port `ILeaveSummaryReader`; `index.ts` export type `AudienceWorkspace`, `ILeaveSummaryReader`, `INotificationAudience`, `LeaveSummary`, `MemberAccess`. Không còn chỗ nào trong `modules/notifications` đọc `workspaceMember` / `leaveRequest` / `user`.
- **Composition**: `notificationContextFrom({ users, leaves })` — tên actor qua `IUserRefReader` dùng chung với Task, đơn qua `ILeaveSummaryReader`. `persistence.ts` dựng audience/context từ đó; `NotificationRepositories` giữ hình cũ nên module/container không đổi.
- **Tạm tới khi T-039 vào main**: `composition/interim-leave-summaries.ts` (Prisma, theo cặp (ws, id), select không `reason`, refs rỗng ⇒ không query) và `noLeaveSummaries` (bộ nhớ). TL yêu cầu: khi rebase sau T-039 thay bằng `readModel` của leave (= `leave.summaries`, D 5ce7182) cho cả hai chế độ và **xóa** interim.
- Test: `notification-audience.test.ts` (+ runner LSP Prisma `workspace.notification-audience.lsp.int.ts`), `composition/notification-context.test.ts`; int test notifications dùng đúng reader production (góp ý B).

## Quyết định / ghi chú
- **LOW (B, chủ ý)**: `workspacesOf` đi qua `listActiveForUser` có `take: MAX_MY_WORKSPACES = 100` (bản Prisma cũ không giới hạn) ⇒ người thuộc > 100 ws không thấy thông báo của ws vượt mức. An toàn (chỉ ẩn bớt, không lộ thêm) và trùng giới hạn chung của "workspace của tôi" ⇒ chấp nhận.
- `membersOf` trả mọi role; publisher lọc bằng `canManageHr` như trước. Đóng luôn LOW (b) của T-040 (hết N+1 ở bản bộ nhớ).

## Kết quả lệnh (G, 3898bba)
| Bước | Kết quả |
|---|---|
| `tsc --noEmit` (apps/api) | exit 0 |
| eslint các file đổi · depcruise | exit 0 · 0 vi phạm (384 module) |
| Unit: workspace + notifications + composition + test/http + test/contract | exit 0 — 50 file / 424 test |
| Integration / security | KHÔNG chạy riêng (TL): verify đầy đủ sau rebase lên T-039 |
