# Đặc tả test — Task domain (TDD cho Phase 2)

> Ticket: T-007 · Tác giả: Engineer C (`taskflow-enterprise-ba`) · Trạng thái: **Chờ Tech Lead duyệt**
> Căn cứ: `docs/blueprint/DECISIONS.md` (đến ADR-051), `docs/design/data-and-api.md` (luật R1–R18, mục 1.2/1.3/1.9, 2.7), `docs/design/security.md` (thứ tự kiểm tra, SEC-*).
> Mỗi case ghi một **tầng** test. Case nào có cả ở nhiều tầng thì ghi tầng thấp nhất có thể bắt được lỗi.

## 0. Quy ước

### 0.1. Tầng test

| Mã | Tầng | Công cụ / phạm vi | Ghi chú |
|---|---|---|---|
| **U** | Unit domain | Vitest, chỉ `TaskEntity`/value object, không I/O | Chạy < 1 ms/case. Mục tiêu coverage domain ≥ 80% (blueprint §1.1). |
| **A** | Unit application | Vitest, use case + `TaskPolicy` với `InMemoryTaskRepository`, `InMemoryProjectRepository`, `InMemoryMembershipReader`, `InMemoryAuditLogRepository`, `FakeTransactionManager` (rollback thật trên các repo in-memory), `SpyEventBus`, `FixedClock`, `SequentialIdGenerator` | Không Postgres. Phần lớn luật nghiệp vụ test ở đây. |
| **I** | Integration | Vitest + Postgres thật (Docker, ADR-003), repository Prisma + use case thật, DB reset mỗi file (transaction rollback hoặc truncate) | Kiểm SQL, index/unique, collation, lọc `deleted_at`, phạm vi tenant. |
| **C** | Concurrency | Như **I**, chạy N request song song bằng `Promise.all` với **kết nối riêng** (pool ≥ N) | Lặp mỗi case 20 lần trong CI nightly để bắt race không ổn định; PR chạy 1 lần. |

Test HTTP (route, middleware, envelope, IDOR) là Phase 3 và nằm trong bộ SEC-* của Engineer B. Ở đây chỉ thêm những case HTTP-level mà use case không bắt được (đánh dấu **I-HTTP**).

### 0.2. Fixture chuẩn (dùng chung mọi tầng)

| Tên | Mô tả |
|---|---|
| `W1` | Workspace chính. |
| `Olivia` | OWNER của W1. |
| `Pam` | PM của W1. |
| `Mia`, `Max` | MEMBER của W1. |
| `Vic` | VIEWER của W1. |
| `Otto` | OWNER của `W2` (workspace khác), không thuộc W1. |
| `Zed` | User đã ẩn danh hóa (`deleted_at` ≠ null), trước đây là MEMBER của W1 (membership đã xóa). |
| `P1` | Project của W1, `keyPrefix = "TF"`, đang hoạt động, `nextTaskNumber = 1`. |
| `P2` | Project của W1, `keyPrefix = "ARC"`, **đã archive**, có sẵn task `ARC-1` (TODO). |
| `P3` | Project của W1, `keyPrefix = "WEB"`, đang hoạt động — để test phạm vi project. |
| `Q1` | Project của W2, `keyPrefix = "TF"` (trùng prefix khác workspace, hợp lệ). |
| `clock` | `FixedClock` = `2026-10-15T08:00:00.000Z`, tiến tay khi cần. |
| `taskFactory(overrides)` | Dựng task qua `TaskEntity.reconstitute` với giá trị mặc định hợp lệ. |

Ký hiệu: `t(TF-3, TODO, v2, rank "a1", by Mia, → Max)` = task `TF-3` ở TODO, version 2, rank `"a1"`, `createdById = Mia`, `assigneeId = Max`.

### 0.3. API entity giả định (để viết test trước)

Chữ ký dưới đây là hợp đồng giữa test và hiện thực. Đổi tên được trong Phase 2, nhưng hành vi phải giữ.

```ts
TaskEntity.create(props: { id, workspaceId, projectId, number, title, description?, priority?,
  dueDate?, assigneeId?, rank, createdById, now }): TaskEntity
TaskEntity.reconstitute(props: TaskProps): TaskEntity   // không phát event
task.update(changes: { title?, description?, priority?, dueDate? }, actorId, now): boolean   // false = no-op
task.moveTo(targetStatus: TaskStatus, newRank: Rank, actorId, now): boolean
task.assignTo(assigneeId: string | null, actorId, now): boolean
task.softDelete(actorId, now): void
task.assertVersion(expected: number): void           // ném VersionConflictError
task.pullDomainEvents(): DomainEvent[]                // trả rồi xóa danh sách
task.toPrimitives(): TaskProps
```

Domain **không** biết project archived, membership, quyền: những thứ đó do application kiểm (ADR-021). Rank là value object `Rank` (chuỗi không rỗng, so byte); domain **không** gọi `fractional-indexing` — application tính rank qua port `IRankGenerator` (`between(a: Rank|null, b: Rank|null): Rank`).

### 0.4. Thứ tự kiểm tra trong use case (từ security.md, dùng cho nhiều case)

`404` (task/project ngoài phạm vi, task đã xóa) → `403` (Policy) → `422` (PROJECT_ARCHIVED, luật nghiệp vụ) → `409` (version) → domain → no-op → ghi + audit trong transaction → publish sau commit.

**Quyết định cho T-007** (ĐỀ XUẤT, bổ sung R15): kiểm `expectedVersion` **trước** phát hiện no-op. Lệnh no-op mà version cũ vẫn trả `409`. Lý do: FE luôn nhận được bản mới nhất khi đang giữ dữ liệu cũ, và luồng xử lý chỉ có một đường.

---

