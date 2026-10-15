# Report — `project:updated` phía server + đối chiếu event realtime hợp đồng ↔ server

**Người làm:** Engineer B · **Branch:** `feat/project-updated-event` · **Ngày:** 2026-10-15
**Nguồn:** review bảo mật T-034 (M1) — mock web phát `project:updated` mà server chưa bao giờ phát (kiểu lỗi H2). Tech Lead quyết: hợp đồng là nguồn sự thật, **server phải phát**, mock giữ nguyên.

## Đã làm

- `UpdateProjectUseCase`, `SetProjectArchivedUseCase` phát `project:updated` tới `project:{id}`:
  - **sau commit**, và **chỉ khi thực sự ghi** — archive lần 2 hay unarchive project chưa archive thì không phát;
  - lỗi (rollback) thì không phát;
  - `data.project` = `ProjectDto` (ngày ISO), `actorId`, `originClientId` từ `X-Client-Id`.
- Port `IWorkspaceRealtimeNotifier` thêm `emitToProject` (kiểu chặt `type: 'project:updated'`). `LateBoundRealtime` (composition của A) **đã có sẵn** `emitToProject` cho module Task nên khớp theo cấu trúc ⇒ **không sửa file composition nào**.
- Test:
  - `project-updated-event.test.ts` (unit, spy ghi `duringTransaction: false`, payload qua `ProjectDto.safeParse`, no-op, rollback);
  - `test/http/project-realtime.http.test.ts` (gateway thật: envelope qua schema hợp đồng `ProjectUpdatedEvent`, người ở workspace khác không nhận, archive ⇒ `isArchived: true`, 422 không phát).

## Đối chiếu event server → client (contracts `SERVER_EVENTS` ↔ chỗ server phát)

| Event | Hợp đồng | Server phát ở | Trạng thái |
|---|---|---|---|
| `task:created` | data-and-api §611 | `modules/task/application/task-realtime.ts:22` | Đã có |
| `task:updated` | §612 | `task-realtime.ts:42,44` (kể cả bỏ gán khi xóa thành viên) | Đã có |
| `task:moved` | §613 | `task-realtime.ts:25,34` | Đã có |
| `task:deleted` | §614 | `task-realtime.ts:47` | Đã có |
| `project:updated` | §615 | — | **Thiếu ⇒ đã thêm ở branch này** |
| `workspace:access-revoked` | §616 | `core/realtime/gateway.ts:141` (xóa / tự rời), `:161` (xóa workspace) | Đã có |
| `auth:expired` | §617 | `core/realtime/socket-handlers.ts:52` | Đã có |
| `member:role-changed` | §618 | `core/realtime/gateway.ts:150` | Đã có |

Cách kiểm: `git grep` từng tên event và từng khóa hằng số trong `apps/api/src` (trừ test); đối chiếu bảng event trong `data-and-api.md` §4. **Không còn event nào trong hợp đồng mà server chưa phát.** Ba event client → server (`project:join`, `project:leave`, `auth:renew`) đều đã có handler.

## Việc liên quan người khác

- **E (T-034):** server giờ phát `project:updated` thật. UI vẫn nên refetch sau mutation của chính tab (event có `originClientId` = tab đó; FE bỏ qua event của chính mình).
- **Runbook go-live:** gỡ ghi chú "hai mục §9 của devops.md đã cũ" — D đã đồng bộ ADR-108/109.

## Test tự động trong CI (thay audit tay) — `apps/api/test/contract/realtime-event-parity.test.ts`

Chạy trong `pnpm test` (project `api`). Ba bên phải khớp:

| Kiểm | Cách | CI đỏ khi |
|---|---|---|
| (a) Danh sách event hợp đồng | `Record<keyof ServerToClientEvents, true>` trong test; `REALTIME_EVENTS` = client ∪ server | Hợp đồng thêm / bớt event mà test chưa cập nhật (**lỗi typecheck**), hoặc `REALTIME_EVENTS` lệch |
| (b) Server ↔ hợp đồng | Quét tĩnh `apps/api/src` (bỏ `*.test.ts`), chỉ **vị trí emit**: `#emit(room, 'x'`, `.emit('x'`, `createEnvelope(_, 'x'`, object literal `type: 'x',`. Khai báo kiểu (`type: 'x';`, union `'a' \| 'b'`) không tính ⇒ port / interface không làm xanh giả | Một event hợp đồng không có chỗ emit nào; hoặc server emit event ngoài hợp đồng |
| (c1) Web lắng nghe | Mọi literal `'miền:event'` trong code `realtime` / `socket` của `apps/web/src` (trừ mock) | Web nghe / gửi tên event không có trong hợp đồng |
| (c2) Mock ↔ server (bài học H2) | Vị trí phát trong `apps/web/src/app/mock-api` + `apps/web/test/fake-realtime.ts` (`name: 'x'`, `envelope(_, 'x'`, `type: 'x',`, `.emit('x'`) | **Mock phát event mà server không phát** |

**Đã kiểm đột biến** (rồi hoàn tác):
- gỡ emit `project:updated` khỏi `UpdateProject` / `SetProjectArchived` ⇒ đỏ 2 test: (b) "server có emit `project:updated`" và (c2) "mock ⊆ server" — đúng tình huống H2 / T-034 M1;
- thêm `name: 'task:archived'` vào mock ⇒ đỏ (c2).

Có chốt chống xanh giả: phải quét được ít nhất một file listener và một event mock; tập server emit được so cả hai chiều với hợp đồng.

**Giới hạn đã biết:** quét tĩnh — tên event ghép động (biến, template string) không thấy được. Quy ước: tên event luôn là literal ở chỗ emit (hiện đúng ở mọi nơi). Hành vi từng event (payload, sau commit, đúng phòng) vẫn do test riêng của use case / gateway đảm nhiệm.
