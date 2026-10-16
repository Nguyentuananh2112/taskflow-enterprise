# T-040 — Bàn giao (Engineer G → Engineer B)

> **TRẠNG THÁI: ĐÃ MERGE** — `main` 6fcdce4 (merge `feat/T-040-notifications` @ 8ea3f7c). Cổng của TL đều exit 0:
> verify 8/8, integration 474/474, security 125 pass + 37 pending (khai báo), web build, e2e-tsc. B review: APPROVE.
> T-040 xong; B KHÔNG cần làm lại phần nào. Việc còn mở (không chặn, phần lớn chờ T-038 / T-039): **mục 6**.

## 1. Đã làm

### Module `apps/api/src/modules/notifications/` (mới)
| File | Vai trò |
|---|---|
| `domain/notification.ts` | `NOTIFICATION_TYPES` (parity contracts), `HR_AUDIENCE_TYPES = [LEAVE_SUBMITTED, LEAVE_CANCELLED]` (loại "dành cho HR"), `LEAVE_TYPES`, `VisibilityScope` + hàm thuần `isVisible` |
| `application/ports.ts` | `INotificationStore`, `INotificationAudience` (membership HIỆN TẠI), `INotificationContextReader` (tên actor + loại/khoảng ngày đơn — không lý do), `INotificationRealtime`, `CanManageHr`, `NotificationKey` (keyset) |
| `application/notification-publisher.ts` | `notify({ workspaceId, type, refId, actorId, recipient: user \| hr })` — ném `NotifyOutsideTransactionError` nếu ngoài `uow.run`; `hr` ⇒ `membersOf(ws)` lọc bằng `canManageHr` (đọc trong tx của bên gọi); bỏ actor; `createMany` trong tx; **mỗi người nhận một** `uow.afterCommit` phát `notification:new` |
| `application/notification.queries.ts` | list / unreadCount / markRead / markAllRead. Mỗi request dựng `VisibilityScope` từ `workspacesOf(me)` (ws chưa xóa, đang là thành viên): `full` = có `hr:manage` hiện tại, `basic` = không (ẩn loại HR). DTO join tên ws, actor, đơn (chỉ khi loại LEAVE_*) |
| `infrastructure/prisma/prisma-notification.store.ts` | `visibleWhere(scope)` — `recipient_id = me` LUÔN có; keyset `(createdAt, id)` giảm dần; markRead idempotent (giữ `readAt` cũ), không thấy ⇒ `false` ⇒ 404 |
| `infrastructure/prisma/prisma-notification-readers.ts` | `PrismaNotificationAudience` (đọc `workspace_members` ⨝ `workspaces.deleted_at IS NULL`), `PrismaNotificationContextReader` (`users.full_name`; `leave_requests` select tường minh `{id,type,startDate,endDate}` theo cặp (ws, id)) |
| `infrastructure/in-memory-notification.store.ts` | InMemory, tham gia snapshot/rollback của `InMemoryUnitOfWork` |
| `presentation/notification.controller.ts` | 4 route dưới `/api/v1/me/notifications`: `GET /` (cursor + limit 1..50, mặc định 20), `GET /unread-count`, `POST /read-all` (204), `POST /:id/read` (204; 404 `notification`). userId luôn từ token |
| `notifications.module.ts`, `index.ts` (chỉ type) | composition module; public API chỉ type (test chặn giá trị runtime) |
| `testing/notification-harness.ts` | Fake audience/context/realtime + fixture test-spec-hr §0.2 |

### Ngoài module
- **contracts**: `ListNotificationsQuery`, `NotificationParams` (`hr/hr.schemas.ts`); 4 route OpenAPI tag mới `notifications` (`openapi/routes.ts`, `document.ts`); `'notification'` trong `NotFoundDetails.resource`. `core/errors/client-errors.ts`: `ResourceKind` thêm `'notification'`.
- **composition**: `persistence.ts` (repo notifications cho memory + prisma, `modules.notifications`), `container.ts` (module notifications tạo TRƯỚC Workspace; `canManageHr = hasPermission(role, grants, 'hr:manage')` của contracts; mount router), `notification-adapters.ts`:
  - `leaveNotifierFrom(publisher)` — khớp `ILeaveNotifier` của D (T-039: `notify({ workspaceId, type, requestId, actorId, recipient })`), `requestId ⇒ refId`.
  - `attendanceNotifierFrom(publisher)` — khớp `AttendanceNotifier` của A (T-038: `attendanceAdjusted({ workspaceId, recipientId, eventId, actorId })`) ⇒ `ATTENDANCE_ADJUSTED`.
  - `hrGrantNotifierFrom(publisher)` — `IHrGrantNotifier` của Workspace.
  - `InMemoryNotificationAudience` / `InMemoryNotificationContextReader` cho chế độ bộ nhớ (leave ⇒ `null` vì chưa có module leave InMemory).