## 1. TaskEntity (tầng U)

### 1.1. create

| ID | Given | When | Then |
|---|---|---|---|
| TE-C01 | props hợp lệ, title `"  Viết spec  "` | `create` | `status = TODO`, `version = 1`, `title = "Viết spec"` (đã trim), `priority = MEDIUM`, `deletedAt = null`, `createdAt = updatedAt = now` |
| TE-C02 | như trên | `create` rồi `pullDomainEvents()` | Đúng 1 `TaskCreated { taskId, projectId, workspaceId, actorId = createdById, snapshot }`; gọi lại `pullDomainEvents()` ⇒ `[]` |
| TE-C03 | title sau trim dài 2 ký tự (`" ab "`) | `create` | Ném `ValidationError` (`field: "title"`), không tạo entity |
| TE-C04 | title dài đúng 3 / đúng 150 ký tự | `create` | Thành công |
| TE-C05 | title dài 151 ký tự | `create` | `ValidationError` |
| TE-C06 | title chứa `\n` hoặc ký tự điều khiển `\u0007` | `create` | `ValidationError` (R1) |
| TE-C07 | description `"   "` | `create` | `description = null` (R2) |
| TE-C08 | description 10 000 ký tự / 10 001 ký tự | `create` | Thành công / `ValidationError` |
| TE-C09 | `dueDate = "2026-01-01"` (quá khứ so với clock) | `create` | Thành công (R4 cho phép quá khứ) |
| TE-C10 | `dueDate = "1999-12-31"` hoặc `"2101-01-01"` | `create` | `ValidationError` |
| TE-C11 | `number = 0` hoặc âm | `create` | `ValidationError` (bất biến: number ≥ 1) |
| TE-C12 | `rank = ""` | `create` | `ValidationError` |
| TE-C13 | `assigneeId = Max` | `create` | `assigneeId = Max`; event `TaskCreated` chứa assignee. **Không** phát thêm `TaskAssigneeChanged` (một use case = một event chính) |
| TE-C14 | `reconstitute(props)` | — | Không có domain event; mọi getter trả đúng props |

### 1.2. transitionTo / moveTo — đủ 16 cặp trạng thái

`moveTo(target, newRank)`, task ban đầu ở trạng thái **Từ**, version 3, rank `"a0"`, newRank `"a5"`.

| ID | Từ | Đến | Kết quả |
|---|---|---|---|
| TE-M01 | TODO | IN_PROGRESS | ✅ status đổi, rank `"a5"`, version 4, event `TaskStatusChanged { from: TODO, to: IN_PROGRESS, fromRank: "a0", toRank: "a5" }` |
| TE-M02 | IN_PROGRESS | TODO | ✅ như trên |
| TE-M03 | IN_PROGRESS | REVIEW | ✅ |
| TE-M04 | REVIEW | IN_PROGRESS | ✅ |
| TE-M05 | REVIEW | DONE | ✅ |
| TE-M06 | DONE | REVIEW | ✅ (reopen) |
| TE-M07 | TODO | REVIEW | ❌ `InvalidStatusTransitionError { from: TODO, to: REVIEW, allowed: [IN_PROGRESS] }` |
| TE-M08 | TODO | DONE | ❌ `allowed: [IN_PROGRESS]` |
| TE-M09 | IN_PROGRESS | DONE | ❌ `allowed: [TODO, REVIEW]` |
| TE-M10 | REVIEW | TODO | ❌ `allowed: [IN_PROGRESS, DONE]` |
| TE-M11 | DONE | TODO | ❌ `allowed: [REVIEW]` |
| TE-M12 | DONE | IN_PROGRESS | ❌ `allowed: [REVIEW]` |
| TE-M13 | TODO | TODO | ✅ chỉ đổi rank: version 4, event `TaskMoved { status: TODO, fromRank: "a0", toRank: "a5" }`, **không** có `TaskStatusChanged` |
| TE-M14 | IN_PROGRESS | IN_PROGRESS | ✅ như TE-M13 |
| TE-M15 | REVIEW | REVIEW | ✅ như TE-M13 |
| TE-M16 | DONE | DONE | ✅ như TE-M13 |

Case bổ sung:

| ID | Given | When | Then |
|---|---|---|---|
| TE-M17 | Mọi case ❌ ở trên | sau khi ném lỗi | Entity **không đổi** (status, rank, version, `updatedAt`), không có event |
| TE-M18 | task TODO rank `"a0"` | `moveTo(TODO, "a0")` | Trả `false` (no-op), version giữ nguyên, không event |
| TE-M19 | — | Bảng `ALLOWED_TRANSITIONS` của domain | Bằng đúng `TASK_STATUS_TRANSITIONS` trong `packages/contracts` (**test parity bắt buộc**, ADR-043; đặt ở `apps/api`, tầng U) |
| TE-M20 | task đổi status thành công | kiểm `updatedAt` | `= now` truyền vào |

### 1.3. assignTo

| ID | Given | When | Then |
|---|---|---|---|
| TE-A01 | task chưa gán, v1 | `assignTo(Max, Pam)` | `assigneeId = Max`, v2, event `TaskAssigneeChanged { from: null, to: Max, actorId: Pam }` |
| TE-A02 | task → Max | `assignTo(null, Pam)` | `assigneeId = null`, v+1, event `from: Max, to: null` |
| TE-A03 | task → Max | `assignTo(Mia, Pam)` | đổi, event `from: Max, to: Mia` |
| TE-A04 | task → Max | `assignTo(Max, Pam)` | `false`, no-op, không event |
| TE-A05 | task chưa gán | `assignTo(null, Pam)` | `false`, no-op |

(Membership/role của assignee và quyền gán **không** test ở entity — xem mục 2, 3.)

### 1.4. update

