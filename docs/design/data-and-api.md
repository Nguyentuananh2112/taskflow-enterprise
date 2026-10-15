# Data model v1.1 & API / WebSocket contract

> Ticket: T-003 · Tác giả: Engineer C (`taskflow-enterprise-ba`) · Trạng thái: **Chính thức (ADR-040)** · cập nhật T-003b (ADR-041 → ADR-047)
> Nguồn ưu tiên: `docs/blueprint/DECISIONS.md` (v1.1) > tài liệu này > blueprint v1.0.
> Ký hiệu: `T-002` = đã chốt với Engineer B · `ĐỀ XUẤT` = quyết định tôi tự đưa ra, chưa có ADR. Các điểm cú pháp Prisma/Zod đã được T-001 kiểm chứng (`docs/research/stack-versions.md` §8) — cập nhật T-003c.

## Mục lục
1. Data model v1.1 (Prisma)
2. REST API contract
3. Envelope & mã lỗi
4. WebSocket contract
5. Thiết kế `packages/contracts`
6. Luật nghiệp vụ task

---

## 1. Data model v1.1

### 1.1. Các quyết định chính

| # | Vấn đề | Quyết định | Lý do |
|---|---|---|---|
| D1 | Task xóa mềm hay cứng | **Xóa mềm** (`tasks.deleted_at`). Mọi query đọc lọc `deleted_at IS NULL`. Không có endpoint khôi phục / job purge ở v1 (ADR-042). | Audit log giữ FK hợp lệ tới task; mã `TF-101` không bao giờ bị tái sử dụng; khôi phục được khi xóa nhầm (production thật). Chi phí: phải nhớ lọc → gom vào Query handler/repository, index partial. |
| D2 | User bị xóa | **Không bao giờ hard-delete user.** Xóa tài khoản (tương lai) = *ẩn danh hóa*: đặt `deleted_at`, thay email thành `deleted+<id>@invalid`, `full_name = "Người dùng đã xóa"`, `password_hash` ngẫu nhiên, thu hồi mọi refresh token, xóa membership. | Lịch sử audit giữ được người thực hiện mà không lưu PII. |
| D3 | `TaskAuditLog.actorId` | FK `onDelete: Restrict` (không Cascade như v1.0). | Kết hợp D2: không thể vô tình xóa user làm mất lịch sử; nếu ai đó cố hard-delete, DB chặn. |
| D4 | Audit sống sót khi xóa task | Có — nhờ D1 (task chỉ xóa mềm). FK `task_id` vẫn `Cascade` để khi **purge workspace** (sau 30 ngày ân hạn, D12) thì audit đi theo. | Xóa workspace = khách hàng yêu cầu xóa dữ liệu → audit cũng phải mất, nhưng chỉ sau ân hạn. |
| D5 | `workspaceId`/`projectId` trên audit | Có, là cột thường (không FK), bất biến. | Truy vấn activity feed theo project/workspace không cần join; kiểm tra tenant khi đọc. |
| D6 | `workspaceId` trên task | Có, denormalize. Ràng buộc nhất quán bằng **FK kép** `(project_id, workspace_id) → projects(id, workspace_id)`. | Kiểm tra tenant 1 bước (ADR-020 lớp 2) và DB đảm bảo task không thể "lệch" workspace với project. |
| D7 | Mã task `TF-101` | `Project.keyPrefix` (bất biến sau khi tạo — ADR-040), `Project.nextTaskNumber`, `Task.number`. `key` **không lưu** — suy ra `${keyPrefix}-${number}`. | Đổi prefix sẽ làm gãy mọi link cũ → cấm ở v1.1. |
| D8 | Project archive | `archivedAt DateTime?` thay `isArchived Boolean`. DTO vẫn trả `isArchived`. | Biết thời điểm archive mà không cần cột thứ hai. |
| D9 | Khóa chính | UUID v7 (`@default(uuid(7))`, `@db.Uuid`) — Prisma 7.10 hỗ trợ (stack-versions §8.2). UUID do **Prisma Client** sinh, DB không có DEFAULT ⇒ mọi `INSERT` bằng `$queryRaw` phải tự truyền id. | Chèn theo thứ tự thời gian → B-tree ít phân mảnh; vẫn không đoán được tuần tự như int. |
| D10 | `dueDate` | Kiểu **ngày** (`@db.Date`), API dùng chuỗi `YYYY-MM-DD`. | Hạn chót là khái niệm ngày, tránh lệch múi giờ khi FE/BE khác TZ. |
| D11 | Email | Lưu đã chuẩn hóa (trim + lowercase) ở tầng ứng dụng; unique thường. | Không phụ thuộc extension `citext`. |
| D12 | Workspace xóa mềm (ADR-047) | `workspaces.deleted_at`, `purge_at` (= deleted_at + 30 ngày), `deleted_by_id`. Trong ân hạn: mọi truy cập ⇒ 404, dữ liệu/membership giữ nguyên, OWNER khôi phục được. Hết hạn ⇒ job purge xóa cứng (cascade). Chi tiết mục 1.7. | Một cú bấm không được làm mất toàn bộ dữ liệu + audit. |

### 1.2. Cấp số task an toàn khi đồng thời (FR-03)

Trong **cùng transaction** của `CreateTaskUseCase` (qua `ITransactionManager`, ADR-012):

```sql
UPDATE projects
   SET next_task_number = next_task_number + 1, updated_at = now()
 WHERE id = $projectId AND workspace_id = $wsId AND archived_at IS NULL
RETURNING next_task_number - 1 AS number, key_prefix;
```

- `UPDATE` lấy row-lock trên dòng project → các request tạo task đồng thời trong cùng project xếp hàng, mỗi request nhận một số khác nhau. Lock chỉ giữ tới hết transaction (ngắn).
- 0 dòng trả về → project không tồn tại/khác tenant (404) **hoặc** đã archive (`PROJECT_ARCHIVED`) — use case đọc lại để phân biệt. Đây cũng là lần kiểm tra archived *nguyên tử* với thao tác tạo.
- **Chốt: dùng `tx.$queryRaw` với câu SQL trên.** Không dùng `tx.project.update({ where: { id, workspaceId, archivedAt: null }, … })`: cú pháp hợp lệ (`extendedWhereUnique` GA từ Prisma 5), nhưng khi không khớp nó **ném `P2025`** thay vì trả 0 dòng, nên luồng thường phải đi qua exception (stack-versions §8.5).
- Nếu transaction rollback, số đó bị "đốt" → mã có thể nhảy cóc (TF-7 → TF-9). Chấp nhận, giống Jira.
- `@@unique([projectId, number])` là lưới an toàn cuối cùng.

### 1.3. Rank (ADR-011)

- `rank` là chuỗi do `fractional-indexing` sinh, cột dùng **collation `"C"`** (so byte, đúng thứ tự thư viện). Prisma 7.10 không khai báo được collation cột (stack-versions §8.3) → tạo migration bằng `pnpm exec prisma migrate dev --create-only` rồi thêm tay `ALTER TABLE "tasks" ALTER COLUMN "rank" TYPE text COLLATE "C";` (ADR-062). Prisma không quản lý collation nên không thấy drift; có test integration khẳng định collation (test-spec-task UC-CR21, UC-MV23).
- Sắp xếp luôn `ORDER BY rank, id` (id phá hòa nếu có trùng).
- **Unique partial** `(project_id, status, rank) WHERE deleted_at IS NULL` — khai báo **native** bằng preview `partialIndexes` của Prisma 7.10 (ADR-062): `@@unique([projectId, status, rank], map: "tasks_rank_live_key", where: raw("deleted_at IS NULL"))`. CI kiểm `prisma migrate diff` rỗng. Khi 2 người thả vào cùng một khe cùng lúc, thư viện sinh cùng key → một bên vi phạm unique → server **tự thử lại tối đa 3 lần** với hàng xóm đọc mới; vẫn lỗi → `409 RESOURCE_CONFLICT`.
- Task mới: rank = `generateKeyBetween(lastRankInColumn, null)` (cuối cột TODO).
- Rebalance (rank quá dài) ngoài phạm vi v1.1; log cảnh báo khi `length(rank) > 100`.

### 1.4. Schema Prisma v1.1