- **workspace (review B — M1, B đồng ý)**: port BẮT BUỘC `IHrGrantNotifier.grantsChanged({ workspaceId, userId, actorId, added, membershipId })` (`collaborators.port.ts`); gọi TRONG tx ở `set-member-grants.use-case.ts` (sau audit; `added = after.length > before.length`) và `change-member-role.use-case.ts` (nhánh `grantsCleared`, sau audit REVOKE). Harness: `hrNotifier = createSpy(...)`. Test riêng `hr-grant-notifications.test.ts`.

## 2. Quyết định tự đưa ra (TL/B xem lại)
1. **Loại "dành cho HR"** = `LEAVE_SUBMITTED`, `LEAVE_CANCELLED` (theo bảng §9: hai chuyển này báo HR). Bảng `notifications` không có cột "audience" nên phân loại theo `type`.
2. **Người gây ra không tự nhận** — kể cả `recipient: user` khi user = actor (OWNER tự duyệt đơn của mình ⇒ không dòng nào).
3. **Ws xóa mềm** ⇒ ẩn thông báo (audience chỉ trả ws `deleted_at IS NULL`); purge ⇒ cascade (FK có sẵn).
4. **Keyset `(createdAt, id)`** thay vì chỉ id: `UuidV7Generator` ghi rõ cùng mili giây id không có thứ tự. Cursor `{ createdAt, id }` validate Zod trước khi chạm DB. Fan-out cùng `createdAt` ⇒ id phân định.
5. **read / read-all trả 204** (khớp mock web T-041b). markRead lặp lại giữ `readAt` đầu. `read-all` chỉ đánh dấu thông báo đang thấy được.
6. `?userId=` ở list bị bỏ qua (query không strict, như các list khác) — luôn của người gọi.
7. `refId` của HR_GRANTED/HR_REVOKED = id dòng `workspace_members`.
8. Rate limit: chỉ `authenticated` (300/phút/user) như route đọc khác.

## 3. Ghi chú review B (đưa vào đây theo yêu cầu)
B review 3fe6e8e (5 điểm đạt, không HIGH) rồi 8c84d93 **APPROVE**. Đã sửa: M1 (port `IHrGrantNotifier` bắt buộc), L1 (mỗi người nhận một afterCommit), LOW (a) (HR_GRANTED/REVOKED theo chính `HR_MANAGE`, không so số lượng grant — 40fd839). Còn lại, không chặn:
- **LOW (b)** — `InMemoryNotificationAudience.membersOf` gọi `find` N lần; chỉ chế độ bộ nhớ.
- **L2** — `PrismaNotificationAudience` đọc thẳng `workspace_members` từ module notifications. B đề xuất Workspace cung cấp reader (như `HrAccess`); B làm nếu TL đồng ý.
- **L3** — scope chỉ theo membership HIỆN TẠI: bị xóa rồi được mời lại ⇒ thấy lại thông báo nhiệm kỳ cũ. Khi T-037b có `workspace_member_departures`/`joinedAt` (quyết định NOT_EMPLOYED, main 5b18efc) có thể lọc `createdAt ≥ joinedAt`.
- **L4** — fan-out `hr` đọc `membersOf` không khóa: thu grant đồng thời ⇒ có thể vẫn tạo dòng + event cho HR vừa mất quyền. Lúc đọc bị ẩn (B-H3b); event chỉ chứa id/loại/ws (SEC-HR-20). Chấp nhận.

## 4. Rủi ro / phụ thuộc
- **Leave/attendance chưa wire**: hai module chưa có trên nhánh này. Khi merge T-038/T-039, composition phải nối `notifier: leaveNotifierFrom(notifications.publisher)` / `attendanceNotifierFrom(...)` (đổi kiểu cấu trúc `LeaveNotifierPort`/`AttendanceNotifierPort` sang `implements` type thật của họ). Lúc đó F gỡ pending **SEC-HR-15, 17, 18, 19, 20** (`test/T-042-hr: harness/pending.ts`, ticket T-040) — các ca đó gửi đơn / chấm công qua route thật. Đã đọc `hr.sec.ts` của F: kỳ vọng khớp API này (list chứa `workspaceId`, loại HR ẩn sau thu grant, 404 khi đánh dấu của người khác, socket chỉ `user:{id}`).
- **Đã báo D và A (23:1x)**: D (T-039 @5419dee) thay `notifier: noLeaveNotifications` bằng `notifier: leaveNotifierFrom(notifications.publisher)` trong `container.ts` khi rebase; TL đặt notifier thật làm điều kiện merge T-039 ⇒ thứ tự merge TL chốt **T-037b → T-040 → T-038 → T-039** (A, D nối notifier thật khi rebase; TL làm verify + security T-040 ngay sau lượt integration của G). A (T-038) thay fake bằng `attendanceNotifierFrom(notifications.publisher)`. Khi đó đổi `LeaveNotifierPort` / `AttendanceNotifierPort` (bản sao cấu trúc) sang type thật của leave / attendance.
- Chế độ bộ nhớ: `leave` trong DTO luôn `null` (không có module leave InMemory). Prisma đúng.
- Leave context đọc `leave_requests` (bảng của D) — cùng loại vấn đề L2.