| ID | Given | When | Then |
|---|---|---|---|
| TE-U01 | title `"A cũ"` v2 | `update({ title: "B mới" })` | title đổi, v3, event `TaskUpdated { changedFields: ["title"], old: { title: "A cũ" }, new: { title: "B mới" } }` |
| TE-U02 | task | `update({ title: "x", priority: HIGH })` (title không hợp lệ) | `ValidationError`, **không** đổi priority (nguyên tử) |
| TE-U03 | priority MEDIUM | `update({ priority: MEDIUM, title: <giữ nguyên> })` | `false` no-op, không event |
| TE-U04 | dueDate có giá trị | `update({ dueDate: null })` | dueDate = null, `changedFields: ["dueDate"]` |
| TE-U05 | description có | `update({ description: "  " })` | description = null |
| TE-U06 | nhiều trường đổi | `update({ title, description, priority, dueDate })` | **Một** event `TaskUpdated` liệt kê đủ 4 trường, v+1 đúng 1 lần |
| TE-U07 | title `"Viết spec"` | `update({ title: "  Viết spec " })` | no-op (so sánh sau trim) |
| TE-U08 | `update({})` | — | `ValidationError` (phải có ≥ 1 trường; Zod đã chặn nhưng entity vẫn tự bảo vệ) |

### 1.5. softDelete & task đã xóa

| ID | Given | When | Then |
|---|---|---|---|
| TE-D01 | task v4 | `softDelete(Pam, now)` | `deletedAt = now`, v5, event `TaskDeleted { taskId, projectId, number, version: 5, actorId: Pam }` |
| TE-D02 | task đã xóa | `softDelete` lần nữa | Ném `TaskAlreadyDeletedError` (bất biến; use case sẽ trả 404 trước đó) |
| TE-D03 | task đã xóa | `update` / `moveTo` / `assignTo` | Ném `TaskAlreadyDeletedError`, không đổi gì |

### 1.6. version

| ID | Given | When | Then |
|---|---|---|---|
| TE-V01 | task v3 | `assertVersion(3)` | Không ném |
| TE-V02 | task v3 | `assertVersion(2)` hoặc `assertVersion(4)` | `VersionConflictError { currentVersion: 3 }` |
| TE-V03 | task v3 | chuỗi: update (đổi) → moveTo (đổi) → assignTo (no-op) → assignTo (đổi) | version cuối = 6 (mỗi thay đổi thật +1, no-op +0) |
| TE-V04 | task | gọi 2 thay đổi rồi `pullDomainEvents()` | Đúng 2 event theo thứ tự gọi |

---

## 2. TaskPolicy (tầng A, ADR-021/022/041/044)

Policy nhận `actor = { userId, role }` và task/ngữ cảnh, trả `allow | deny`. Test **dạng bảng** (`it.each`).

### 2.1. canDelete (ADR-022)

| ID | Actor | Task `createdById` | Kết quả |
|---|---|---|---|
| TP-D01 | Olivia (OWNER) | Mia | allow |
| TP-D02 | Pam (PM) | Mia | allow |
| TP-D03 | Mia (MEMBER) | Mia | allow |
| TP-D04 | Mia (MEMBER) | Max | deny |
| TP-D05 | Mia (MEMBER) | `null` | deny |
| TP-D06 | Pam (PM) | `null` | allow |
| TP-D07 | Vic (VIEWER) | Vic (giả định dữ liệu lạ) | deny |

### 2.2. canAssign (ADR-041) — `assignTo(target)` trên task hiện có

| ID | Actor | Task (createdBy, assignee hiện tại) | target | Kết quả |
|---|---|---|---|---|
| TP-A01 | Pam | (Mia, null) | Max | allow |
| TP-A02 | Olivia | (Pam, Max) | null | allow |
| TP-A03 | Mia | (Mia, null) | Max | allow — task mình tạo |
| TP-A04 | Mia | (Mia, Max) | null | allow — task mình tạo |
| TP-A05 | Mia | (Pam, null) | Mia | allow — tự nhận task trống |
| TP-A06 | Mia | (Pam, Mia) | null | allow — tự bỏ nhận |
| TP-A07 | Mia | (Pam, null) | Max | deny — gán người khác trên task không phải của mình |
| TP-A08 | Mia | (Pam, Max) | Mia | deny — "cướp" task đã có người |
| TP-A09 | Mia | (Pam, Max) | null | deny — bỏ gán người khác |
| TP-A10 | Mia | (Pam, Mia) | Max | deny — chuyển task của mình cho người khác khi không phải người tạo |
| TP-A11 | Vic | (Pam, null) | Vic | deny |
| TP-A12 | Mia | (`null`, null) | Mia | allow — tự nhận task trống (người tạo đã bị xóa) |

### 2.3. canAssignOnCreate (ADR-041)

| ID | Actor | `assigneeId` trong body | Kết quả |
|---|---|---|---|
| TP-AC01 | Mia | (không gửi) | allow |
| TP-AC02 | Mia | Mia | allow |
| TP-AC03 | Mia | Max | deny ⇒ 403 |
| TP-AC04 | Pam | Max | allow |
| TP-AC05 | Olivia | Mia | allow |

### 2.4. canUpdate / canMove / canCreate (ADR-041)

| ID | Actor | Kết quả |
|---|---|---|
| TP-U01 | Olivia, Pam, Mia (task người khác tạo) | allow cả update, move, create |
| TP-U02 | Vic | deny cả ba |

---

## 3. Use case

Cấu trúc chung mỗi use case: `execute({ workspaceId, projectId, taskId?, actor, input, clientId? })` → `TaskDto` (hoặc DTO tương ứng). `actor.role` đã được middleware nạp, nhưng use case **vẫn** tự kiểm phạm vi project ∈ workspace và task ∈ project (ADR-020 lớp 2).