```prisma
// Prisma 7.10.0 (ADR-060/062, stack-versions §8.1). URL nằm ở apps/api/prisma.config.ts:
//   datasource: { url: process.env.DATABASE_URL ?? "" }   (ADR-061; không dùng env())
// Client tạo ở composition root với driver adapter @prisma/adapter-pg (ADR-016).
// Luôn chạy CLI bằng `pnpm exec prisma`, cấm `npx prisma` (ADR-061).
generator client {
  provider        = "prisma-client"
  output          = "../src/generated/prisma"
  previewFeatures = ["partialIndexes"]
}

datasource db {
  provider = "postgresql" // không có url ở đây
}

enum WorkspaceRole {
  OWNER
  PM
  MEMBER
  VIEWER
}

enum TaskStatus {
  TODO
  IN_PROGRESS
  REVIEW
  DONE
}

enum TaskPriority {
  LOW
  MEDIUM
  HIGH
  URGENT
}

enum TaskAuditAction {
  CREATED
  UPDATED            // title/description/priority/dueDate
  STATUS_CHANGED     // đổi cột (có thể kèm đổi rank)
  MOVED              // chỉ đổi rank trong cùng cột
  ASSIGNEE_CHANGED
  DELETED
}

enum RefreshTokenRevokeReason { // chốt với T-002
  ROTATED
  LOGOUT
  LOGOUT_ALL
  REUSE_DETECTED
  PASSWORD_CHANGED
  USER_DELETED
}

model User {
  id                String    @id @default(uuid(7)) @db.Uuid
  email             String    @unique @db.VarChar(254) // trim+lowercase+NFC ở app; CHECK (email = lower(email)) bằng SQL tay
  passwordHash      String    @map("password_hash")    // argon2id PHC string (ADR-065)
  fullName          String    @map("full_name") @db.VarChar(100)
  tokenVersion      Int       @default(0) @map("token_version")          // ADR-025
  passwordChangedAt DateTime? @map("password_changed_at") @db.Timestamptz(3)
  lastLoginAt       DateTime? @map("last_login_at") @db.Timestamptz(3)
  deletedAt         DateTime? @map("deleted_at") @db.Timestamptz(3)       // D2; khác null ⇒ login/refresh bị từ chối như sai thông tin; set cùng tx với tăng token_version + thu hồi token (USER_DELETED)
  createdAt         DateTime  @default(now()) @map("created_at") @db.Timestamptz(3)
  updatedAt         DateTime  @updatedAt @map("updated_at") @db.Timestamptz(3)

  memberships   WorkspaceMember[]
  refreshTokens RefreshToken[]
  assignedTasks Task[]            @relation("TaskAssignee")
  createdTasks  Task[]            @relation("TaskCreator")
  auditLogs     TaskAuditLog[]
  deletedWorkspaces Workspace[]   @relation("WorkspaceDeleter")

  @@map("users")
}

model RefreshToken { // ADR-024, chốt với T-002
  id            String                    @id @default(uuid(7)) @db.Uuid
  userId        String                    @map("user_id") @db.Uuid
  tokenHash     String                    @unique @map("token_hash") @db.Char(64) // SHA-256 hex
  familyId      String                    @map("family_id") @db.Uuid // nhóm phiên, KHÔNG phải FK
  replacedById  String?                   @unique @map("replaced_by_id") @db.Uuid
  expiresAt       DateTime                @map("expires_at") @db.Timestamptz(3)        // = min(now+7d, familyExpiresAt)
  familyExpiresAt DateTime                @map("family_expires_at") @db.Timestamptz(3) // hạn tuyệt đối phiên (30 ngày từ login), copy khi xoay
  revokedAt     DateTime?                 @map("revoked_at") @db.Timestamptz(3)
  revokedReason RefreshTokenRevokeReason? @map("revoked_reason")
  userAgent     String?                   @map("user_agent") @db.VarChar(255) // cắt 255, chỉ forensics/danh sách phiên
  ip            String?                   @db.Inet
  createdAt     DateTime                  @default(now()) @map("created_at") @db.Timestamptz(3)

  user       User          @relation(fields: [userId], references: [id], onDelete: Cascade)
  replacedBy RefreshToken? @relation("TokenRotation", fields: [replacedById], references: [id], onDelete: SetNull)
  replaces   RefreshToken? @relation("TokenRotation")

  @@index([userId, revokedAt])
  @@index([familyId])
  @@index([expiresAt])
  @@map("refresh_tokens")
}

model Workspace {
  id          String    @id @default(uuid(7)) @db.Uuid
  name        String    @db.VarChar(100)
  slug        String    @unique @db.VarChar(50) // vẫn giữ chỗ khi xóa mềm → khôi phục không đụng slug
  deletedAt   DateTime? @map("deleted_at") @db.Timestamptz(3) // ADR-047
  purgeAt     DateTime? @map("purge_at") @db.Timestamptz(3)   // = deleted_at + 30 ngày
  deletedById String?   @map("deleted_by_id") @db.Uuid
  createdAt   DateTime  @default(now()) @map("created_at") @db.Timestamptz(3)
  updatedAt   DateTime  @updatedAt @map("updated_at") @db.Timestamptz(3)

  deletedBy User?             @relation("WorkspaceDeleter", fields: [deletedById], references: [id], onDelete: SetNull)
  members   WorkspaceMember[]
  projects  Project[]

  @@index([purgeAt], map: "workspaces_purge_at_idx", where: raw("purge_at IS NOT NULL")) // partialIndexes (ADR-062)
  @@index([deletedById])
  @@map("workspaces")
}

model WorkspaceMember {
  id          String        @id @default(uuid(7)) @db.Uuid
  workspaceId String        @map("workspace_id") @db.Uuid
  userId      String        @map("user_id") @db.Uuid
  role        WorkspaceRole @default(MEMBER)
  joinedAt    DateTime      @default(now()) @map("joined_at") @db.Timestamptz(3)
  updatedAt   DateTime      @updatedAt @map("updated_at") @db.Timestamptz(3)

  workspace Workspace @relation(fields: [workspaceId], references: [id], onDelete: Cascade)
  user      User      @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@unique([workspaceId, userId])
  @@index([userId])
  @@index([workspaceId, role]) // ADR-051: khóa dòng OWNER (ADR-046)
  @@map("workspace_members")
}

model Project {
  id             String    @id @default(uuid(7)) @db.Uuid
  workspaceId    String    @map("workspace_id") @db.Uuid
  name           String    @db.VarChar(100)
  keyPrefix      String    @map("key_prefix") @db.VarChar(10) // ^[A-Z][A-Z0-9]{1,9}$, bất biến
  description    String?   @db.VarChar(2000)
  nextTaskNumber Int       @default(1) @map("next_task_number")
  archivedAt     DateTime? @map("archived_at") @db.Timestamptz(3)
  createdAt      DateTime  @default(now()) @map("created_at") @db.Timestamptz(3)
  updatedAt      DateTime  @updatedAt @map("updated_at") @db.Timestamptz(3)

  workspace Workspace @relation(fields: [workspaceId], references: [id], onDelete: Cascade)
  tasks     Task[]

  @@unique([workspaceId, keyPrefix])
  @@unique([id, workspaceId]) // đích của FK kép từ tasks (D6)
  @@index([workspaceId, archivedAt])
  @@map("projects")
}

model Task {
  id          String       @id @default(uuid(7)) @db.Uuid
  workspaceId String       @map("workspace_id") @db.Uuid
  projectId   String       @map("project_id") @db.Uuid
  number      Int
  title       String       @db.VarChar(150)
  description String?      // ≤ 10 000 ký tự, kiểm ở app
  status      TaskStatus   @default(TODO)
  priority    TaskPriority @default(MEDIUM)
  rank        String       // COLLATE "C" — thêm tay trong migration (mục 1.3)
  version     Int          @default(1)
  dueDate     DateTime?    @map("due_date") @db.Date
  assigneeId  String?      @map("assignee_id") @db.Uuid
  createdById String?      @map("created_by_id") @db.Uuid // ADR-022
  deletedAt   DateTime?    @map("deleted_at") @db.Timestamptz(3)
  createdAt   DateTime     @default(now()) @map("created_at") @db.Timestamptz(3)
  updatedAt   DateTime     @updatedAt @map("updated_at") @db.Timestamptz(3)

  project   Project        @relation(fields: [projectId, workspaceId], references: [id, workspaceId], onDelete: Cascade)
  assignee  User?          @relation("TaskAssignee", fields: [assigneeId], references: [id], onDelete: SetNull)
  createdBy User?          @relation("TaskCreator", fields: [createdById], references: [id], onDelete: SetNull)
  auditLogs TaskAuditLog[]

  @@unique([projectId, number])
  @@unique([projectId, status, rank], map: "tasks_rank_live_key", where: raw("deleted_at IS NULL")) // ADR-062; phục vụ cả đọc board (query luôn có deleted_at IS NULL)
  @@index([assigneeId])
  @@index([createdById])
  @@map("tasks")
}

model TaskAuditLog {
  id          String          @id @default(uuid(7)) @db.Uuid
  workspaceId String          @map("workspace_id") @db.Uuid // D5, không FK
  projectId   String          @map("project_id") @db.Uuid   // D5, không FK
  taskId      String          @map("task_id") @db.Uuid
  actorId     String          @map("actor_id") @db.Uuid
  action      TaskAuditAction
  oldValue    Json?           @map("old_value")
  newValue    Json?           @map("new_value")
  requestId   String?         @map("request_id") @db.VarChar(64) // truy vết với log pino
  createdAt   DateTime        @default(now()) @map("created_at") @db.Timestamptz(3)

  task  Task @relation(fields: [taskId], references: [id], onDelete: Cascade)
  actor User @relation(fields: [actorId], references: [id], onDelete: Restrict) // D3

  @@index([taskId, createdAt(sort: Desc), id(sort: Desc)])
  @@index([actorId])
  @@index([projectId, createdAt(sort: Desc)])
  @@map("task_audit_logs")
}
```