## 5. Kết quả lệnh (G, máy dev, head f316db6 trên main f78acf6)
Mọi bước đọc **exit code**, không grep "passed".

| Bước | Lệnh | Kết quả |
|---|---|---|
| Cài | `pnpm install --frozen-lockfile` | OK |
| Typecheck | `pnpm --filter @taskflow/api typecheck` | exit 0 |
| Lint | `eslint` các file đổi · `pnpm --filter @taskflow/api lint:deps` | exit 0 · 0 vi phạm depcruise |
| Unit API | `vitest run --maxWorkers=2` (apps/api) | exit 0 — 123 file / 1292 test |
| Integration 1 | `test/integration/notifications` — DB `taskflow_t040` tạo mới, Valkey `6380/12`, `REQUIRE_INTEGRATION=1`, KHÔNG `VITEST_MAX_WORKERS` | exit 0 — 11/11 (lần đầu đỏ do fixture email chữ hoa — sửa ở f316db6) |
| Integration 2 | `test/integration/lsp/workspace.*` + `test/integration/workspace` | exit 0 — 14 file / 146 test |
| Cổng TL (f316db6; 8ea3f7c chỉ khác docs) | verify · integration đầy đủ · security · web build · e2e-tsc | exit 0 — 8/8 · 474/474 · 125 + 37 pending · OK · OK ⇒ merge 6fcdce4 |

Script G dùng: `scratchpad/run-int.sh` (DROP/CREATE `taskflow_t040` bằng `taskflow_migrator` trên postgres-test rồi `pnpm test:integration <đường dẫn>`).

## 6. Việc còn mở (sau merge)

| # | Việc | Ai | Trạng thái lúc G bàn giao |
|---|---|---|---|
| 1 | Nối `attendanceNotifierFrom(notifications.publisher)` vào attendance khi rebase T-038 | A | đã báo A (T-040 vào main); thứ tự merge **T-038 → T-039** |
| 2 | Nối `leaveNotifierFrom(notifications.publisher)`, xóa `noLeaveNotifications`, đổi `LeaveNotifierPort` → `ILeaveNotifier` | D | đã báo D; D thêm ca HTTP "HR tự gửi đơn ⇒ chỉ OWNER nhận" |
| 3 | Gỡ pending SEC-HR-15, 17, 18, 19, 20 (`apps/api/test/security/harness/pending.ts` — ghi ticket T-040 nhưng thực ra cần route của T-038 / T-039) | F | sau khi 1 + 2 merge; G đã đọc `hr.sec.ts` — kỳ vọng khớp API |
| 4 | E2E-HR-02 (chuông realtime < 2 s) | F / E | sau T-039 + T-041a |
| 5 | L2: chuyển `PrismaNotificationAudience` (đọc `workspace_members`) sang reader do Workspace cung cấp; tương tự context đọc `leave_requests` | B | chờ TL quyết |
| 6 | L3: lọc `createdAt ≥ joinedAt` của nhiệm kỳ hiện tại (bị xóa rồi mời lại ⇒ không thấy thông báo nhiệm kỳ cũ) — dùng `workspace_member_departures` của T-037b | B | chờ TL quyết |
| 7 | LOW (b): `InMemoryNotificationAudience.membersOf` gọi `find` N lần | — | chấp nhận (chỉ chế độ bộ nhớ) |

File này thay cho `T-040-report.md` (TL đã merge dựa trên nó).

## 7. Nhật ký chạy
- 22:38 nhận vé; 22:50 WIP đầu (B review: không HIGH) · 22:58 HR_GRANTED/REVOKED (M1) · 23:00 rebase main 0ec3bb4 · 23:06 LOW (a) (B APPROVE) · rebase main f78acf6 (sau T-037b) · integration 2 phần xanh (mục 5).
- `harness.ts` của Workspace 215 dòng sau rebase nhưng `max-lines` không đếm dòng trống/comment ⇒ eslint exit 0, không tách.
- TL verify f316db6 xanh ⇒ merge 8ea3f7c vào main 6fcdce4. G báo A, D rebase + nối notifier; DB `taskflow_t040` đã DROP, Valkey 6380/12 trống.