### 3.1. CreateTaskUseCase

| ID | Tầng | Given | When | Then |
|---|---|---|---|---|
| UC-CR01 | A | P1 trống, `nextTaskNumber = 1` | Mia tạo `{ title: "Đầu tiên" }` | Trả `TaskDto { number: 1, key: "TF-1", status: TODO, priority: MEDIUM, version: 1, createdBy: Mia, assignee: null }`; `P1.nextTaskNumber = 2` |
| UC-CR02 | A | P1 có TODO: `TF-1 rank "a0"`, `TF-2 rank "a1"`; IN_PROGRESS có `TF-3 rank "a9"` | Mia tạo task | rank mới = `rankGen.between("a1", null)` — cuối cột **TODO**, bỏ qua cột khác |
| UC-CR03 | A | — | Mia tạo | Audit đúng 1 dòng `CREATED`, `actorId = Mia`, `workspaceId = W1`, `projectId = P1`, `newValue` có `{ number, title, status, priority, rank, dueDate, assigneeId }` (data-and-api §1.5), `requestId` được truyền |
| UC-CR04 | A | — | Mia tạo với `clientId = "c-1"` | Sau commit, `SpyEventBus` nhận 1 `TaskCreated`; realtime payload có `task` (TaskDto đầy đủ), `originClientId = "c-1"` |
| UC-CR05 | A | Audit repo ném lỗi | Mia tạo | Use case ném lỗi; **không** có task, `nextTaskNumber` không đổi (rollback), **không** publish event |
| UC-CR06 | A | Event bus ném lỗi khi publish | Mia tạo | Use case vẫn trả task thành công; lỗi được log (ADR-012) |
| UC-CR07 | A | P2 đã archive | Mia tạo trong P2 | `ProjectArchivedError` (422), không đốt số |
| UC-CR08 | A | P2 đã archive | Vic tạo trong P2 | `ForbiddenError` (403) — 403 đứng trước 422 |
| UC-CR09 | A | — | Vic tạo trong P1 | 403 |
| UC-CR10 | A | projectId = Q1 (thuộc W2), workspaceId = W1 | Mia tạo | `ResourceNotFoundError` (404) |
| UC-CR11 | A | — | Mia tạo với `assigneeId = Mia` | allow, `assignee = Mia` |
| UC-CR12 | A | — | Mia tạo với `assigneeId = Max` | 403 (TP-AC03) |
| UC-CR13 | A | — | Pam tạo với `assigneeId = Vic` | 422 `ASSIGNEE_NOT_MEMBER` (ADR-044) |
| UC-CR14 | A | — | Pam tạo với `assigneeId = Otto` | 422 `ASSIGNEE_NOT_MEMBER` |
| UC-CR15 | A | — | Pam tạo với `assigneeId = Zed` | 422 `ASSIGNEE_NOT_MEMBER` |
| UC-CR16 | I | P1 `nextTaskNumber = 7` | Mia tạo | DB: `tasks.number = 7`, `projects.next_task_number = 8`; `key = "TF-7"` |
| UC-CR17 | I | `TF-5` đã xóa mềm, `nextTaskNumber = 6` | Mia tạo | number = 6 (không tái sử dụng 5) |
| UC-CR18 | I | P1 và Q1 cùng prefix `TF` | tạo task ở mỗi project | Cả hai đều `TF-1`; unique `(project_id, number)` không xung đột |
| UC-CR19 | I | Audit insert bị ép lỗi (repo bọc ném sau khi insert task) | Mia tạo | DB không có task mới, `next_task_number` không đổi |
| UC-CR20 | I | — | Mia tạo | `tasks.workspace_id = W1`; thử chèn tay task với `(project_id = P1, workspace_id = W2)` ⇒ lỗi FK kép (D6) |
| UC-CR21 | I | — | — | Cột `rank` có collation `"C"`: `SELECT collation_name FROM information_schema.columns WHERE table_name='tasks' AND column_name='rank'` = `C` |

**Concurrency — cấp số TF-n (mục 1.2):**

| ID | Tầng | Given | When | Then |
|---|---|---|---|---|
| CC-CR01 | C | P1 `nextTaskNumber = 1` | 50 lệnh `create` song song (Mia, Max, Pam xen kẽ) | 50 task, `number` là đúng tập {1..50} (không trùng, không thiếu), `next_task_number = 51`, không lỗi 500 |
| CC-CR02 | C | P1 và P3 | 20 create P1 song song với 20 create P3 | Mỗi project có {1..20}; tổng thời gian không xấp xỉ gấp đôi chạy một project (lock theo dòng project, không khóa bảng) — chỉ log, không assert thời gian cứng |
| CC-CR03 | C | 10 create song song, lệnh thứ 5 bị ép rollback sau khi cấp số | — | 9 task thành công; tập number có **đúng 1 lỗ hổng** (số bị đốt, chấp nhận); không có số trùng |
| CC-CR04 | C | P1 đang hoạt động | 10 create song song + 1 archive P1 cùng lúc | Mỗi create trả 201 hoặc 422 `PROJECT_ARCHIVED`, không 500; mọi task được tạo có number liên tục từ 1; sau cùng P1 archived |
| CC-CR05 | C | 20 create song song vào cột TODO | — | Không có 2 task chưa xóa cùng `(project_id, status, rank)` (unique partial giữ được, server retry); mọi request 201 (hoặc tối đa `RESOURCE_CONFLICT` 409 sau 3 lần thử — phải log số lần) |

### 3.2. MoveTaskUseCase (ADR-010/011)