Ghi chú: audit log là **append-only** — repository chỉ có `append()`, không có update/delete (ép bằng code review + `dependency-cruiser` không cần; đủ bằng interface).

### 1.5. Hình dạng `oldValue` / `newValue` theo action

| action | oldValue | newValue |
|---|---|---|
| CREATED | `null` | `{ number, title, status, priority, rank, dueDate, assigneeId }` |
| UPDATED | chỉ các trường đã đổi, giá trị cũ, vd `{ title: "A" }` | cùng khóa, giá trị mới |
| STATUS_CHANGED | `{ status, rank }` | `{ status, rank }` |
| MOVED | `{ rank }` | `{ rank }` |
| ASSIGNEE_CHANGED | `{ assigneeId }` | `{ assigneeId }` |
| DELETED | `{ title, status }` | `null` |

`description` trong UPDATED: chỉ lưu `{ description: { changed: true, length } }` thay nội dung đầy đủ — ADR-040, tránh audit phình to (10 KB × mỗi lần sửa).

### 1.6. Index và lý do

| Bảng | Index | Lý do |
|---|---|---|
| users | `UNIQUE(email)` | Đăng nhập theo email; chặn trùng. |
| refresh_tokens | `UNIQUE(token_hash)` | Tra token khi refresh. |
| | `UNIQUE(replaced_by_id)` | FK tự tham chiếu; 1 token chỉ bị thay bởi 1 token. |
| | `(user_id, revoked_at)` | FK user_id; logout-all: thu hồi mọi token chưa thu hồi của user. |
| | `(family_id)` | Phát hiện reuse → thu hồi cả family. |
| | `(expires_at)` | Job dọn token hết hạn. |
| workspaces | `UNIQUE(slug)` | URL thân thiện, chặn trùng (kể cả workspace đang xóa mềm). |
| | `(purge_at)` partial `WHERE purge_at IS NOT NULL` | Job purge quét workspace hết ân hạn. |
| | `(deleted_by_id)` | FK (SetNull). |
| workspace_members | `UNIQUE(workspace_id, user_id)` | Mỗi user 1 role/workspace; middleware membership tra theo cặp này (đường nóng nhất hệ thống); phủ FK workspace_id. |
| | `(workspace_id, role)` | ADR-051: `SELECT … WHERE role = 'OWNER' FOR UPDATE` (mục 1.8) chỉ quét/khóa dòng OWNER. |
| | `(user_id)` | FK; "workspace của tôi". |
| projects | `UNIQUE(workspace_id, key_prefix)` | FR-03; phủ FK workspace_id. |
| | `UNIQUE(id, workspace_id)` | Đích FK kép (D6). |
| | `(workspace_id, archived_at)` | Danh sách project lọc archived. (Có thể bỏ vì unique trên đã dẫn đầu bằng workspace_id — giữ nếu workspace nhiều project.) |
| tasks | `UNIQUE(project_id, number)` | Mã TF-101 duy nhất; phủ FK kép (project_id dẫn đầu). |
| | `UNIQUE(project_id, status, rank) WHERE deleted_at IS NULL` (`tasks_rank_live_key`) | Đọc bảng Kanban theo cột đã sắp; tìm hàng xóm khi move; chống trùng rank. Không cần thêm index không-partial vì mọi query đọc đều lọc `deleted_at IS NULL`. |
| | `(assignee_id)` | FK (SetNull); "task của tôi". |
| | `(created_by_id)` | FK (SetNull); policy xóa task của mình. |
| task_audit_logs | `(task_id, created_at DESC, id DESC)` | FK; phân trang cursor lịch sử task. |
| | `(actor_id)` | FK Restrict — DB cần index để kiểm tra khi xóa user. |
| | `(project_id, created_at DESC)` | Activity feed theo project (Phase sau; có thể hoãn tạo). |

### 1.7. Xóa mềm workspace (ADR-047)

**Xóa** (`DELETE /workspaces/:wsId`, OWNER), trong một transaction:

1. `SELECT … FROM workspaces WHERE id = $wsId AND deleted_at IS NULL FOR UPDATE` (chặn xóa/khôi phục đồng thời).
2. `UPDATE workspaces SET deleted_at = now(), purge_at = now() + interval '30 days', deleted_by_id = $actor`.
3. Không đụng membership, project, task, audit — tất cả giữ nguyên để khôi phục được.

Sau commit: phát `workspace:access-revoked { workspaceId }` vào phòng `user:{userId}` của **mọi** thành viên và `socketsLeave` mọi phòng `project:*` của workspace (ADR-027).

**Loại workspace đã xóa khỏi mọi truy cập** (trả `404 RESOURCE_NOT_FOUND`, như không tồn tại):

- Middleware `requireMembership(wsId)` join điều kiện `workspaces.deleted_at IS NULL` — một điểm kiểm tra duy nhất cho mọi route `/workspaces/:wsId/**`. Nếu có cache membership thì phải xóa khi workspace bị xóa/khôi phục.
- `project:join` (socket) dùng cùng hàm kiểm tra ⇒ `{ ok: false, code: "RESOURCE_NOT_FOUND" }`.
- `GET /workspaces` và `GET /auth/me` (`memberships`) lọc `deleted_at IS NULL`.
- Lệnh ghi đang chạy dở lúc workspace bị xóa vẫn có thể commit — vô hại vì dữ liệu được giữ tới khi purge và đi theo khi khôi phục.

**Khôi phục** (ADR-050: có, trong 30 ngày) — `POST /workspaces/:wsId/restore`:

- Middleware riêng `requireMembership(wsId, { includeDeleted: true, minRole: OWNER })`. Membership được giữ nguyên khi xóa, nên OWNER lúc xóa vẫn là OWNER. Không phải OWNER / workspace chưa xóa / đã quá `purge_at` (job chưa kịp chạy) ⇒ `404`.
- Cập nhật có điều kiện, rồi kiểm `count === 1`, nếu không ⇒ 404: `UPDATE workspaces SET deleted_at = NULL, purge_at = NULL, deleted_by_id = NULL WHERE id = $wsId AND deleted_at IS NOT NULL AND purge_at > now()`. Purge job chỉ xóa khi `purge_at <= now()` và kiểm lại điều kiện đó sau khi khóa dòng ⇒ hai điều kiện loại trừ nhau, restore và purge không race. Không cần kiểm slug (slug vẫn giữ chỗ).
- Yêu cầu bảo mật (T-002 §3.6):
  - `includeDeleted` **chỉ** dùng ở route restore, có test chặn dùng ở route khác.
  - Mọi thất bại, kể cả PM/MEMBER của chính workspace đó, trả **cùng một body 404**.
  - Rate limit 10/giờ/user, ghi log sự kiện bảo mật.
  - `?deleted=true` chỉ trả workspace mình là OWNER và chưa quá `purge_at`.
- Trạng thái: ✅ ADR-050 — SEC-51..55 bắt buộc.
- Không phát socket event; thành viên thấy lại workspace qua `GET /workspaces`.
- OWNER xem danh sách có thể khôi phục qua `GET /workspaces?deleted=true` (kèm `purgeAt`). v1 không cache membership (T-002).

**Purge job** — ĐỀ XUẤT (T-003c, T-001 không chốt cơ chế lịch): `setInterval` mỗi giờ trong process API, chỉ instance nào lấy được `pg_try_advisory_lock(<hằng số PURGE_LOCK_ID>)` mới chạy, nhả khóa khi xong. Không thêm thư viện hàng đợi, không phụ thuộc Valkey (ADR-063); an toàn khi nhiều instance (ADR-000). Nếu sau này có hàng đợi job thì chuyển sang đó.

- Chạy mỗi giờ, lấy `WHERE purge_at <= now()` theo lô. Với mỗi workspace: khóa dòng, kiểm lại `purge_at` (có thể vừa được khôi phục), rồi xóa cứng.
- Tránh một transaction khổng lồ: xóa `task_audit_logs` rồi `tasks` theo lô (vd 5 000 dòng) theo project, sau cùng `DELETE FROM workspaces` (cascade phần còn lại). Idempotent — chạy lại sau lỗi giữa chừng là an toàn.
- Log có cấu trúc: `workspaceId`, số dòng đã xóa, thời gian chạy. Không phát socket event.
- Dữ liệu đã purge không khôi phục được (ngoài backup DB — ngoài phạm vi tài liệu này).

