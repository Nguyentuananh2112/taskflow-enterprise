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