Bối cảnh chung: P1 có cột TODO `[A "a0", B "a1", C "a2"]`, IN_PROGRESS `[D "b0", E "b1"]`, tất cả version 1. `rankGen` thật (`fractional-indexing`) ở tầng I, giả (trả chuỗi dự đoán được) ở tầng A.

| ID | Tầng | Given | When | Then |
|---|---|---|---|---|
| UC-MV01 | A | — | Mia move A `{ expectedVersion: 1, status: IN_PROGRESS, afterId: D }` | A ở IN_PROGRESS, rank ∈ (D, E), v2; audit `STATUS_CHANGED { old: {TODO,"a0"}, new: {IN_PROGRESS, r} }`; event realtime `task:moved` có `from/to` |
| UC-MV02 | A | — | move C `{ v1, afterId: A }` (cùng cột) | Thứ tự TODO = A, C, B; audit `MOVED`; v2 |
| UC-MV03 | A | — | move A `{ v1, beforeId: C }` | Thứ tự B, A, C (A nằm giữa B và C) |
| UC-MV04 | A | — | move A `{ v1, status: IN_PROGRESS }` (không anchor) | A cuối IN_PROGRESS: rank > E |
| UC-MV05 | A | IN_PROGRESS trống | move A `{ v1, status: IN_PROGRESS }` | rank = `between(null, null)` |
| UC-MV06 | A | — | move C `{ v1, beforeId: A }` | C lên đầu: rank < A |
| UC-MV07 | A | Client cũ: tưởng thứ tự là A, B, C nhưng thực tế B đã dời đi chỗ khác, cột là A, C | move X vào `{ afterId: A, beforeId: B }` | Server dùng `afterId` + hàng xóm **thực tế** của A ⇒ X ∈ (A, C); không lỗi |
| UC-MV08 | A | — | move A `{ v1, afterId: D }` mà **không** gửi status (đích TODO, D ở IN_PROGRESS) | 422 `INVALID_ANCHOR` |
| UC-MV09 | A | — | move A `{ v1, afterId: A }` | 422 `INVALID_ANCHOR` |
| UC-MV10 | A | Task `F` của P3 | move A `{ v1, afterId: F }` | 422 `INVALID_ANCHOR` (không 404, không lộ F tồn tại ở đâu) |
| UC-MV11 | A | B đã xóa mềm | move A `{ v1, afterId: B }` | 422 `INVALID_ANCHOR` |
| UC-MV12 | A | anchor uuid không tồn tại | move A `{ v1, afterId: <uuid ngẫu nhiên> }` | 422 `INVALID_ANCHOR` |
| UC-MV13 | A | — | move A `{ v1, status: DONE }` | 422 `INVALID_STATUS_TRANSITION { from: TODO, to: DONE, allowed: [IN_PROGRESS] }` |
| UC-MV14 | A | A version 2 | move A `{ expectedVersion: 1, ... }` | 409 `VERSION_CONFLICT`, `details = { currentVersion: 2, current: TaskDto(A) }`; không audit, không event |
| UC-MV15 | A | — | move A `{ v1, afterId: <predecessor hiện tại = null>, beforeId: B }` (đúng chỗ cũ) | No-op: 200, v1 giữ nguyên, không audit, không event (R15) |
| UC-MV16 | A | A v2 | move A về đúng chỗ cũ với `expectedVersion: 1` | 409 (version kiểm trước no-op, mục 0.4) |
| UC-MV17 | A | task ARC-1 ở P2 archived | Mia move | 422 `PROJECT_ARCHIVED` |
| UC-MV18 | A | ARC-1 ở P2 archived, Vic move với version sai | — | 403 (không phải 422, không phải 409) |
| UC-MV19 | A | P2 archived, Mia move với version sai | — | 422 (không phải 409) |
| UC-MV20 | A | task thuộc P3, URL dùng P1 | Mia move | 404 |
| UC-MV21 | A | task đã xóa mềm | Mia move | 404 |
| UC-MV22 | A | Mia move task do Pam tạo, gán cho Max | — | allow (ADR-041: MEMBER move mọi task) |
| UC-MV23 | I | — | UC-MV01..06 trên Postgres với `fractional-indexing` thật | `ORDER BY rank, id` cho đúng thứ tự mong đợi; rank sinh ra so sánh đúng dưới collation `"C"` (vd `"a0" < "a0V" < "a1"`, chữ hoa < chữ thường) |
| UC-MV24 | I | Lệnh `updateMany({ where: { id, version: 1 } })` | version DB đã là 2 do một ghi khác lọt giữa lúc đọc và lúc ghi | `count = 0` ⇒ 409 (ADR-010), transaction rollback, không audit |

**Concurrency:**

| ID | Tầng | Given | When | Then |
|---|---|---|---|---|
| CC-MV01 | C | A v1 | 2 move A song song cùng `expectedVersion: 1` (đích khác nhau) | Đúng 1 thành công (v2), đúng 1 trả 409 với `current.version = 2`; đúng 1 dòng audit |
| CC-MV02 | C | 10 move song song cùng A, `expectedVersion: 1` | — | Đúng 1 thành công; 9 lần 409 |
| CC-MV03 | C | Cột TODO `[A, B]`, task X, Y ở IN_PROGRESS | X và Y cùng move vào TODO `{ afterId: A }` song song | Cả hai thành công (server retry khi va unique rank) **hoặc** một bên 409 `RESOURCE_CONFLICT` sau 3 lần; tuyệt đối không có 2 task trùng rank; thứ tự cuối cùng xác định |
| CC-MV04 | C | A v1 | Move A song song với Update A (cả hai `expectedVersion: 1`) | Đúng 1 thành công, bên kia 409 |

### 3.3. AssignTaskUseCase (ADR-041/044)