### 1.8. Chống race luật LAST_OWNER (ADR-046)

Áp dụng cho: hạ role của OWNER, xóa thành viên là OWNER, OWNER tự rời. Trong **cùng transaction** với thay đổi:

```sql
SELECT user_id FROM workspace_members
 WHERE workspace_id = $wsId AND role = 'OWNER'
 ORDER BY id            -- thứ tự khóa cố định, tránh deadlock
 FOR UPDATE;
```

- Dòng mục tiêu là OWNER, thao tác làm nó mất OWNER, và tập trả về chỉ có 1 dòng ⇒ `422 BUSINESS_RULE_VIOLATION` `LAST_OWNER`.
- Vì sao đủ: hai OWNER hạ nhau cùng lúc thì cùng khóa một tập dòng nên phải xếp hàng. Ở READ COMMITTED, request thứ hai sau khi chờ khóa sẽ đánh giá lại `role = 'OWNER'` trên phiên bản mới nhất ⇒ dòng vừa bị hạ không còn khớp ⇒ chỉ thấy 1 OWNER ⇒ bị từ chối.
- Nâng ai đó lên OWNER không cần khóa: nó chỉ làm tăng số OWNER; trường hợp xấu nhất là một request đồng thời bị từ chối nhầm, theo hướng an toàn.
- Prisma không có API `FOR UPDATE` ⇒ dùng `tx.$queryRaw` trong `PrismaWorkspaceMemberRepository.lockOwners(wsId)`.
- Áp dụng tương tự cho ẩn danh hóa user sau này (D2): user là OWNER cuối cùng của workspace nào thì phải chuyển quyền trước.

### 1.9. Bỏ gán khi mất quyền nhận việc (ADR-044, R14)

Khi thành viên bị xóa/tự rời **hoặc** bị hạ xuống VIEWER, trong cùng transaction với thay đổi membership:

1. Lấy các task chưa xóa có `workspace_id = $wsId AND assignee_id = $userId` (`FOR UPDATE`).
2. Với mỗi task: `assignee_id = NULL`, `version += 1`, audit `ASSIGNEE_CHANGED` (actor = người thực hiện thao tác).
3. Sau commit: `task:updated` (`changedFields: ["assignee"]`) cho từng task; `member:role-changed` hoặc `workspace:access-revoked` cho user đó.

Chống race với `PATCH …/assignee` đồng thời: use case assign đọc membership của assignee bằng `SELECT role FROM workspace_members WHERE workspace_id = $wsId AND user_id = $assigneeId FOR SHARE` trong transaction của nó. Hạ role/xóa cần khóa ghi dòng đó, nên hai bên xếp hàng: hoặc assign thấy role mới và bị từ chối, hoặc bước 1 thấy task vừa được gán và bỏ gán nó.

Khối lượng: nếu một người được gán rất nhiều task thì transaction lớn — chấp nhận ở v1 (dự kiến dưới vài trăm task/người); log cảnh báo khi > 500.

---

## 2. REST API contract

### 2.1. Quy ước chung
- Base: `/api/v1`. JSON, `Content-Type: application/json`.
- Xác thực: `Authorization: Bearer <accessToken>` (trừ register/login/refresh/logout).
- `X-Request-Id` (tùy chọn; server sinh nếu thiếu, luôn trả lại trong header và `meta.requestId`).
- `X-Client-Id`: UUID mỗi tab FE sinh khi load, gửi kèm mọi request ghi; server gắn vào event realtime (`originClientId`) — xem mục 4.3. **Không phải thông tin xác thực**: client tự sinh và giả mạo được, server KHÔNG dùng cho phân quyền, rate limit hay audit; giá trị không phải uuid ⇒ coi là `null` (T-002 §5.2).
- Thời gian: ISO-8601 UTC (`2026-10-15T08:00:00.000Z`); ngày: `YYYY-MM-DD`.
- Mọi response đều theo envelope (mục 3), kể cả DELETE (trả `200` + `data`). Ngoại lệ duy nhất: `/auth/logout`, `/auth/logout-all` trả `204` (theo T-002).
- Tenant (ADR-020): middleware `requireMembership(wsId)` → không phải thành viên **hoặc workspace đã xóa mềm** (ADR-047) ⇒ `404 RESOURCE_NOT_FOUND`. Là thành viên nhưng thiếu quyền ⇒ `403 FORBIDDEN_ACCESS`. Project/task không thuộc workspace/project trên URL ⇒ `404`.
- Lỗi luôn có thể trả (không lặp lại trong bảng): `401 UNAUTHORIZED`/`TOKEN_EXPIRED` (endpoint cần đăng nhập), `400 VALIDATION_ERROR` (gồm path param không phải uuid), `413 PAYLOAD_TOO_LARGE`, `415 UNSUPPORTED_MEDIA_TYPE`, `429 RATE_LIMITED`, `500 INTERNAL_ERROR`, `503 SERVICE_UNAVAILABLE`; mọi route dưới `/workspaces/:wsId` có thể `404`.

### 2.2. Permission (chốt với T-002 — `docs/design/security.md` là nguồn chính thức)

Role rank: OWNER 4 > PM 3 > MEMBER 2 > VIEWER 1. "Min role" = middleware chặn sớm; "Policy" = kiểm tra thêm ở application (ADR-021).

| Permission | Min role | Policy bổ sung |
|---|---|---|
| `workspace:read`, `member:read`, `project:read`, `task:read`, `audit:read` | VIEWER | — |
| `workspace:update`, `workspace:delete` | OWNER | — |
| `workspace:restore` | OWNER | Middleware riêng `includeDeleted` (mục 1.7) |
| `member:add` | PM | PM chỉ thêm với role MEMBER/VIEWER; OWNER thêm role bất kỳ |
| `member:update-role` | OWNER | Không hạ OWNER cuối cùng |
| `member:leave` | VIEWER | Tự rời (`userId` = chính mình), trừ OWNER cuối cùng. Là min role của `DELETE members/:userId` |
| `member:remove` | PM | Xóa người khác: PM chỉ xóa MEMBER/VIEWER; OWNER xóa bất kỳ trừ OWNER cuối cùng |
| `project:create`, `project:update`, `project:archive` | PM | — |
| `task:create`, `task:update`, `task:move` | MEMBER | MEMBER sửa/move **mọi** task trong project |
| `task:assign:any` | PM | — |
| `task:assign:own` | MEMBER | MEMBER chỉ: (a) đổi assignee của task mình tạo, hoặc (b) tự nhận task chưa có người, hoặc (c) tự bỏ nhận task đang gán cho mình |
| `task:delete:any` | PM | — |
| `task:delete:own` | MEMBER | `task.createdById === actor`; `createdById = null` ⇒ chỉ `:any` |
| `comment:create` | MEMBER | Để dành, chưa có model |

Endpoint không có `wsId` (`GET /workspaces`, `POST /workspaces`, `/auth/me`) chỉ cần đăng nhập, lọc theo `userId`.

**Thứ tự kiểm tra** (quyết định mã trả về): `401` xác thực → `400` params sai định dạng (uuid) → `404` không phải member / project∉ws / task∉project → `403` thiếu role hoặc Policy từ chối → `422` PROJECT_ARCHIVED / luật nghiệp vụ → `409` VERSION_CONFLICT. VD: VIEWER sửa task trong project archived ⇒ `403`.

**Truy vấn có phạm vi tenant (bắt buộc)**: mọi repository/query cho tài nguyên tenant nhận `workspaceId` (và `projectId`), vd `findFirst({ where: { id: taskId, projectId, workspaceId, deletedAt: null } })`. Cấm `findUnique({ where: { id } })` trần cho task/project/member.

### 2.3. DTO dùng trong bảng

```ts
UserDto       = { id, email, fullName, createdAt }
UserRefDto    = { id, fullName }                        // tham chiếu nhẹ trong task/audit
AuthTokenDto  = { accessToken, expiresIn /* giây */ }   // + Set-Cookie refresh
MembershipDto = { workspaceId, workspaceName, slug, role }
WorkspaceDto  = { id, name, slug, myRole, createdAt, updatedAt }
DeletedWorkspaceDto = { id, name, slug, deletedAt, purgeAt }
MemberDto     = { userId, email, fullName, role, joinedAt }
ProjectDto    = { id, workspaceId, name, keyPrefix, description: string|null,
                  isArchived, archivedAt: string|null, createdAt, updatedAt }
TaskDto       = { id, workspaceId, projectId, number, key /* "TF-101" */, title,
                  description: string|null, status, priority, rank, version,
                  dueDate: string|null /* YYYY-MM-DD */,
                  assignee: UserRefDto|null, createdBy: UserRefDto|null,
                  createdAt, updatedAt }
AuditLogDto   = { id, taskId, action, actor: UserRefDto, oldValue, newValue, createdAt }
```