| ID | Tầng | Given | When | Then |
|---|---|---|---|---|
| UC-AS01 | A | t(Pam, null) v1 | Pam assign `{ v1, assigneeId: Max }` | assignee Max, v2; audit `ASSIGNEE_CHANGED { old: {assigneeId: null}, new: {assigneeId: Max} }`; realtime `task:updated` với `changedFields: ["assignee"]` |
| UC-AS02 | A | các tổ hợp TP-A01..A12 | qua use case | allow ⇒ 200; deny ⇒ 403 (đảm bảo use case thật sự gọi policy) |
| UC-AS03 | A | — | Pam assign cho Vic | 422 `ASSIGNEE_NOT_MEMBER` |
| UC-AS04 | A | — | Pam assign cho Otto | 422 `ASSIGNEE_NOT_MEMBER` |
| UC-AS05 | A | — | Pam assign cho Zed | 422 `ASSIGNEE_NOT_MEMBER` |
| UC-AS06 | A | — | Pam assign cho uuid không tồn tại | 422 `ASSIGNEE_NOT_MEMBER` (không 404 — không lộ user tồn tại) |
| UC-AS07 | A | task → Max | Pam assign Max | No-op 200, không audit/event |
| UC-AS08 | A | task v2 | Pam assign với v1 | 409 + `details.current` |
| UC-AS09 | A | Mia, task (Pam, Max) v1, version gửi sai | Mia assign Mia | 403 (policy trước version) |
| UC-AS10 | A | ARC-1 | Pam assign | 422 `PROJECT_ARCHIVED` |
| UC-AS11 | A | ARC-1 | Vic assign | 403 |
| UC-AS12 | A | Pam assign cho Max ở P2 archived **và** Max là VIEWER | — | 422 `PROJECT_ARCHIVED` (archived kiểm trước luật assignee) |
| UC-AS13 | I | — | Pam assign Max | Query kiểm membership dùng `FOR SHARE` trên dòng `workspace_members (W1, Max)` (kiểm bằng log SQL hoặc spy `$queryRaw`) |

**Bỏ gán khi mất quyền nhận việc (data-and-api §1.9, R14)** — thuộc use case của module Workspace nhưng do Task domain cung cấp `UnassignTasksOfUser` (ĐỀ XUẤT) nên spec ở đây:

| ID | Tầng | Given | When | Then |
|---|---|---|---|---|
| UC-UN01 | A | Max được gán TF-1 (P1), TF-4 (P3), ARC-1 (P2 archived), TF-9 (đã xóa mềm) | Olivia hạ Max xuống VIEWER | TF-1, TF-4, **ARC-1** bỏ gán (archived không chặn việc bỏ gán hệ thống — ĐỀ XUẤT, xem câu hỏi Q2 trong báo cáo); TF-9 giữ nguyên; mỗi task v+1, mỗi task 1 audit `ASSIGNEE_CHANGED` actor = Olivia; trả `unassignedTaskCount = 3` |
| UC-UN02 | A | như trên | Pam xóa Max khỏi W1 | Như UC-UN01 |
| UC-UN03 | A | như trên | Max tự rời W1 | Như UC-UN01, actor = Max |
| UC-UN04 | A | Max được gán task ở W2 | Olivia hạ Max ở W1 | Task ở W2 không đổi |
| UC-UN05 | A | Olivia đổi Max MEMBER → PM | — | Không bỏ gán gì, `unassignedTaskCount = 0` |
| UC-UN06 | A | sau commit UC-UN01 | — | 3 event realtime `task:updated` (`changedFields: ["assignee"]`) + `member:role-changed` cho Max |
| UC-UN07 | A | audit repo ném lỗi ở task thứ 2 | Olivia hạ Max | Rollback toàn bộ: role Max vẫn MEMBER, mọi task vẫn gán Max |
| CC-UN01 | C | TF-1 chưa gán, Max MEMBER | Song song: Pam assign TF-1 cho Max **và** Olivia hạ Max xuống VIEWER | Trạng thái cuối: Max là VIEWER **và** TF-1 không gán cho Max. Một trong hai kết quả: (a) assign 422 `ASSIGNEE_NOT_MEMBER`; (b) assign 200 rồi bị bỏ gán (có 2 audit). Lặp 50 lần không bao giờ ra trạng thái VIEWER-được-gán |

### 3.4. UpdateTaskUseCase

| ID | Tầng | Given | When | Then |
|---|---|---|---|---|
| UC-UP01 | A | TF-1 v1 | Mia update `{ v1, title: "Mới" }` | 200, v2; audit `UPDATED { old: {title}, new: {title} }` (chỉ trường đổi); realtime `task:updated changedFields: ["title"]` |
| UC-UP02 | A | description cũ 500 ký tự | Mia update description mới | Audit lưu `{ description: { changed: true, length } }`, **không** lưu nội dung (data-and-api §1.5) |
| UC-UP03 | A | — | Mia update task do Pam tạo | allow (ADR-041) |
| UC-UP04 | A | — | Vic update | 403 |
| UC-UP05 | A | ARC-1 | Mia update | 422 `PROJECT_ARCHIVED` |
| UC-UP06 | A | — | update giá trị y hệt | No-op 200, không audit/event/version |
| UC-UP07 | A | task v3 | update với v2 | 409 + `details.current` |
| UC-UP08 | A | — | update `{ v1, dueDate: "2020-01-01" }` | 200 (quá khứ cho phép) |
| UC-UP09 | A | — | update `{ v1, dueDate: null, description: null }` | Xóa cả hai, `changedFields` có cả hai |
| UC-UP10 | A | task đã xóa mềm | update | 404 |
| UC-UP11 | I | — | update thành công | `updated_at` đổi; câu UPDATE có điều kiện `version = expected` (ADR-010) |
| UC-UP12 | I-HTTP | — | `PATCH` body có field lạ `{ v1, title, createdById: Otto }` | 400 `VALIDATION_ERROR` (`z.strictObject`) |

### 3.5. DeleteTaskUseCase (ADR-022/045)

| ID | Tầng | Given | When | Then |
|---|---|---|---|---|
| UC-DL01 | A | TF-1 tạo bởi Mia, v3 | Mia xóa (không gửi version) | 200 `{ id, version: 4 }`; `deletedAt` set; audit `DELETED { old: {title, status}, new: null }`; realtime `task:deleted { taskId, projectId, key: "TF-1", version: 4 }` |
| UC-DL02 | A | TF-1 tạo bởi Mia | Max xóa | 403 |
| UC-DL03 | A | TF-1 tạo bởi Mia | Pam xóa | 200 |
| UC-DL04 | A | task `createdById = null` | Mia / Pam xóa | 403 / 200 |
| UC-DL05 | A | — | Vic xóa | 403 |
| UC-DL06 | A | ARC-1 (tạo bởi Mia) | Mia xóa | 422 `PROJECT_ARCHIVED` (ADR-045) |
| UC-DL07 | A | ARC-1 | Vic xóa | 403 |
| UC-DL08 | A | TF-1 v3 | Mia xóa với `expectedVersion = 2` | 409 |
| UC-DL09 | A | TF-1 v3 | Mia xóa với `expectedVersion = 3` | 200 |
| UC-DL10 | A | TF-1 đã xóa | Mia xóa lại | 404 |
| UC-DL11 | I | TF-1 xóa mềm | `GET` danh sách / `GET` chi tiết / move / assign / update | Danh sách không chứa TF-1; các lệnh còn lại 404 (R16) |
| UC-DL12 | I | TF-1 (rank `"a0"`, TODO) xóa mềm | Tạo task mới, ép rank `"a0"` ở TODO | Thành công — unique rank là partial `WHERE deleted_at IS NULL` |
| UC-DL13 | I | TF-1 xóa mềm | Đọc audit-logs của TF-1 | Trả đủ lịch sử gồm dòng `DELETED` (R16) |
| CC-DL01 | C | TF-1 v1 | Song song: Mia xóa `{ v1 }` và Pam update `{ v1 }` | Đúng 1 thành công; bên kia 409 (hoặc 404 nếu xóa thắng và update đọc sau — chấp nhận cả hai, không 500) |

### 3.6. ListTasksByProjectQuery (CQRS-lite, ADR-015)

| ID | Tầng | Given | When | Then |
|---|---|---|---|---|
| UC-LS01 | I | P1 có 3 task TODO, 2 IN_PROGRESS, 1 DONE, 1 đã xóa mềm | list `{}` | 6 task, sắp theo `status` (TODO, IN_PROGRESS, REVIEW, DONE), rồi `rank`, rồi `id`; không có task đã xóa |
| UC-LS02 | I | — | list `{ status: IN_PROGRESS }` | Chỉ 2 task IN_PROGRESS, theo rank |
| UC-LS03 | I | — | list `{ assigneeId: Max }` / `{ assigneeId: "none" }` | Chỉ task của Max / chỉ task chưa gán |
| UC-LS04 | I | P1 có 450 task | list `{ limit: 200 }` → theo `nextCursor` | 3 trang (200, 200, 50), không trùng, không sót; `hasMore` false ở trang cuối, `nextCursor = null` |
| UC-LS05 | I | Đang phân trang, một task ở trang 2 bị move lên đầu | Lấy trang 2 | Không lỗi; chấp nhận task bị sót/lặp (cursor theo khóa, không snapshot) — ghi rõ hành vi |
| UC-LS06 | I | P3 có task | list P1 | Không có task của P3 |
| UC-LS07 | I | URL `wsId = W1`, `projectId = Q1` | list | 404 |
| UC-LS08 | I | — | `limit = 0` / `501` / cursor giả / cursor của endpoint audit-logs | 400 `VALIDATION_ERROR` (`details.field = "limit"` / `"cursor"`) |
| UC-LS09 | I | Vic | list | 200 (VIEWER được đọc) |
| UC-LS10 | I | P2 archived | list P2 | 200, trả ARC-1 (archived vẫn đọc được) |
| UC-LS11 | I | — | list | Mỗi phần tử là `TaskDto` đầy đủ (key, assignee `{id, fullName}`, createdBy, version, dueDate dạng `YYYY-MM-DD`); `assignee` của Zed hiển thị tên đã ẩn danh hóa |
| UC-LS12 | I | — | `EXPLAIN` câu list `{ status }` | Dùng index `(project_id, status, rank)`, không seq scan khi bảng có ≥ 10 000 task (chạy nightly, không chạy mỗi PR) |
| UC-LS13 | I | — | GetTaskQuery TF-1 qua URL P3 | 404 |

### 3.7. ListTaskAuditLogsQuery

| ID | Tầng | Given | When | Then |
|---|---|---|---|---|
| UC-AU01 | I | TF-1 có chuỗi: CREATED → UPDATED → STATUS_CHANGED → ASSIGNEE_CHANGED → MOVED | list | 5 dòng, **mới nhất trước**, mỗi dòng `{ id, taskId, action, actor: {id, fullName}, oldValue, newValue, createdAt }` |
| UC-AU02 | I | 120 dòng audit | list `{ limit: 50 }` theo cursor | 50, 50, 20; không trùng/sót, kể cả khi nhiều dòng cùng `created_at` (phá hòa bằng `id`) |
| UC-AU03 | I | TF-1 đã xóa mềm | list | 200, gồm dòng DELETED |
| UC-AU04 | I | Actor của một dòng là Zed (đã ẩn danh hóa) | list | `actor.fullName = "Người dùng đã xóa"`; dòng vẫn còn (FK Restrict, D3) |
| UC-AU05 | I | taskId thuộc P3, URL P1 | list | 404 |
| UC-AU06 | I | Vic | list | 200 |
| UC-AU07 | I | — | thử `DELETE FROM users WHERE id = Mia` (Mia có audit) | Lỗi FK (Restrict) — xác nhận D3 |
| UC-AU08 | U/A | — | Mọi use case ghi ở 3.1–3.5 | Mỗi thay đổi thật = **đúng 1** dòng audit; no-op = 0 dòng; lỗi = 0 dòng (test tổng hợp `it.each` trên các use case) |