### 2.4. Auth

| Method | Path | Permission | Request | Response `data` | Lỗi riêng |
|---|---|---|---|---|---|
| POST | `/auth/register` | Public, rate-limit 5/giờ/IP | body `{ email, password, fullName }` | `201 { ...AuthTokenDto, user: UserDto, defaultWorkspaceId }` + cookie | `409 EMAIL_ALREADY_EXISTS` (ADR-049: giữ ở v1 + rate limit; xác minh email để sau v1) |
| POST | `/auth/login` | Public, rate-limit | body `{ email, password }` | `{ ...AuthTokenDto, user: UserDto }` + cookie | `401 INVALID_CREDENTIALS` (cả user đã `deleted_at`) |
| POST | `/auth/refresh` | Cookie refresh + kiểm Origin, rate-limit | — | `AuthTokenDto` + cookie mới (rotation) | `401 REFRESH_TOKEN_INVALID` (hết hạn/thu hồi/reuse — không phân biệt), `409 REFRESH_IN_PROGRESS` (token vừa xoay < 10s: FE đợi ~300ms, thử lại 1 lần), `403 ORIGIN_NOT_ALLOWED` |
| POST | `/auth/logout` | Cookie refresh + kiểm Origin | — | **`204`** không body; xóa cookie (idempotent) | `403 ORIGIN_NOT_ALLOWED` |
| POST | `/auth/logout-all` | Bearer | — | **`204`** không body; xóa cookie | — |
| GET | `/auth/me` | Bearer | — | `{ user: UserDto, memberships: MembershipDto[] }` | — |
| PATCH | `/auth/me` | Bearer | body `{ fullName }` (ADR-083; đổi email/mật khẩu **không** qua đây) | `UserDto` | — |
| POST | `/auth/change-password` | Bearer | body `{ currentPassword, newPassword }` | `AuthTokenDto` + cookie mới (phiên mới cho thiết bị hiện tại; mọi phiên khác bị thu hồi) | `400 INVALID_CURRENT_PASSWORD` (cố ý không 401) |

Luật trường (T-002): `password` 12–256 ký tự (ADR-049, ADR-065: argon2id `@node-rs/argon2` m=47104 t=1 p=1, không còn giới hạn 72 byte; trần 256 chống DoS), không luật thành phần, chặn danh sách mật khẩu phổ biến, không trùng email; `fullName` trim, 1–100 ký tự; `email` trim + lowercase + NFC. FE chỉ tự gọi refresh khi `code = TOKEN_EXPIRED`, không phải mọi 401.

### 2.5. Workspaces & members

| Method | Path | Permission | Request | Response `data` | Lỗi riêng |
|---|---|---|---|---|---|
| GET | `/workspaces` | Đã đăng nhập | query `{ deleted?: "true" }` | Mặc định: `WorkspaceDto[]` chưa xóa của tôi (không phân trang — giới hạn 100 workspace/user). `deleted=true`: `DeletedWorkspaceDto[]` đã xóa mềm mà tôi là OWNER | — |
| POST | `/workspaces` | Đã đăng nhập | body `{ name, slug? }` | `201 WorkspaceDto` (người tạo là OWNER) | `409 RESOURCE_CONFLICT` (`details.field="slug"`) |
| GET | `/workspaces/:wsId` | `workspace:read` | — | `WorkspaceDto` | — |
| PATCH | `/workspaces/:wsId` | `workspace:update` | body `{ name?, slug? }` (≥1 trường) | `WorkspaceDto` | `409 RESOURCE_CONFLICT` (slug) |
| DELETE | `/workspaces/:wsId` | `workspace:delete` | body `{ confirmSlug }` | `DeletedWorkspaceDto` (xóa mềm, mục 1.7) | `400 VALIDATION_ERROR` nếu `confirmSlug` sai |
| POST | `/workspaces/:wsId/restore` | `workspace:restore` (OWNER; route chỉ thấy workspace đã xóa) | — | `WorkspaceDto` | `404` (không phải OWNER / chưa xóa / quá hạn) |
| GET | `/workspaces/:wsId/members` | `member:read` | query `{ q?, cursor?, limit? (1–100, mặc định 50) }`. `q` (ADR-083): trim, 1–100 ký tự, tìm chuỗi con **không phân biệt hoa thường** trong `fullName` hoặc `email` (`ILIKE` với `%`, `_`, `\` đã escape). Sắp theo `joinedAt`, `id` | `MemberDto[]` + `meta.page` | — |
| POST | `/workspaces/:wsId/members` | `member:add` | body `{ email, role }` (thêm user đã có tài khoản; lời mời qua email là Phase sau) | `201 MemberDto` | `404 RESOURCE_NOT_FOUND` (không có user), `409 RESOURCE_CONFLICT` (đã là thành viên), `403` (PM cấp role PM/OWNER) |
| PATCH | `/workspaces/:wsId/members/:userId` | `member:update-role` (OWNER) | body `{ role }` | `{ member: MemberDto, unassignedTaskCount }` (> 0 khi hạ xuống VIEWER, ADR-044) | `422 BUSINESS_RULE_VIOLATION` (`LAST_OWNER`) |
| DELETE | `/workspaces/:wsId/members/:userId` | `member:leave` (min VIEWER); người khác cần thêm `member:remove` (Policy — xem 2.2) | — | `{ userId, unassignedTaskCount }` | `403` (PM xóa OWNER/PM), `422 BUSINESS_RULE_VIOLATION` (`LAST_OWNER`) |

Policy member: xem 2.2 (chốt với T-002); workspace luôn còn ≥1 OWNER, khóa chống race theo mục 1.8 (ADR-046). Khi xóa/tự rời **hoặc hạ xuống VIEWER**: bỏ gán mọi task của họ trong workspace theo mục 1.9 (ADR-044).

Luật trường workspace (R19, chốt với T-002/T-006):

- `name`: trim, 1–100 ký tự, không chứa ký tự điều khiển.
- `slug`: `^[a-z0-9]+(-[a-z0-9]+)*$`, dài 3–50, unique toàn hệ thống (kể cả workspace đang xóa mềm). Client gửi chữ hoa ⇒ `400` (không tự lowercase, để URL người dùng thấy đúng như đã gửi).
- Slug dành riêng, trả `409 RESOURCE_CONFLICT` (`details.field = "slug"`) như slug đã có người dùng: `api`, `app`, `www`, `admin`, `auth`, `login`, `register`, `settings`, `workspaces`, `new`, `help`, `support`, `status`. Danh sách là hằng số của application, không nằm trong contracts.
- `POST /workspaces` không gửi `slug` ⇒ server sinh từ `name`: bỏ dấu tiếng Việt (NFD + bỏ dấu, `đ`→`d`), lowercase, ký tự khác `[a-z0-9]` thành `-`, gộp và cắt `-` ở hai đầu, cắt 40 ký tự. Nếu kết quả dưới 3 ký tự hoặc là slug dành riêng ⇒ dùng `workspace` (luôn kèm hậu tố ngẫu nhiên). Trùng ⇒ thêm hậu tố `-` + 6 ký tự `[a-z0-9]` ngẫu nhiên, thử lại tối đa 5 lần. Register tạo workspace mặc định theo cùng quy tắc, sinh từ `fullName`.
- Contracts: `WorkspaceName`, `WorkspaceSlug` (primitive dùng lại, mục 5.2).

### 2.6. Projects

| Method | Path | Permission | Request | Response `data` | Lỗi riêng |
|---|---|---|---|---|---|
| GET | `/workspaces/:wsId/projects` | `project:read` | query `{ archived?: "false"\|"true"\|"all" (mặc định false), cursor?, limit? (1–100, 50) }` | `ProjectDto[]` + `meta.page` | — |
| POST | `/workspaces/:wsId/projects` | `project:create` | body `{ name, keyPrefix, description? }` | `201 ProjectDto` | `409 RESOURCE_CONFLICT` (`details.field="keyPrefix"`) |
| GET | `/workspaces/:wsId/projects/:projectId` | `project:read` | — | `ProjectDto` | — |
| PATCH | `/workspaces/:wsId/projects/:projectId` | `project:update` | body `{ name?, description? }` (keyPrefix bất biến) | `ProjectDto` | `422 PROJECT_ARCHIVED` |
| POST | `/workspaces/:wsId/projects/:projectId/archive` | `project:archive` | — | `ProjectDto` (idempotent) | — |
| POST | `/workspaces/:wsId/projects/:projectId/unarchive` | `project:archive` | — | `ProjectDto` (idempotent) | — |

Không có endpoint xóa project ở v1 (chỉ archive) — ADR-040.

### 2.7. Tasks

Prefix: `/workspaces/:wsId/projects/:projectId/tasks`

| Method | Path | Permission | Request | Response `data` | Lỗi riêng |
|---|---|---|---|---|---|
| GET | `` | `task:read` | query `{ status?, assigneeId? (uuid \| "none"), cursor?, limit? (1–500, mặc định 200) }`. Sắp theo `status` (thứ tự enum), `rank`, `id`. | `TaskDto[]` + `meta.page` | — |
| GET | `/:taskId` | `task:read` | — | `TaskDto` | `404` (kể cả task đã xóa mềm) |
| POST | `` | `task:create` | body `{ title, description?, priority?, dueDate?, assigneeId? }` — luôn vào TODO, cuối cột; MEMBER gửi `assigneeId` khác chính mình ⇒ cần `task:assign:any` (`403`) | `201 TaskDto` | `422 PROJECT_ARCHIVED`, `422 BUSINESS_RULE_VIOLATION` (`ASSIGNEE_NOT_MEMBER`) |
| PATCH | `/:taskId` | `task:update` | body `{ expectedVersion, title?, description?, priority?, dueDate? }` (≥1 trường; `null` để xóa description/dueDate) | `TaskDto` | `409 VERSION_CONFLICT`, `422 PROJECT_ARCHIVED` |
| PATCH | `/:taskId/move` | `task:move` | body `{ expectedVersion, status?, afterId?: uuid\|null, beforeId?: uuid\|null }` | `TaskDto` | `409 VERSION_CONFLICT`, `409 RESOURCE_CONFLICT` (rank, sau 3 lần thử), `422 INVALID_STATUS_TRANSITION`, `422 PROJECT_ARCHIVED`, `422 BUSINESS_RULE_VIOLATION` (`INVALID_ANCHOR`) |
| PATCH | `/:taskId/assignee` | `task:assign:any` hoặc `task:assign:own` (Policy, xem 2.2) | body `{ expectedVersion, assigneeId: uuid\|null }` | `TaskDto` | `403 FORBIDDEN_ACCESS`, `409 VERSION_CONFLICT`, `422 PROJECT_ARCHIVED`, `422 BUSINESS_RULE_VIOLATION` (`ASSIGNEE_NOT_MEMBER`) |
| DELETE | `/:taskId` | `task:delete:any` hoặc `task:delete:own` (Policy, ADR-022) | query `{ expectedVersion? }` | `{ id, version }` | `403 FORBIDDEN_ACCESS`, `409 VERSION_CONFLICT` (nếu gửi version), `422 PROJECT_ARCHIVED` |
| GET | `/:taskId/audit-logs` | `audit:read` | query `{ cursor?, limit? (1–100, 50) }`, mới nhất trước | `AuditLogDto[]` + `meta.page` | — (task đã xóa mềm **vẫn** đọc được lịch sử) |

**Ngữ nghĩa move** (ADR-011, server là nguồn sự thật):
- `afterId` = task nằm **ngay trên** vị trí mới; `beforeId` = task nằm **ngay dưới**. Cả hai cùng cột đích (`status ?? task.status`), cùng project, chưa xóa, khác chính task đó; sai ⇒ `INVALID_ANCHOR`.
- Server tính rank từ dữ liệu DB, không tin rank client: nếu có `afterId` → giữa `afterId` và task kế tiếp thực tế của nó; ngược lại nếu có `beforeId` → giữa task liền trước thực tế và `beforeId`; không có cả hai → cuối cột. (Client cũ dữ liệu vẫn ra kết quả hợp lý.)
- `status` khác hiện tại ⇒ kiểm tra state machine; bằng hoặc không gửi ⇒ chỉ đổi rank (audit `MOVED`).
- Mỗi thay đổi thành công: `version += 1`.

**VERSION_CONFLICT** trả `error.details = { currentVersion, current: TaskDto }` để FE hòa giải mà không refetch.

---

## 3. Envelope & mã lỗi

### 3.1. Envelope (giữ v1.0, mở rộng `meta`)

```jsonc
// Thành công
{ "success": true,
  "data": { /* hoặc mảng */ },
  "meta": { "timestamp": "2026-10-15T08:00:00.000Z", "requestId": "…",
            "page": { "nextCursor": "eyJ…" , "hasMore": true, "limit": 50 } } } // page chỉ có ở endpoint danh sách

// Lỗi
{ "success": false,
  "error": { "code": "VERSION_CONFLICT", "message": "Task đã bị người khác cập nhật.",
             "details": { /* tùy code, có thể null */ } },
  "meta": { "timestamp": "…", "requestId": "…" } }
```

- Cursor: chuỗi **opaque** base64url của khóa sắp xếp cuối trang (vd `{createdAt,id}` hoặc `{status,rank,id}`), có kèm tên khóa để server từ chối cursor dùng sai endpoint (`400 VALIDATION_ERROR`, `details.field="cursor"`). `nextCursor = null` khi hết.
- `message` dành cho người đọc (tiếng Việt), FE **không** rẽ nhánh theo `message`, chỉ theo `code` (+ `details.rule`).

### 3.2. Danh mục `error.code`

| code | HTTP | Khi nào | `details` |
|---|---|---|---|
| `VALIDATION_ERROR` | 400 | Zod fail (body/query/params, kể cả id không phải uuid), cursor hỏng | `{ issues: [{ path: (string\|number)[], code, message }] }` — `code` là mã issue của Zod (`too_small`, `invalid_format`, `unrecognized_keys`, …) để FE xử lý theo máy; `message` tiếng Việt từ locale `vi` của Zod (ADR-081). Server không trả `input` của issue (tránh phản chiếu dữ liệu nhạy cảm như mật khẩu) |
| `UNAUTHORIZED` | 401 | Thiếu/sai chữ ký access token, `tv` không khớp | null |
| `TOKEN_EXPIRED` | 401 | Access token hết hạn → FE gọi `/auth/refresh` rồi thử lại 1 lần | null |
| `INVALID_CREDENTIALS` | 401 | Sai email/mật khẩu, hoặc user đã xóa (thông điệp chung) | null |
| `INVALID_CURRENT_PASSWORD` | 400 | change-password sai mật khẩu cũ (cố ý không 401 để interceptor FE không nhầm) | null |
| `REFRESH_TOKEN_INVALID` | 401 | Refresh thiếu/hết hạn/thu hồi/reuse | null |
| `ORIGIN_NOT_ALLOWED` | 403 | Origin không hợp lệ trên endpoint dùng cookie (`/auth/refresh`, `/auth/logout`) | null |
| `FORBIDDEN_ACCESS` | 403 | Là thành viên nhưng thiếu quyền / policy chặn | `{ required?: permission }` |
| `RESOURCE_NOT_FOUND` | 404 | Không tồn tại **hoặc** khác tenant (ADR-020) | `{ resource: "task"\|"project"\|"workspace"\|"user" }` |
| `VERSION_CONFLICT` | 409 | `expectedVersion` lệch (ADR-010) | `{ currentVersion, current: TaskDto }` |
| `RESOURCE_CONFLICT` | 409 | Trùng unique (slug, keyPrefix, đã là thành viên), trùng rank sau retry | `{ field?, reason }` |
| `EMAIL_ALREADY_EXISTS` | 409 | Register trùng email (ADR-049: giữ ở v1, bù bằng rate-limit) | null |
| `REFRESH_IN_PROGRESS` | 409 | Refresh token vừa xoay < 10s (2 tab refresh cùng lúc) — không cấp, không thu hồi family | null |
| `PAYLOAD_TOO_LARGE` | 413 | Vượt body limit (ADR-028) | null |
| `UNSUPPORTED_MEDIA_TYPE` | 415 | Body không phải `application/json` | null |
| `INVALID_STATUS_TRANSITION` | 422 | Vi phạm state machine | `{ from, to, allowed: TaskStatus[] }` |
| `PROJECT_ARCHIVED` | 422 | Ghi vào project đã archive (ADR-023) | `{ projectId }` |
| `BUSINESS_RULE_VIOLATION` | 422 | Luật khác | `{ rule: "LAST_OWNER" \| "ASSIGNEE_NOT_MEMBER" \| "INVALID_ANCHOR" \| … }` |
| `RATE_LIMITED` | 429 | Rate-limit (header `Retry-After`) | `{ retryAfterSec }` |
| `INTERNAL_ERROR` | 500 | Lỗi không lường trước (không lộ stack) | null |
| `SERVICE_UNAVAILABLE` | 503 | Valkey (ADR-063) và DB đều lỗi khi kiểm `token_version` | null |

Map class lỗi (blueprint §7, polymorphism): `ValidationError`→400, `UnauthorizedError`→401 (+ subclass `TokenExpiredError`, …), `ForbiddenError`→403, `ResourceNotFoundError`→404, `ConflictError`→409 (`VERSION_CONFLICT`/`RESOURCE_CONFLICT`), `BusinessRuleViolationError`→422 (+ subclass `InvalidStatusTransitionError`, `ProjectArchivedError`). Mỗi class tự mang `statusCode` + `errorCode`.

---

## 4. WebSocket contract (Socket.io 4.x)

### 4.1. Kết nối & phòng
- Handshake: `io(WS_URL, { auth: { token: accessToken, clientId } })`. JWT sai/hết hạn ⇒ `connect_error` với `err.data = { code: "UNAUTHORIZED" | "TOKEN_EXPIRED" }` (ADR-027). Gia hạn token khi socket đang mở: `auth:renew` / `auth:expired` — luồng chi tiết ở `docs/design/security.md` mục 5 (T-002).
- Phòng: `project:{projectId}` (dữ liệu board) và `user:{userId}` (server tự join khi connect, dùng cho thông báo thu hồi quyền).

### 4.2. Client → Server (dùng ack callback)

| Event | Payload | Ack |
|---|---|---|
| `project:join` | `{ workspaceId, projectId }` | `{ ok: true }` \| `{ ok: false, code: "RESOURCE_NOT_FOUND" \| "VALIDATION_ERROR" \| "UNAUTHORIZED" }` (không thành viên ⇒ NOT_FOUND, như REST) |
| `project:leave` | `{ projectId }` | `{ ok: true }` |
| `auth:renew` | `{ token }` (access token mới sau REST refresh) | `{ ok: true }` \| `{ ok: false, code: "UNAUTHORIZED" }` → server ngắt socket |

Dạng ack chung (chốt với T-002): `SocketAck = { ok: true } | { ok: false, code: ErrorCode }`.

Client không gửi thay đổi dữ liệu qua socket; mọi ghi đi qua REST.

### 4.3. Server → Client

Mọi event có chung vỏ:

```ts
type RealtimeEnvelope<TType extends string, TData> = {
  eventId: string;          // uuid, FE dùng để khử trùng lặp
  type: TType;              // trùng tên event
  occurredAt: string;       // ISO, thời điểm commit
  actorId: string;          // user thực hiện (ADR-014, không có 'system')
  originClientId: string | null; // X-Client-Id của request gây ra event
  data: TData;
};
```

| Event | Phòng | `data` | Phát khi |
|---|---|---|---|
| `task:created` | project | `{ task: TaskDto }` | CreateTask |
| `task:updated` | project | `{ task: TaskDto, changedFields: ("title"\|"description"\|"priority"\|"dueDate"\|"assignee")[] }` | UpdateTask, AssignTask, bỏ gán khi xóa thành viên |
| `task:moved` | project | `{ task: TaskDto, from: { status, rank }, to: { status, rank } }` | MoveTask (đổi cột và/hoặc rank) |
| `task:deleted` | project | `{ taskId, projectId, key, version }` (`version` sau khi xóa) | DeleteTask |
| `project:updated` | project | `{ project: ProjectDto }` | update/archive/unarchive project — FE khóa board khi `isArchived` |
| `workspace:access-revoked` | user | `{ workspaceId }` | Bị xóa khỏi workspace / tự rời (server cũng `socketsLeave` các phòng project của workspace đó, ADR-027) |
| `auth:expired` | socket | `{}` | Access token của socket hết hạn chưa `auth:renew` — FE refresh rồi `auth:renew`; quá hạn ân hạn ⇒ server ngắt (T-002) |
| `member:role-changed` | user | `{ workspaceId, role }` | Đổi role — FE cập nhật quyền UI |

Ánh xạ domain event (ADR-013) → socket: `TaskCreated`→`task:created`; `TaskStatusChanged`/`TaskMoved`→`task:moved` (1 use case = 1 socket event dù phát nhiều domain event); `TaskUpdated`/`TaskAssigneeChanged`→`task:updated`; `TaskDeleted`→`task:deleted`. Phát **sau commit** (ADR-012).

### 4.4. Quy tắc phía FE (không cần refetch)
1. **Bỏ event của chính mình**: nếu `originClientId === myClientId` ⇒ bỏ qua (cache đã cập nhật từ response REST). Dùng `clientId` theo tab thay `socket.id` vì socket có thể reconnect giữa chừng; hai tab cùng user vẫn nhận của nhau.
2. **Khử trùng lặp**: giữ tập `eventId` gần đây (vd 500 cái).
3. **Event đến trễ / sai thứ tự**: áp dụng `task:*` chỉ khi `data.task.version > cached.version` (hoặc task chưa có trong cache và chưa nằm trong tập tombstone). Bằng hoặc nhỏ hơn ⇒ bỏ.
4. **Xóa**: `task:deleted` ⇒ xóa khỏi cache và ghi tombstone `{ taskId → version }`; event cũ hơn tới sau bị bỏ nhờ tombstone.
5. `task:moved` ⇒ đặt task vào cột `to.status`, sắp lại cột theo `rank` (so sánh chuỗi byte, khớp collation "C" — FE dùng `a < b`, không dùng `localeCompare`).
6. **Mất kết nối**: không có replay ở v1.1 ⇒ khi `connect` lại thành công thì join lại phòng và refetch board **một lần** (ngoại lệ duy nhất).

---

## 5. Thiết kế `packages/contracts`

### 5.1. Cấu trúc

```
packages/contracts/src/
  common/
    primitives.ts      Uuid, IsoDateTime, DateOnly, Cursor, Limit(max)
    envelope.ts        ApiMeta, PageMeta, ApiSuccess(schema), ApiErrorBody, ApiResponse<T> (type)
    error-codes.ts     ErrorCode (z.enum + const), BusinessRule (z.enum)
  auth/
    auth.schemas.ts    RegisterBody, LoginBody, ChangePasswordBody, AuthTokenDto, UserDto, UserRefDto,
                       MembershipDto, RegisterResponse, LoginResponse, MeResponse, UpdateMeBody, Password, Email, FullName
  workspace/
    workspace.schemas.ts WorkspaceRole, WorkspaceDto, CreateWorkspaceBody, UpdateWorkspaceBody,
                         DeleteWorkspaceBody, WorkspaceParams,
                         ListWorkspacesQuery, DeletedWorkspaceDto, ChangeMemberRoleResponse
    member.schemas.ts    MemberDto, AddMemberBody, ChangeMemberRoleBody, MemberParams, ListMembersQuery (có q),
                         RemoveMemberResponse
  project/
    project.schemas.ts ProjectDto, CreateProjectBody, UpdateProjectBody, ListProjectsQuery, ProjectParams,
                       KeyPrefix
  task/
    task.schemas.ts    TaskStatus, TaskPriority, TaskDto, TaskTitle, TaskDescription,
                       CreateTaskBody, UpdateTaskBody, MoveTaskBody, AssignTaskBody,
                       DeleteTaskQuery, DeleteTaskResponse, ListTasksQuery, TaskParams,
                       VersionConflictDetails
    task.constants.ts  TASK_STATUS_ORDER, TASK_STATUS_TRANSITIONS (ADR-080)
  rbac/
    permissions.ts     Permission (z.enum), ROLE_PERMISSIONS, ROLE_RANK (ADR-080)
  audit/
    audit.schemas.ts   TaskAuditAction, AuditLogDto, ListAuditLogsQuery
  realtime/
    events.ts          REALTIME_EVENTS (tên event const), RealtimeEnvelope, TaskCreatedEvent,
                       TaskUpdatedEvent, TaskMovedEvent, TaskDeletedEvent, ProjectUpdatedEvent,
                       WorkspaceAccessRevokedEvent, AuthExpiredEvent, MemberRoleChangedEvent, ProjectJoinPayload,
                       AuthRenewPayload, SocketAck,
                       ClientToServerEvents, ServerToClientEvents (type map cho Socket.io generics)
  index.ts             barrel; package.json "exports" có subpath ./auth, ./task, ... để tree-shake
```

### 5.2. Quy ước đặt tên
- Schema và type **cùng tên**: `export const CreateTaskBody = z.object({...}); export type CreateTaskBody = z.infer<typeof CreateTaskBody>;`
- Hậu tố: `…Body` (request body), `…Query` (query string, dùng `z.coerce` cho số), `…Params` (path params), `…Dto` (dữ liệu trả về), `…Response` (khi `data` không phải 1 Dto), `…Event` (payload socket), `…Details` (`error.details` có cấu trúc).
- Enum: `z.enum([...])` tên số ít PascalCase (`TaskStatus`), giá trị UPPER_SNAKE khớp Prisma enum. Prisma enum **không** import vào contracts — một test ở `apps/api` khẳng định hai bên khớp.
- Field primitive dùng lại (`TaskTitle = z.string().trim().min(3).max(150)`) để FE form và BE validate cùng một luật.
- `Password = z.string().min(12).max(256)` (ADR-049, ADR-065). Kiểm danh sách mật khẩu phổ biến và "không trùng email" nằm ở **application** của API (danh sách lớn, cần ngữ cảnh), không nằm trong contracts.
- Zod 4.6 (đã kiểm, stack-versions §8.6): `import * as z from "zod"`; `z.uuid()` cho mọi id (nhận v4 và v7, không khóa version); `z.email()`; `z.iso.date()` cho `dueDate`; `z.iso.datetime()` (chỉ nhận `Z`, server luôn trả `toISOString()`); thông điệp tùy chỉnh dùng `{ error: "…" }` (không còn `message`). API gọi `z.config(z.locales.vi())` một lần ở composition root (ADR-081).
- DTO dùng `z.object` (strip mặc định); Body dùng `z.strictObject` để từ chối field lạ (vd client gửi `version`, `createdById`).

### 5.3. KHÔNG để trong contracts
- **Logic** state machine, policy RBAC (ownership, LAST_OWNER…), tính rank, cấp số task, luật archived/assignee là **domain/application**.
- Ngoại lệ dạng **dữ liệu thuần** (ADR-043, ADR-080): contracts xuất `TASK_STATUS_TRANSITIONS` (`Record<TaskStatus, readonly TaskStatus[]>`) và `ROLE_PERMISSIONS` (`Record<WorkspaceRole, readonly Permission[]>`, cùng `Permission` enum) để FE ẩn/khóa UI. `apps/api` **bắt buộc** có test parity trong CI so với bảng trong `TaskEntity` và bảng quyền của RBAC. Domain là nguồn sự thật và **không import** contracts.
- Không import Prisma, Express, Socket.io runtime (chỉ type-only cho generic event map nếu cần), không đọc env, không I/O.
- Không chứa map `ErrorCode → HTTP status` (thuộc API) và không chứa nhãn UI tiếng Việt (thuộc web).
- `packages/contracts` chỉ phụ thuộc `zod`.

---

## 6. Luật nghiệp vụ task

### 6.1. State machine (blueprint §3.2, giữ nguyên)

| Từ \ Đến | TODO | IN_PROGRESS | REVIEW | DONE |
|---|:-:|:-:|:-:|:-:|
| TODO | (rank) | ✅ | ❌ | ❌ |
| IN_PROGRESS | ✅ | (rank) | ✅ | ❌ |
| REVIEW | ❌ | ✅ | (rank) | ✅ |
| DONE | ❌ | ❌ | ✅ (reopen) | (rank) |

Task mới luôn ở TODO. Sai ⇒ `422 INVALID_STATUS_TRANSITION` với `details.allowed`.

### 6.2. Bảng luật

| ID | Luật | Áp dụng | Vi phạm ⇒ | Nguồn |
|---|---|---|---|---|
| R1 | `title` sau trim dài 3–150 ký tự, không chứa ký tự điều khiển (trừ không có xuống dòng) | create, update | `400 VALIDATION_ERROR` (Zod) + entity kiểm lại | blueprint §7 |
| R2 | `description` ≤ 10 000 ký tự (plain text/markdown, FE render an toàn); chuỗi rỗng sau trim ⇒ `null` | create, update | `400` | ADR-040 |
| R3 | `priority` ∈ LOW/MEDIUM/HIGH/URGENT, mặc định **MEDIUM** | create | `400` | v1.0 schema |
| R4 | `dueDate` dạng `YYYY-MM-DD`, năm 2000–2100. **Cho phép ngày quá khứ** (server không biết múi giờ người dùng; nhập lùi dữ liệu); FE cảnh báo "quá hạn" | create, update | `400` | ADR-040 |
| R5 | Project archived ⇒ cấm tạo/sửa/move/gán/**xóa** task (archive = chỉ đọc). Chỉ được đọc và unarchive | mọi lệnh ghi task | `422 PROJECT_ARCHIVED` | ADR-023, ADR-045 |
| R6 | Assignee phải là thành viên **hiện tại** của workspace với role **≥ MEMBER** (VIEWER không được giao việc) và chưa bị ẩn danh hóa. Kiểm bằng `FOR SHARE` trên dòng membership (mục 1.9) | create, assign | `422 BUSINESS_RULE_VIOLATION` `ASSIGNEE_NOT_MEMBER` (nghĩa: không phải thành viên đủ điều kiện) | ADR-023, ADR-044 |
| R7 | Ai được đổi assignee: OWNER/PM mọi task (`task:assign:any`). MEMBER (`task:assign:own`) chỉ: đổi assignee task mình tạo; tự nhận task chưa có người; tự bỏ nhận task đang gán cho mình. Khi **tạo** task, MEMBER chỉ được để trống hoặc gán chính mình; gán người khác cần `task:assign:any`. VIEWER không | create, assign | `403` | ADR-041 |
| R8 | Ai được sửa title/description/priority/dueDate và move: OWNER/PM/MEMBER, mọi task (Kanban cộng tác) | update, move | `403` | ADR-041 |
| R9 | Xóa: OWNER/PM mọi task; MEMBER chỉ task có `createdById = actor`; task có `createdById = null` chỉ OWNER/PM; VIEWER không | delete | `403` | ADR-022 |
| R10 | Mọi lệnh ghi (trừ create) phải gửi `expectedVersion` (delete: tùy chọn); lệch ⇒ conflict; thành công ⇒ `version + 1` (kể cả xóa mềm) | update, move, assign, delete | `409 VERSION_CONFLICT` | ADR-010 |
| R11 | Move: anchor cùng project, cùng cột đích, chưa xóa, khác chính nó | move | `422 BUSINESS_RULE_VIOLATION` `INVALID_ANCHOR` | ADR-011 |
| R12 | Task mới vào cuối cột TODO; mã `KEY-n` cấp bằng `UPDATE … RETURNING` trong transaction, không tái sử dụng | create | — | ADR-011, FR-03 |
| R13 | Mọi thay đổi ghi 1 dòng audit trong cùng transaction; actor là user đã xác thực | mọi lệnh ghi | rollback cả thao tác | ADR-012, ADR-014 |
| R14 | Thành viên bị xóa/tự rời **hoặc bị hạ xuống VIEWER** ⇒ mọi task họ đang được gán trong workspace bị bỏ gán (audit + event), mục 1.9 — **kể cả trong project archived** (ngoại lệ có chủ đích của R5) | remove member, change role | — | ADR-044, ADR-092 |
| R18 | Workspace đã xóa mềm ⇒ mọi thao tác task/project/member trả `404`; chỉ OWNER khôi phục được trong 30 ngày | mọi | `404` | ADR-047 |
| R15 | Lệnh không đổi gì (vd assign cùng người, PATCH cùng giá trị, move về đúng chỗ) ⇒ trả `200` task hiện tại, **không** tăng version, không audit, không event. `expectedVersion` được kiểm **trước** no-op: no-op với version cũ vẫn `409` | update, move, assign | — | ADR-040, ADR-091 |
| R16 | Task đã xóa mềm: mọi GET/ghi ⇒ `404`; riêng audit-logs vẫn đọc được | mọi | `404` | D1 |
| R17 | `keyPrefix`: `^[A-Z][A-Z0-9]{1,9}$`, unique trong workspace, bất biến | create project | `400` / `409` | FR-03, D7 |
| R19 | Workspace `name` trim 1–100; `slug` `^[a-z0-9]+(-[a-z0-9]+)*$` dài 3–50, unique, có slug dành riêng; tự sinh khi không gửi (mục 2.5) | create/update workspace, register | `400` / `409 RESOURCE_CONFLICT` | T-006, ĐỀ XUẤT |

---

## Phụ lục — Câu hỏi mở và trạng thái

| # | Câu hỏi | Trạng thái |
|---|---|---|
| Q1 | Quyền sửa/gán của MEMBER | ✅ ADR-041 — R7, R8 |
| Q2 | Khôi phục/purge task xóa mềm | ✅ ADR-042 — chưa có ở v1 |
| Q3 | Nơi đặt bảng chuyển trạng thái | ✅ ADR-043 — domain là nguồn, contracts bản sao + test parity |
| Q4 | VIEWER làm assignee | ✅ ADR-044 — **không**; R6, R14, mục 1.9 |
| Q5 | Cấm xóa task khi archived | ✅ ADR-045 — R5 |
| Q6 | `409 EMAIL_ALREADY_EXISTS` ở register | ✅ ADR-049 — giữ 409 ở v1; mật khẩu ≥ 12 ký tự |
| Q7 | Khôi phục workspace trong ân hạn: chỉ OWNER (mục 1.7) | ✅ ADR-050 — làm ở v1; slug giữ chỗ |