### 3.8. Ánh xạ domain event → realtime (tầng A, listener)

| ID | Domain event | Realtime | Kiểm |
|---|---|---|---|
| RT-01 | `TaskCreated` | `task:created { task }` | `task` là `TaskDto` đầy đủ đọc **sau commit** (version đúng) |
| RT-02 | `TaskStatusChanged` | `task:moved { task, from, to }` | from/to có status + rank |
| RT-03 | `TaskMoved` | `task:moved` | `from.status = to.status` |
| RT-04 | `TaskUpdated` | `task:updated { task, changedFields }` | changedFields khớp domain event |
| RT-05 | `TaskAssigneeChanged` | `task:updated { changedFields: ["assignee"] }` | |
| RT-06 | `TaskDeleted` | `task:deleted { taskId, projectId, key, version }` | |
| RT-07 | mọi event | vỏ `{ eventId, type, occurredAt, actorId, originClientId, data }` | `eventId` uuid duy nhất; `originClientId = null` nếu `X-Client-Id` không phải uuid (T-002 §5.2); phát vào phòng `project:{projectId}` |
| RT-08 | Use case rollback | — | Không phát gì |
| RT-09 | Một use case phát nhiều domain event (vd status + rank) | — | Đúng **1** realtime event (data-and-api §4.3) |

---

## 4. Ma trận truy vết luật → test

| Luật / ADR | Test |
|---|---|
| R1 title | TE-C03..06, TE-U02, UC-UP12 |
| R2 description | TE-C07, TE-C08, TE-U05, UC-UP02 |
| R3 priority mặc định | TE-C01, UC-CR01 |
| R4 dueDate | TE-C09, TE-C10, UC-UP08 |
| R5 / ADR-023 / ADR-045 archived | UC-CR07, UC-MV17, UC-AS10, UC-UP05, UC-DL06, CC-CR04 |
| R6 / ADR-044 assignee ≥ MEMBER | UC-CR13..15, UC-AS03..06, UC-AS13, CC-UN01 |
| R7 / ADR-041 quyền gán | TP-A01..12, TP-AC01..05, UC-AS02, UC-CR11..12 |
| R8 / ADR-041 sửa/move mọi task | TP-U01, UC-MV22, UC-UP03 |
| R9 / ADR-022 xóa | TP-D01..07, UC-DL01..05 |
| R10 / ADR-010 version | TE-V01..04, UC-MV14, UC-MV24, UC-AS08, UC-UP07, UC-DL08, CC-MV01..04 |
| R11 anchor | UC-MV08..12 |
| R12 / FR-03 cấp số | UC-CR01, UC-CR16..18, CC-CR01..04 |
| R13 / ADR-012 audit cùng transaction | UC-CR03, UC-CR05, UC-CR19, UC-UN07, UC-AU08 |
| R14 bỏ gán | UC-UN01..07, CC-UN01 |
| R15 no-op | TE-M18, TE-A04, TE-U03, TE-U07, UC-MV15, UC-AS07, UC-UP06 |
| R16 xóa mềm | TE-D01..03, UC-DL10..13, UC-MV21, UC-UP10 |
| State machine | TE-M01..17, UC-MV13 |
| ADR-011 rank | UC-CR02, UC-MV01..07, UC-MV23, UC-CR21, UC-DL12, CC-CR05, CC-MV03 |
| ADR-013 domain events | TE-C02, TE-M01, TE-M13, TE-A01, TE-U01, TE-D01, RT-01..09 |
| ADR-020 phạm vi tenant | UC-CR10, UC-CR20, UC-MV20, UC-LS06, UC-LS07, UC-LS13, UC-AU05 |
| ADR-043 parity | TE-M19 |
| Thứ tự 404→403→422→409 | UC-CR08, UC-MV16, UC-MV18, UC-MV19, UC-AS09, UC-AS12, UC-DL07 |

## 5. Gợi ý bố trí file (chốt ở Phase 1)

```
apps/api/src/modules/task/
  domain/__tests__/task.entity.spec.ts            TE-*
  domain/__tests__/task-status-parity.spec.ts     TE-M19
  application/__tests__/task.policy.spec.ts       TP-*
  application/__tests__/create-task.spec.ts       UC-CR (A)
  application/__tests__/move-task.spec.ts         UC-MV (A)
  application/__tests__/assign-task.spec.ts       UC-AS, UC-UN (A)
  application/__tests__/update-task.spec.ts       UC-UP (A)
  application/__tests__/delete-task.spec.ts       UC-DL (A)
  application/__tests__/realtime-mapping.spec.ts  RT-*
  infrastructure/__tests__/*.int.spec.ts          tầng I
  infrastructure/__tests__/*.concurrency.spec.ts  tầng C
apps/api/test/support/
  fixtures.ts         W1/P1/... (mục 0.2) — dựng được cho cả InMemory và Postgres
  in-memory/*.ts      repo in-memory + FakeTransactionManager
```

Vitest tách project: `unit` (U + A, chạy mỗi lần lưu), `integration` (I), `concurrency` (C, chạy ở PR với 1 lượt, nightly 20 lượt).
